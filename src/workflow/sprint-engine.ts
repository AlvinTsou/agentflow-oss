import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { qualityLoop, type PhaseEvent } from "./quality-loop.js";
import { StateStore } from "./state-store.js";
import { initSprintRepo } from "./sprint-repo.js";
import {
  gitCommit,
  gitTag,
  gitResetHard,
  assertGitToplevel,
  stepTagName,
  iterationTagName,
  sprintDoneTagName,
  sprintFailedTagName,
  sprintInitTagName,
} from "./git-checkpoint.js";
import { readArtifact } from "../artifacts/io.js";
import type { HumanGate, HumanGateDecision } from "./human-gate.js";
import { writeArtifact, type Artifact, type ArtifactFrontmatter } from "../artifacts/io.js";
import { loadConfig, resolveEffectiveConfig, type EffectiveConfig } from "./config-loader.js";
import { checkRequestChangesBlock, ingestFeedback } from "../feedback/ingest.js";
import { runMiddlemanStep } from "../middleman/middleman.js";
import { newMeter, recordCall, type UsageMeter } from "../middleman/provider.js";
import type {
  Recipe,
  StepDef,
  StepContext,
  ForEachItem,
  StepProviderOverride,
} from "../recipe/types.js";
import { applyProviderOverride, resolveItemOverride } from "../recipe/types.js";
import type { Provider, ProviderRunOptions } from "../middleman/provider.js";
import {
  buildReadinessReport,
  guardSeverityFor,
  upsertContractGuardDecision,
  type CarryOver,
  type Readiness,
} from "./readiness.js";

/**
 * Resolved provider names for one phase-loop unit (a single-pass step OR
 * a single forEach iteration). Carried alongside the runner triple so
 * `makeOnPhase` can attribute calls to the EFFECTIVE provider (post
 * per-iter override) when recording cost / token meter rows.
 */
interface ResolvedProviders {
  produce: Provider;
  review: Provider;
  fix: Provider;
  reviewFallback: Provider | null;
}

/** Cross-model review fallback policy: any non-codex reviewer falls back to
 *  codex (the reliable cross-model floor); a codex reviewer has no fallback. */
export function reviewFallbackFor(reviewProvider: Provider): Provider | null {
  return reviewProvider === "codex" ? null : "codex";
}

/**
 * Builds the producer/reviewer/fixer/reviewFallback runner triple for a
 * step OR for a single forEach iteration. The override argument is the
 * per-iter override resolved via `resolveItemOverride` from
 * ForEachConfig — pass `undefined` for the step-default triple.
 *
 * The override is applied uniformly to producer / reviewer / fixer (and
 * to reviewFallback's derivation: fallback exists iff effective reviewer
 * is non-codex — see `reviewFallbackFor`). Codex tuning auto-strip is
 * handled inside `applyProviderOverride`.
 *
 * Exported for direct testing in `tests/poc-foreach-per-item-providers.ts`.
 */
export function buildRunners(
  baseProducer: Provider,
  baseReviewer: Provider,
  baseFixer: Provider,
  produceOptions: ProviderRunOptions,
  reviewOptions: ProviderRunOptions,
  fixOptions: ProviderRunOptions,
  override?: StepProviderOverride,
): {
  runners: {
    producer: (p: string) => ReturnType<typeof runMiddlemanStep>;
    reviewer: (p: string) => ReturnType<typeof runMiddlemanStep>;
    fixer: (p: string) => ReturnType<typeof runMiddlemanStep>;
    reviewFallback?: (p: string) => ReturnType<typeof runMiddlemanStep>;
  };
  resolved: ResolvedProviders;
} {
  const prod = applyProviderOverride(baseProducer, produceOptions, override);
  const rev = applyProviderOverride(baseReviewer, reviewOptions, override);
  const fix = applyProviderOverride(baseFixer, fixOptions, override);
  // reviewFallback is structural cross-model recovery: any non-codex reviewer
  // falls back to codex (codex is the floor, no fallback). No override applied —
  // overriding the fallback to the reviewer's own provider would defeat the
  // cross-model gate. See reviewFallbackFor.
  const reviewFallback: Provider | null = reviewFallbackFor(rev.provider);
  return {
    runners: {
      producer: (p: string) => runMiddlemanStep(p, { ...prod.options, provider: prod.provider }),
      reviewer: (p: string) => runMiddlemanStep(p, { ...rev.options, provider: rev.provider }),
      fixer: (p: string) => runMiddlemanStep(p, { ...fix.options, provider: fix.provider }),
      reviewFallback: reviewFallback
        ? (p: string) => runMiddlemanStep(p, { ...reviewOptions, provider: reviewFallback })
        : undefined,
    },
    resolved: {
      produce: prod.provider,
      review: rev.provider,
      fix: fix.provider,
      reviewFallback,
    },
  };
}

/**
 * Formats a resolved per-iter override for the
 * `iteration-started.providerOverride` event field. Encodes provider
 * + optional model so `ag-replay` and acceptance checks can verify
 * routing at a glance.
 */
function formatProviderOverride(override: StepProviderOverride): string {
  const provider = override.provider ?? "<inherit>";
  const model = override.model ?? override.runOptions?.model;
  return model ? `${provider}:${model}` : provider;
}

export type MaxRepeatDecision = "abort" | "force-pass";

export interface MaxRepeatContext {
  step: string;
  stepIdx: number;
  /** forEach iteration id when applicable. */
  iteration?: string;
  finalScore: number;
  targetScore: number;
  attempts: number;
  /** The last-attempt produce output. Useful if the caller wants to inspect/edit. */
  finalOutput: string;
}

export type OnMaxRepeat = (
  ctx: MaxRepeatContext,
) => MaxRepeatDecision | Promise<MaxRepeatDecision>;

export interface RunSprintOptions {
  recipe: Recipe;
  sprintDir: string;
  sprintId: string;
  /**
   * Called when a step's Quality Loop fails to reach targetScore within
   * maxRepeat attempts. Also called per-iteration for forEach steps. Return
   * "force-pass" to accept the last-attempt output and continue (artifact
   * records `forced: true`); return "abort" — the default — to commit + tag
   * `sprint-failed` and throw.
   */
  onMaxRepeat?: OnMaxRepeat;
  /**
   * Optional human-in-the-loop gate. Called after each STEP's artifact has
   * been written + committed + tagged (forEach steps trigger it once per
   * step, not once per iteration). Default: skipped (autonomous mode).
   * Rollback decisions reset the repo to the previous step's tag and re-run
   * the target step.
   */
  humanGate?: HumanGate;
  /**
   * Recipe-level options to snapshot into state.json at sprint-init. Used so
   * resume tools (ag-resume) can reconstruct recipe construction args without
   * the user re-specifying them.
   */
  recipeOptions?: Record<string, unknown>;
  /**
   * Resume from a non-zero step index. The sprint dir + state.json must
   * already exist (the engine `load`s rather than `init`s) and the prior
   * step artifacts must be on disk. Default 0 — a fresh sprint.
   */
  startFromStepIdx?: number;
}

export interface SprintResult {
  passed: boolean;
  sprintId: string;
  sprintDir: string;
  meter: UsageMeter;
  perStep: Array<{ step: string; score: number; attempts: number; tokens: number; iterations?: number }>;
}

export interface SprintSummary {
  recipeName: string;
  sprintId: string;
  sprintDir: string;
  perStep: SprintResult["perStep"];
  totalTokens: number;
  totalCostUsd: number;
  byProvider: UsageMeter["byProvider"];
  completedAt: string;
  readiness: Readiness;
  reviewVerdict: string | null;
  blockingCount: number;
  carryOvers: CarryOver[];
}

function defaultParseScore(text: string): number | null {
  const m = text.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function buildReviewPrompt(rubric: string, output: string): string {
  return `${rubric}\n\n--- ARTIFACT UNDER REVIEW ---\n${output}\n--- END ---`;
}

function buildFixPrompt(rubric: string, output: string, review: string): string {
  return [
    "You are a fixing agent. The artifact below failed review.",
    "Produce a CORRECTED artifact that addresses every failed rubric item.",
    "Do NOT rewrite parts that already pass.",
    "Output ONLY the corrected artifact body, with the same formatting expectations as the original step.",
    "",
    "--- ORIGINAL ARTIFACT ---",
    output,
    "--- END ---",
    "",
    "--- REVIEW REPORT (failures) ---",
    review,
    "--- END ---",
    "",
    "--- RUBRIC YOU MUST SATISFY ---",
    rubric,
    "--- END ---",
  ].join("\n");
}

function resolveProducePrompt(step: StepDef, ctx: StepContext): string {
  const p = step.producePrompt;
  if (!p) throw new Error(`Step "${step.name}" missing producePrompt.`);
  return typeof p === "function" ? p(ctx) : p;
}

function resolveRubric(step: StepDef, ctx: StepContext): string {
  const r = step.rubric;
  if (!r) throw new Error(`Step "${step.name}" missing rubric.`);
  return typeof r === "function" ? r(ctx) : r;
}

const FILE_MUTATION_TOOLS = new Set(["Write", "Edit", "Bash"]);

/**
 * Validate every step's intent vs allowedTools. Throws on synthetic intent
 * combined with file-mutation tools, including per-phase overrides.
 *
 * Invoked once at sprint init (init path only; resume reuses the validated
 * recipe).
 */
export function validateRecipeIntent(recipe: Recipe): void {
  for (const step of recipe.steps) {
    const intent = step.intent ?? "synthetic";
    if (intent !== "synthetic") continue;
    const toolPools: string[][] = [];
    if (step.runOptions?.allowedTools) toolPools.push(step.runOptions.allowedTools);
    for (const phase of ["produce", "review", "fix"] as const) {
      const cfg = step.perPhase?.[phase];
      if (cfg?.runOptions?.allowedTools) toolPools.push(cfg.runOptions.allowedTools);
    }
    for (const tools of toolPools) {
      const dangerous = tools.filter((t) => FILE_MUTATION_TOOLS.has(t));
      if (dangerous.length > 0) {
        throw new Error(
          `Step "${step.name}" has intent="synthetic" but allowedTools includes [${dangerous.join(", ")}]. ` +
          `Either set intent: "real-codebase" or remove the file-mutation tools.`,
        );
      }
    }
  }
}

function validateRecipe(recipe: Recipe): void {
  for (const step of recipe.steps) {
    if (step.forEach && (step.producePrompt || step.rubric)) {
      throw new Error(
        `Step "${step.name}": cannot set both forEach and step-level producePrompt/rubric.`,
      );
    }
    if (!step.forEach && (!step.producePrompt || !step.rubric)) {
      throw new Error(
        `Step "${step.name}": must set either forEach or both producePrompt and rubric.`,
      );
    }
  }
}

export async function runSprint(opts: RunSprintOptions): Promise<SprintResult> {
  const { recipe, sprintDir, sprintId, onMaxRepeat } = opts;
  // Per Phase 2.0 #2: every sprint owns its own .git/, and engine git ops
  // MUST target the sprint's repo only. Hardcoded to sprintDir — never use
  // process.cwd() or any caller-supplied value (see I6 post-mortem).
  const gitCwd: string = sprintDir;
  validateRecipe(recipe);
  validateRecipeIntent(recipe);

  // Phase 7.3 — per-sprint config: read at every entry into runSprint
  // (init AND resume) so user edits between `ag init` and `ag run`, or
  // before a resume, take effect. resolveEffectiveConfig fills in
  // recipe-level defaults for any field the user did not set and seeds
  // per-step gateRequired from gate.defaultMode (7.3.x amendment).
  const userConfig = loadConfig(sprintDir, recipe);
  const effectiveConfig: EffectiveConfig = resolveEffectiveConfig(recipe, userConfig);

  const startFromStepIdx = opts.startFromStepIdx ?? 0;
  if (startFromStepIdx < 0 || startFromStepIdx >= recipe.steps.length) {
    throw new Error(
      `startFromStepIdx=${startFromStepIdx} is out of bounds for recipe with ${recipe.steps.length} steps.`,
    );
  }
  const store = new StateStore(sprintDir);
  let state: ReturnType<StateStore["init"]>;
  if (startFromStepIdx === 0) {
    const existing = store.load();
    if (existing?.phase === "initialized") {
      // Sprint skeleton was written by `ag init` (Phase 7.2): state.json,
      // INPUT.md, agentflow.config.json, sprint-init tag are all already
      // on disk. Hydrate instead of re-initialising so the user-edited
      // INPUT.md / config / recipeOptions survive the transition into
      // step execution.
      state = existing;
      state.phase = undefined;
      state.lastEventTs = new Date().toISOString();
      if (opts.recipeOptions !== undefined) state.recipeOptions = opts.recipeOptions;
      store.save(state);
      store.emit({
        type: "sprint-started",
        msg: `recipe=${recipe.name} sprint=${sprintId} from=ag-init`,
      });
      // initSprintRepo + sprint-init tag are idempotent guarantees that
      // already hold here; the assert still runs as a defence in case
      // sprintDir was moved between `ag init` and this call.
      assertGitToplevel(gitCwd);
    } else {
      state = store.init(recipe.name, sprintId);
      state.recipeOptions = opts.recipeOptions;
      store.save(state);
      store.emit({ type: "sprint-started", msg: `recipe=${recipe.name} sprint=${sprintId}` });
      initSprintRepo(sprintDir);
      assertGitToplevel(gitCwd);
      gitCommit(["."], `chore(agentflow): sprint ${sprintId} init`, gitCwd);
      gitTag(sprintInitTagName(sprintId), gitCwd);
    }
  } else {
    const loaded = store.load();
    if (!loaded) {
      throw new Error(`Cannot resume: state.json missing at ${sprintDir}.`);
    }
    state = loaded;
    store.emit({
      type: "sprint-resumed",
      msg: `recipe=${recipe.name} sprint=${sprintId} fromStepIdx=${startFromStepIdx}`,
    });
  }

  // Snapshot the resolved config into state.recipeOptions.effectiveConfig
  // (Phase 7.3). Audit-only — `ag status`, `ag replay`, and post-mortems
  // read it to know what governed this run without re-merging defaults.
  state.recipeOptions = {
    ...(state.recipeOptions ?? {}),
    effectiveConfig: effectiveConfig as unknown as Record<string, unknown>,
  };
  store.save(state);

  const meter = newMeter();
  const priorArtifacts: Record<string, Artifact> = {};
  const priorIterations: Record<string, Record<string, Artifact>> = {};
  const perStep: SprintResult["perStep"] = [];

  // Hydrate prior step state from disk for resume.
  for (let k = 0; k < startFromStepIdx; k++) {
    const sk = recipe.steps[k]!;
    const dirName = `${String(k + 1).padStart(2, "0")}-${sk.name}`;
    const artifactPath = join(sprintDir, dirName, "output.md");
    const art = readArtifact(artifactPath);
    priorArtifacts[sk.name] = art;
    perStep.push({
      step: sk.name,
      score: art.frontmatter.score,
      attempts: art.frontmatter.attempts,
      tokens: 0,
      ...(sk.forEach ? { iterations: Number(art.frontmatter.iterations ?? 0) } : {}),
    });
    // For forEach steps, also hydrate per-iter artifacts.
    if (sk.forEach) {
      const ctxForSource: StepContext = { sprintId, sprintDir, priorArtifacts, priorIterations };
      const items = sk.forEach.source(ctxForSource);
      const map: Record<string, Artifact> = {};
      for (const item of items) {
        const iterPath = join(sprintDir, dirName, item.id, "output.md");
        if (existsSync(iterPath)) {
          map[item.id] = readArtifact(iterPath);
        }
      }
      priorIterations[sk.name] = map;
    }
  }

  for (let i = startFromStepIdx; i < recipe.steps.length; i++) {
    const step = recipe.steps[i]!;
    const stepDirName = `${String(i + 1).padStart(2, "0")}-${step.name}`;
    const stepDir = join(sprintDir, stepDirName);
    mkdirSync(stepDir, { recursive: true });

    const effective = effectiveConfig.steps[step.name]!;

    state.currentStepIdx = i;
    state.currentIteration = undefined;

    // Phase 7.3 — skipStep: no provider call, no Quality Loop, no gate.
    // Stub artifact carries frontmatter `skipped: true` so downstream
    // steps + resume hydration treat it identically to a normal pass
    // (score 0, attempts 0). Tag is still written so resume / replay
    // see a contiguous step chain.
    if (effective.skipStep) {
      const skipArtifact: Artifact = {
        frontmatter: {
          step: step.name,
          sprint: sprintId,
          score: 0,
          attempts: 0,
          provider: step.provider,
          generated_at: new Date().toISOString(),
          skipped: true,
        },
        body: "<!-- step skipped via agentflow.config.json (skipStep=true) -->",
      };
      writeArtifact(join(stepDir, "output.md"), skipArtifact);
      priorArtifacts[step.name] = skipArtifact;
      state.completedSteps.push(step.name);
      state.lastEventTs = new Date().toISOString();
      store.save(state);
      gitCommit(
        ["."],
        `chore(agentflow): ${step.name} skipped via config`,
        gitCwd,
      );
      gitTag(stepTagName(sprintId, i, step.name), gitCwd);
      store.emit({ type: "step-skipped", step: step.name });
      perStep.push({ step: step.name, score: 0, attempts: 0, tokens: 0 });
      continue;
    }

    store.save(state);
    store.emit({ type: "step-started", step: step.name });

    const ctx: StepContext = { sprintId, sprintDir, priorArtifacts, priorIterations };

    // Phase 7.3 — config overrides target/maxRepeat/provider/model when set.
    // Provider cascade per phase: config step-level `provider` feeds baseProvider;
    // recipe `step.perPhase.X.provider` overrides base for produce/fix. For the
    // REVIEW phase specifically, config `perPhase.review.provider` wins over the
    // recipe's `step.perPhase.review.provider`, which wins over base (review is
    // the only phase config can target per-phase today).
    const targetScore = effective.targetScore ?? step.targetScore ?? 9;
    const maxRepeat = effective.maxRepeat ?? step.maxRepeat ?? 3;
    const baseProvider = effective.provider ?? step.provider;
    const cfgModelOpt: ProviderRunOptions = effective.model ? { model: effective.model } : {};
    const produceProvider = step.perPhase?.produce?.provider ?? baseProvider;
    const reviewProvider =
      effective.perPhase?.review?.provider ?? step.perPhase?.review?.provider ?? baseProvider;
    const fixProvider = step.perPhase?.fix?.provider ?? baseProvider;
    const produceOptions = { ...step.runOptions, ...cfgModelOpt, ...step.perPhase?.produce?.runOptions };
    // reviewOptions precedence (last wins): step.runOptions < step-level config
    // model < recipe perPhase.review.runOptions < config perPhase.review.model.
    const reviewOptions = {
      ...step.runOptions,
      ...cfgModelOpt,
      ...step.perPhase?.review?.runOptions,
      ...(effective.perPhase?.review?.model ? { model: effective.perPhase.review.model } : {}),
    };
    const fixOptions = { ...step.runOptions, ...cfgModelOpt, ...step.perPhase?.fix?.runOptions };

    // Step-default runner triple + resolved providers. Per-iter forEach
    // overrides go through buildRunners() again with an override arg.
    const stepDefault = buildRunners(
      produceProvider, reviewProvider, fixProvider,
      produceOptions, reviewOptions, fixOptions,
    );
    const runners = stepDefault.runners;
    const stepResolved = stepDefault.resolved;

    // Helper: build onPhase that writes review files to `reviewsDir` and emits
    // a `phase` event tagged with optional iteration id. `resolved` carries
    // the effective providers (post per-iter override) so cost accounting
    // attributes calls to the right provider when an iter routes elsewhere.
    const makeOnPhase = (
      reviewsDir: string,
      resolved: ResolvedProviders,
      iteration?: string,
    ) => (ev: PhaseEvent) => {
      const n =
        ev.phase === "produce" ? ++counters.produce :
        ev.phase === "review" ? ++counters.review :
        ++counters.fix;
      const suffix = ev.fallback ? "-fallback" : "";
      const file = join(reviewsDir, `${ev.phase}_v${n}${suffix}.md`);
      mkdirSync(reviewsDir, { recursive: true });
      writeFileSync(file, ev.step.output, "utf-8");
      const providerName =
        ev.phase === "review"
          ? (ev.fallback ? (resolved.reviewFallback ?? resolved.review) : resolved.review)
          : ev.phase === "fix" ? resolved.fix
          : resolved.produce;
      recordCall(meter, providerName, ev.step);
      store.emit({
        type: "phase",
        step: step.name,
        iteration,
        attempt: ev.attempt,
        score: ev.score,
        tokens: ev.step.totalTokens,
        costUsd: ev.step.costUsd,
        msg: ev.fallback ? `${ev.phase}-fallback` : ev.phase,
        route: ev.step.route,
      });
    };

    // Counters are per phase-loop (one set per producer+reviewer+fixer cycle).
    // Declared here, reset per single-pass step OR per iteration.
    let counters = { produce: 0, review: 0, fix: 0 };

    let stepArtifact: Artifact;
    let stepForced = false;
    let stepFinalScore = 0;
    let stepAttempts = 0;
    let stepTotalTokens = 0;
    let stepIterations: number | undefined;
    let stepFinalOutput = "";
    // Phase 7.4 — IDs of `.agentflow-feedback/` records injected into this
    // step's prompt. Emitted as `feedback-consumed` after step-passed
    // so the audit trail closes the loop. Populated only by the
    // single-pass path for the 7.4 MVP; forEach injection is deferred.
    let injectedFeedbackIds: string[] = [];

    if (step.forEach) {
      // ─── forEach path ──────────────────────────────────────────────────
      const fe = step.forEach;
      const items = fe.source(ctx);
      if (items.length === 0) {
        throw new Error(`Step "${step.name}" forEach.source returned zero items.`);
      }
      const iterTarget = fe.targetScore ?? targetScore;
      const iterMaxRepeat = fe.maxRepeat ?? maxRepeat;
      const completedIters = state.completedIterations?.[step.name] ?? [];
      priorIterations[step.name] = priorIterations[step.name] ?? {};

      // Hydrate already-completed iters from disk so the aggregate step (and
      // any later steps that read priorIterations[name][id]) sees them.
      // Without this, a mid-forEach resume reaches the aggregate with only
      // the iters that ran during THIS process, and crashes on the others.
      for (const completedId of completedIters) {
        if (priorIterations[step.name]![completedId]) continue;
        const iterPath = join(stepDir, completedId, "output.md");
        if (existsSync(iterPath)) {
          priorIterations[step.name]![completedId] = readArtifact(iterPath);
        }
      }

      for (const item of items) {
        if (completedIters.includes(item.id)) continue;

        const iterDir = join(stepDir, item.id);
        mkdirSync(iterDir, { recursive: true });
        state.currentIteration = item.id;
        store.save(state);

        // Resolve per-iter override (Phase 5). When set, rebuild a
        // dedicated runner triple + resolved-provider tag for this iter;
        // otherwise reuse the step-default triple to keep the no-override
        // hot path zero-cost.
        const iterOverride = resolveItemOverride(fe, item, ctx);
        const iterRunnersBundle = iterOverride
          ? buildRunners(
              produceProvider, reviewProvider, fixProvider,
              produceOptions, reviewOptions, fixOptions,
              iterOverride,
            )
          : stepDefault;
        const iterRunners = iterRunnersBundle.runners;
        const iterResolved = iterRunnersBundle.resolved;

        store.emit({
          type: "iteration-started",
          step: step.name,
          iteration: item.id,
          ...(iterOverride ? { providerOverride: formatProviderOverride(iterOverride) } : {}),
        });

        // Phase 7.4.y — per-iter feedback ingestion. Iter sees step-wide
        // feedback (fb.iteration unset) plus its own iter-specific
        // feedback (fb.iteration === item.id). consumeFeedback flag
        // is step-level for this MVP (every iter inherits the same).
        const iterIngested = ingestFeedback({
          sprintDir,
          step: step.name,
          iteration: item.id,
        });
        const iterInjectFeedback =
          effective.consumeFeedback && iterIngested.contextBlock.length > 0;
        const iterHumanPrefix = iterInjectFeedback
          ? `${iterIngested.contextBlock}\n---\n\n`
          : "";

        const itemPrompt = iterHumanPrefix + fe.producePrompt(ctx, item);
        const itemRubric = iterHumanPrefix + (
          typeof fe.rubric === "function" ? fe.rubric(ctx, item) : fe.rubric
        );
        const reviewsDir = join(iterDir, "reviews");
        counters = { produce: 0, review: 0, fix: 0 };

        let iterLoopResult;
        try {
          iterLoopResult = await qualityLoop({
            producePrompt: itemPrompt,
            reviewPromptFor: (out) => buildReviewPrompt(itemRubric, out),
            fixPromptFor: (out, rev) => buildFixPrompt(itemRubric, out, rev),
            parseScore: defaultParseScore,
            targetScore: iterTarget,
            maxRepeat: iterMaxRepeat,
            onPhase: makeOnPhase(reviewsDir, iterResolved, item.id),
            preReview: step.preReview
              ? (output: string) => step.preReview!(ctx, output)
              : undefined,
            ...iterRunners,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          state.failedAt = {
            step: step.name,
            stepIdx: i,
            score: 0,
            attempts: 0,
            ts: new Date().toISOString(),
            reason: "runtime",
            errorMessage: message,
            iteration: item.id,
          };
          state.lastEventTs = state.failedAt.ts;
          store.save(state);
          store.emit({
            type: "iteration-failed",
            step: step.name,
            iteration: item.id,
            msg: `runtime: ${message}`,
          });
          store.emit({ type: "sprint-failed", step: step.name, msg: message });
          gitCommit(
            ["."],
            `chore(agentflow): sprint ${sprintId} crashed at ${step.name}/${item.id} (${message})`,
            gitCwd,
          );
          gitTag(sprintFailedTagName(sprintId), gitCwd);
          throw err;
        }

        let iterForced = false;
        if (!iterLoopResult.passed) {
          store.emit({
            type: "iteration-failed",
            step: step.name,
            iteration: item.id,
            attempt: iterLoopResult.attempts,
            score: iterLoopResult.finalScore,
            msg: `target=${iterTarget} maxRepeat=${iterMaxRepeat}`,
          });

          const decision: MaxRepeatDecision = onMaxRepeat
            ? await onMaxRepeat({
                step: step.name,
                stepIdx: i,
                iteration: item.id,
                finalScore: iterLoopResult.finalScore,
                targetScore: iterTarget,
                attempts: iterLoopResult.attempts,
                finalOutput: iterLoopResult.finalOutput,
              })
            : "abort";

          if (decision === "abort") {
            state.failedAt = {
              step: step.name,
              stepIdx: i,
              score: iterLoopResult.finalScore,
              attempts: iterLoopResult.attempts,
              ts: new Date().toISOString(),
              reason: "convergence",
              iteration: item.id,
            };
            state.lastEventTs = state.failedAt.ts;
            store.save(state);
            store.emit({ type: "sprint-failed", step: step.name });
            gitCommit(
              ["."],
              `chore(agentflow): sprint ${sprintId} failed at ${step.name}/${item.id} (score=${iterLoopResult.finalScore})`,
              gitCwd,
            );
            gitTag(sprintFailedTagName(sprintId), gitCwd);
            throw new Error(
              `Step "${step.name}" iteration "${item.id}" failed: score=${iterLoopResult.finalScore} after ${iterLoopResult.attempts} attempts (target=${iterTarget}).`,
            );
          }

          iterForced = true;
          store.emit({
            type: "iteration-force-passed",
            step: step.name,
            iteration: item.id,
            attempt: iterLoopResult.attempts,
            score: iterLoopResult.finalScore,
            msg: `force-pass: target=${iterTarget} actual=${iterLoopResult.finalScore}`,
          });
        }

        // Phase 7.4.y — iter-level RC gate. Re-read AFTER the Quality
        // Loop succeeded (PM may have resolved or filed a force-pass
        // during the run). Block is strict-iter: only RCs targeting
        // this iter halt it (step-wide RCs land in common-finalisation
        // for the aggregate instead).
        const iterBlock = checkRequestChangesBlock({
          sprintDir,
          step: step.name,
          iteration: item.id,
        });
        if (iterBlock.blocked) {
          state.failedAt = {
            step: step.name,
            stepIdx: i,
            score: iterLoopResult.finalScore,
            attempts: iterLoopResult.attempts,
            ts: new Date().toISOString(),
            reason: "convergence",
            iteration: item.id,
          };
          state.lastEventTs = state.failedAt.ts;
          store.save(state);
          store.emit({
            type: "step-blocked",
            step: step.name,
            iteration: item.id,
            msg: `open request-changes: ${iterBlock.blockingIds.join(",")}`,
          });
          store.emit({
            type: "sprint-failed",
            step: step.name,
            msg: `blocked by open request-changes at ${step.name}/${item.id}: ${iterBlock.blockingIds.join(",")}`,
          });
          gitCommit(
            ["."],
            `chore(agentflow): sprint ${sprintId} blocked at ${step.name}/${item.id} (open RC: ${iterBlock.blockingIds.join(",")})`,
            gitCwd,
          );
          gitTag(sprintFailedTagName(sprintId), gitCwd);
          throw new Error(
            `Step "${step.name}" iteration "${item.id}" blocked by ${iterBlock.blockingIds.length} open request-changes record(s): ` +
              `${iterBlock.blockingIds.join(", ")}. ` +
              `Resolve via \`ag resolve <sprintDir> --id <fb-id>\` or supersede with ` +
              `\`ag force-pass <sprintDir> --step ${step.name} --iter ${item.id}\`, then \`ag resume <sprintDir> --no-reset\`.`,
          );
        }

        const iterFm: ArtifactFrontmatter = {
          step: step.name,
          sprint: sprintId,
          score: iterLoopResult.finalScore,
          attempts: iterLoopResult.attempts,
          // Record the EFFECTIVE produce provider (after per-iter override),
          // not the step default — otherwise web UI / replay mis-label which
          // model actually authored this iter.
          provider: iterResolved.produce,
          generated_at: new Date().toISOString(),
          iteration: item.id,
          ...(iterForced ? { forced: true } : {}),
        };
        const iterArtifact: Artifact = { frontmatter: iterFm, body: iterLoopResult.finalOutput };
        writeArtifact(join(iterDir, "output.md"), iterArtifact);
        priorIterations[step.name]![item.id] = iterArtifact;

        const existing = state.completedIterations ?? {};
        const list = existing[step.name] ?? [];
        if (!list.includes(item.id)) list.push(item.id);
        state.completedIterations = { ...existing, [step.name]: list };
        state.lastEventTs = new Date().toISOString();
        store.save(state);

        gitCommit(
          ["."],
          `chore(agentflow): ${step.name}/${item.id} v${iterLoopResult.attempts} (score=${iterLoopResult.finalScore})`,
          gitCwd,
        );
        gitTag(iterationTagName(sprintId, i, step.name, item.id), gitCwd);

        store.emit({
          type: "iteration-passed",
          step: step.name,
          iteration: item.id,
          attempt: iterLoopResult.attempts,
          score: iterLoopResult.finalScore,
          tokens: iterLoopResult.totalTokens,
          costUsd: iterLoopResult.totalCostUsd,
        });

        if (iterInjectFeedback && iterIngested.consumedIds.length > 0) {
          store.emit({
            type: "feedback-consumed",
            step: step.name,
            iteration: item.id,
            msg: iterIngested.consumedIds.join(","),
          });
        }

        stepTotalTokens += iterLoopResult.totalTokens;
      }

      // Build aggregate index artifact.
      const iters = priorIterations[step.name]!;
      const ids = items.map((it) => it.id);
      const minScore = Math.min(...ids.map((id) => Number(iters[id]!.frontmatter.score)));
      const maxAttempts = Math.max(...ids.map((id) => Number(iters[id]!.frontmatter.attempts)));
      const allForced = ids.every((id) => !!iters[id]!.frontmatter.forced);
      const indexBody = [
        `# ${step.name} — ${ids.length} iteration${ids.length === 1 ? "" : "s"}`,
        "",
        ...ids.map((id) => {
          const a = iters[id]!;
          const sub = `${stepDirName}/${id}/output.md`;
          const flag = a.frontmatter.forced ? " *(forced)*" : "";
          const label = items.find((it) => it.id === id)?.label;
          return `- **${id}**${label ? ` — ${label}` : ""} — score=${a.frontmatter.score} attempts=${a.frontmatter.attempts}${flag} — \`${sub}\``;
        }),
      ].join("\n");

      stepFinalScore = minScore;
      stepAttempts = maxAttempts;
      stepForced = allForced;
      stepIterations = ids.length;
      stepFinalOutput = indexBody;

      stepArtifact = {
        frontmatter: {
          step: step.name,
          sprint: sprintId,
          score: stepFinalScore,
          attempts: stepAttempts,
          provider: baseProvider,
          generated_at: new Date().toISOString(),
          iterations: stepIterations,
          ...(stepForced ? { forced: true } : {}),
        },
        body: indexBody,
      };

      state.currentIteration = undefined;
      store.save(state);
    } else {
      // ─── single-pass path ─────────────────────────────────────────────
      // Phase 7.4: optionally prepend a `human_context` block sourced from
      // `.agentflow-feedback/` (maintainer feedback + open issues + recent
      // direct edits). Default: inject when consumeFeedback is true OR
      // when there is any open feedback for this step (the file beats the
      // flag — a PM filing a request-changes overrides a dev step's
      // `consumeFeedback: false`).
      const ingested = ingestFeedback({ sprintDir, step: step.name });
      const injectFeedback =
        effective.consumeFeedback && ingested.contextBlock.length > 0;
      const humanPrefix = injectFeedback
        ? `${ingested.contextBlock}\n---\n\n`
        : "";
      if (injectFeedback) injectedFeedbackIds = ingested.consumedIds;
      const producePrompt = humanPrefix + resolveProducePrompt(step, ctx);
      const rubricText = humanPrefix + resolveRubric(step, ctx);
      const reviewsDir = join(stepDir, "reviews");
      counters = { produce: 0, review: 0, fix: 0 };

      let loopResult;
      try {
        loopResult = await qualityLoop({
          producePrompt,
          reviewPromptFor: (out) => buildReviewPrompt(rubricText, out),
          fixPromptFor: (out, rev) => buildFixPrompt(rubricText, out, rev),
          parseScore: defaultParseScore,
          targetScore,
          maxRepeat,
          onPhase: makeOnPhase(reviewsDir, stepResolved),
          preReview: step.preReview
            ? (output: string) => step.preReview!(ctx, output)
            : undefined,
          ...runners,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.failedAt = {
          step: step.name,
          stepIdx: i,
          score: 0,
          attempts: 0,
          ts: new Date().toISOString(),
          reason: "runtime",
          errorMessage: message,
        };
        state.lastEventTs = state.failedAt.ts;
        store.save(state);
        store.emit({ type: "step-failed", step: step.name, msg: `runtime: ${message}` });
        store.emit({ type: "sprint-failed", step: step.name, msg: message });
        gitCommit(
          ["."],
          `chore(agentflow): sprint ${sprintId} crashed at step "${step.name}" (${message})`,
          gitCwd,
        );
        gitTag(sprintFailedTagName(sprintId), gitCwd);
        throw err;
      }

      // Persist the contract guard's verdict for the shipped artifact BEFORE
      // force-pass branching, so a force-passed MISMATCH still reaches readiness
      // (and an aborted run leaves a diagnostic). Idempotent upsert by
      // guardName+step+iterationId handles resume/rerun without stale decisions.
      const fg = loopResult.finalGuard;
      if (fg && fg.status !== "NONE") {
        const severity = guardSeverityFor(fg.status);
        if (severity) {
          try {
            upsertContractGuardDecision(sprintDir, {
              guardName: fg.guardName,
              step: step.name,
              iterationId: null,
              status: fg.status,
              source: fg.source ?? "explicit",
              severity,
              missingLiterals: fg.missingLiterals ?? [],
              missingFields: fg.missingFields ?? [],
              scoreCap: fg.scoreCap,
              attempt: loopResult.attempts,
              createdAt: new Date().toISOString(),
            });
          } catch (persistErr) {
            console.warn(
              `contract-guard persist failed for step "${step.name}": ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
            );
          }
        }
      }

      let forced = false;
      if (!loopResult.passed) {
        store.emit({
          type: "step-failed",
          step: step.name,
          attempt: loopResult.attempts,
          score: loopResult.finalScore,
          msg: `target=${targetScore} maxRepeat=${maxRepeat}`,
        });

        const decision: MaxRepeatDecision = onMaxRepeat
          ? await onMaxRepeat({
              step: step.name,
              stepIdx: i,
              finalScore: loopResult.finalScore,
              targetScore,
              attempts: loopResult.attempts,
              finalOutput: loopResult.finalOutput,
            })
          : "abort";

        if (decision === "abort") {
          state.failedAt = {
            step: step.name,
            stepIdx: i,
            score: loopResult.finalScore,
            attempts: loopResult.attempts,
            ts: new Date().toISOString(),
            reason: "convergence",
          };
          state.lastEventTs = state.failedAt.ts;
          store.save(state);
          store.emit({ type: "sprint-failed", step: step.name });
          gitCommit(
            ["."],
            `chore(agentflow): sprint ${sprintId} failed at step "${step.name}" (score=${loopResult.finalScore} after ${loopResult.attempts} attempts)`,
            gitCwd,
          );
          gitTag(sprintFailedTagName(sprintId), gitCwd);
          throw new Error(
            `Step "${step.name}" failed Quality Loop: score=${loopResult.finalScore} after ${loopResult.attempts} attempts (target=${targetScore}).`,
          );
        }

        forced = true;
        store.emit({
          type: "step-force-passed",
          step: step.name,
          attempt: loopResult.attempts,
          score: loopResult.finalScore,
          msg: `force-pass: target=${targetScore} actual=${loopResult.finalScore}`,
        });
      }

      stepFinalScore = loopResult.finalScore;
      stepAttempts = loopResult.attempts;
      stepTotalTokens = loopResult.totalTokens;
      stepForced = forced;
      stepFinalOutput = loopResult.finalOutput;
      stepArtifact = {
        frontmatter: {
          step: step.name,
          sprint: sprintId,
          score: stepFinalScore,
          attempts: stepAttempts,
          provider: baseProvider,
          generated_at: new Date().toISOString(),
          ...(stepForced ? { forced: true } : {}),
        },
        body: loopResult.finalOutput,
      };
    }

    // Phase 7.4.x — request-changes gate. Re-read feedback after the
    // Quality Loop so a PM stamping resolvedAt or filing a force-pass
    // record DURING the run is picked up. If any open request-changes
    // exists for this step AND no force-pass record supersedes the
    // most recent one, refuse to mark the step passed. Failure is
    // structural (not a runtime crash, not a convergence failure) so
    // it goes through its own `step-blocked` event before throwing.
    const block = checkRequestChangesBlock({ sprintDir, step: step.name });
    if (block.blocked) {
      state.failedAt = {
        step: step.name,
        stepIdx: i,
        score: stepFinalScore,
        attempts: stepAttempts,
        ts: new Date().toISOString(),
        reason: "convergence",
      };
      state.lastEventTs = state.failedAt.ts;
      store.save(state);
      store.emit({
        type: "step-blocked",
        step: step.name,
        msg: `open request-changes: ${block.blockingIds.join(",")}`,
      });
      store.emit({
        type: "sprint-failed",
        step: step.name,
        msg: `blocked by open request-changes: ${block.blockingIds.join(",")}`,
      });
      gitCommit(
        ["."],
        `chore(agentflow): sprint ${sprintId} blocked at step "${step.name}" (open RC: ${block.blockingIds.join(",")})`,
        gitCwd,
      );
      gitTag(sprintFailedTagName(sprintId), gitCwd);
      throw new Error(
        `Step "${step.name}" blocked by ${block.blockingIds.length} open request-changes record(s): ` +
          `${block.blockingIds.join(", ")}. ` +
          `Resolve via \`ag resolve <sprintDir> --id <fb-id>\` or supersede with ` +
          `\`ag force-pass <sprintDir> --step ${step.name}\`, then \`ag resume <sprintDir> --no-reset\`.`,
      );
    }

    // Common step-finalisation: write artifact + commit + step-done tag + step-passed event.
    writeArtifact(join(stepDir, "output.md"), stepArtifact);
    priorArtifacts[step.name] = stepArtifact;
    state.completedSteps.push(step.name);
    state.lastEventTs = new Date().toISOString();
    store.save(state);

    const itersSuffix = stepIterations !== undefined ? `/${stepIterations}-iters` : "";
    gitCommit(
      ["."],
      `chore(agentflow): ${step.name} v${stepAttempts}${itersSuffix} (score=${stepFinalScore})`,
      gitCwd,
    );
    gitTag(stepTagName(sprintId, i, step.name), gitCwd);

    store.emit({
      type: "step-passed",
      step: step.name,
      attempt: stepAttempts,
      score: stepFinalScore,
      tokens: stepTotalTokens,
    });

    if (injectedFeedbackIds.length > 0) {
      store.emit({
        type: "feedback-consumed",
        step: step.name,
        msg: injectedFeedbackIds.join(","),
      });
    }

    perStep.push({
      step: step.name,
      score: stepFinalScore,
      attempts: stepAttempts,
      tokens: stepTotalTokens,
      ...(stepIterations !== undefined ? { iterations: stepIterations } : {}),
    });

    // humanGate (unchanged; per-step, not per-iteration).
    if (opts.humanGate) {
      const artifactPath = join(stepDir, "output.md");
      const decision: HumanGateDecision = await opts.humanGate({
        step: step.name,
        stepIdx: i,
        score: stepFinalScore,
        attempts: stepAttempts,
        artifactPath,
        output: stepFinalOutput,
        completedSteps: [...state.completedSteps],
        forced: stepForced,
      });

      if (decision.kind === "rollback") {
        const target = decision.targetStepIdx;
        if (target < 0 || target > i) {
          throw new Error(
            `Invalid rollback target ${target} from step ${i} (must be 0..${i}).`,
          );
        }
        const prevTag =
          target === 0
            ? sprintInitTagName(sprintId)
            : stepTagName(sprintId, target - 1, recipe.steps[target - 1]!.name);
        store.emit({
          type: "rollback",
          step: step.name,
          msg: `from=${step.name} to=${recipe.steps[target]!.name} resetTo=${prevTag}${decision.note ? ` note=${decision.note}` : ""}`,
        });
        gitResetHard(prevTag, gitCwd);

        const restored = store.load();
        if (!restored) {
          throw new Error(`Rollback failed: state.json missing at ${prevTag}.`);
        }
        Object.assign(state, restored);
        for (let k = target; k < recipe.steps.length; k++) {
          delete priorArtifacts[recipe.steps[k]!.name];
          delete priorIterations[recipe.steps[k]!.name];
        }
        perStep.splice(target);
        i = target - 1;
        continue;
      }

      store.emit({
        type: "step-approved",
        step: step.name,
        msg: `gate=${decision.kind}${decision.note ? ` note=${decision.note}` : ""}`,
      });
    }
  }

  // Finalise sprint.
  store.emit({ type: "sprint-completed" });

  const readiness = buildReadinessReport(sprintDir);

  const summary: SprintSummary = {
    recipeName: recipe.name,
    sprintId,
    sprintDir,
    perStep,
    totalTokens: meter.totalTokens,
    totalCostUsd: meter.totalCostUsd,
    byProvider: meter.byProvider,
    completedAt: new Date().toISOString(),
    readiness: readiness.readiness,
    reviewVerdict: readiness.reviewVerdict,
    blockingCount: readiness.blockingCount,
    carryOvers: readiness.carryOvers,
  };
  writeFileSync(join(sprintDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  writeFileSync(join(sprintDir, "carry-over.json"), JSON.stringify(readiness, null, 2), "utf-8");

  gitCommit(
    ["."],
    `chore(agentflow): sprint ${sprintId} completed (${perStep.length} steps, $${meter.totalCostUsd.toFixed(4)})`,
    gitCwd,
  );
  gitTag(sprintDoneTagName(sprintId), gitCwd);

  return { passed: true, sprintId, sprintDir, meter, perStep };
}

// Re-export type for callers that consume ForEachItem from the recipe.
export type { ForEachItem };
