import type { Provider, ProviderRunOptions } from "../middleman/provider.js";
import type { Artifact } from "../artifacts/io.js";

/**
 * Per-step (or per-iteration) provider override. Subset of fields can
 * be set; unset fields fall through to the step's recipe-level default.
 *
 * Merge semantics (engine-applied):
 *   final.provider   = override.provider   ?? base.provider
 *   final.runOptions = { ...base.runOptions, ...(override.model ? { model } : {}), ...override.runOptions }
 *
 * Codex-specific runOptions (`reasoningEffort`,
 * `reasoningEffortMaxFor80kInput`) are auto-stripped from
 * `final.runOptions` when `final.provider !== "codex"` — safety net
 * against leaking ignored fields when callers swap to a different
 * provider.
 *
 * Used by SDDRecipeOptions.stepProviders (Phase 4) and by
 * ForEachConfig.providerForItemById / providerForItem (Phase 5).
 */
export interface StepProviderOverride {
  provider?: Provider;
  model?: string;
  runOptions?: ProviderRunOptions;
}

/**
 * Pure helper — applies an override to a (provider, options) pair,
 * with codex-tuning auto-drop. Returns the override-undefined inputs
 * unchanged. Exported for direct testing; sprint-engine uses this both
 * for step-default runner construction and per-iter rebuilds.
 */
export function applyProviderOverride(
  provider: Provider,
  options: ProviderRunOptions | undefined,
  override: StepProviderOverride | undefined,
): { provider: Provider; options: ProviderRunOptions } {
  if (!override) return { provider, options: { ...(options ?? {}) } };
  const finalProvider = override.provider ?? provider;
  let finalOptions: ProviderRunOptions = {
    ...(options ?? {}),
    ...(override.model ? { model: override.model } : {}),
    ...(override.runOptions ?? {}),
  };
  if (finalProvider !== "codex") {
    const { reasoningEffort, reasoningEffortMaxFor80kInput, ...rest } = finalOptions;
    finalOptions = rest;
  }
  return { provider: finalProvider, options: finalOptions };
}

export interface StepContext {
  sprintId: string;
  sprintDir: string;
  /** Aggregate artifact per completed step. For forEach steps this is the index. */
  priorArtifacts: Record<string, Artifact>;
  /**
   * Per-iteration artifacts for forEach steps that ran before this one.
   * Keyed by stepName then itemId. Empty for steps that did not use forEach.
   * Recipes that need to inline per-ticket bodies (e.g. wrap enumerating each
   * implementation) should read from here.
   */
  priorIterations: Record<string, Record<string, Artifact>>;
}

export type ProducePromptFn = (ctx: StepContext) => string;
export type RubricFn = (ctx: StepContext) => string;

export interface ForEachItem {
  /** Stable identifier — used in dir names, tag names, log lines. */
  id: string;
  /** Optional human label shown in logs. */
  label?: string;
  /** Free-form payload passed to producePrompt/rubric. */
  data: unknown;
}

export type ForEachSourceFn = (ctx: StepContext) => ForEachItem[];
export type ForEachProducePromptFn = (ctx: StepContext, item: ForEachItem) => string;
export type ForEachRubricFn = (ctx: StepContext, item: ForEachItem) => string;

export interface ForEachConfig {
  /** Parses the iteration list out of prior artifacts. Called once per step entry. */
  source: ForEachSourceFn;
  /** Per-item prompt; receives the item plus standard ctx. */
  producePrompt: ForEachProducePromptFn;
  /** Per-item rubric (function form for templating per-item ticket text). */
  rubric: string | ForEachRubricFn;
  /** Optional per-iteration overrides — fall back to step.targetScore / maxRepeat. */
  targetScore?: number;
  maxRepeat?: number;
  /** Maximum number of iterations to execute in parallel (A-4). Unset or 1 falls back to sequential. */
  maxConcurrent?: number;
  /**
   * Static per-id pin. Wins over `providerForItem` when both match.
   * Serializable — recipe factories that accept user input here should
   * snapshot the map into `state.recipeOptions` so `ag-resume`
   * reconstructs the same routing.
   *
   * Use for post-hoc outlier routing decisions ("iter T3 was a 21K
   * outlier in Run F, pin it to gemini next time") and CLI exposure.
   */
  providerForItemById?: Partial<Record<string, StepProviderOverride>>;
  /**
   * Dynamic policy. Called once per item BEFORE the item's Quality
   * Loop runs; receives the full ForEachItem (including data payload)
   * plus the step's StepContext. Return `undefined` to leave the
   * iteration on the step-level default.
   *
   * Use when routing depends on runtime data the recipe author cannot
   * pre-enumerate — e.g. the `[exploratory]` tag the research recipe
   * parses out of its plan step's LLM output.
   *
   * Not serializable. The recipe is reconstructed on resume and the
   * function is regenerated.
   */
  providerForItem?: (
    item: ForEachItem,
    ctx: StepContext,
  ) => StepProviderOverride | undefined;
}

/**
 * Pure helper — resolves the effective per-iter override by checking
 * the static byId map first, then falling through to the function form.
 * Exported for direct testing; sprint-engine consumes this inside the
 * forEach loop before rebuilding runners.
 */
export function resolveItemOverride(
  fe: ForEachConfig,
  item: ForEachItem,
  ctx: StepContext,
): StepProviderOverride | undefined {
  const pinned = fe.providerForItemById?.[item.id];
  if (pinned) return pinned;
  return fe.providerForItem?.(item, ctx);
}

/**
 * Per-phase override. Both fields are optional — anything left undefined falls
 * back to the step-level default. Used to give Producer tools (Read/Write/Bash)
 * while keeping Reviewer tool-less (otherwise the reviewer would execute code
 * instead of grading it).
 */
export interface PhaseConfig {
  provider?: Provider;
  runOptions?: ProviderRunOptions;
}

/**
 * Structured result a preReview hook may return instead of a plain string.
 * A plain `string` return keeps the legacy report-only behaviour (no clamp).
 * `scoreCap` (when present) makes the Quality Loop deterministically clamp the
 * review score, regardless of what the LLM reviewer scored. `guardName`/`status`
 * are carried for phase-event/debug trace and Slice 3 readiness.
 */
export interface PreReviewResult {
  guardName: string;
  status: "OK" | "MISMATCH" | "NONE" | "WARN";
  report: string;
  scoreCap?: number;
  /** Which guard path produced this verdict (contract guard only). */
  source?: "explicit" | "heuristic";
  /** Structured drift detail for persistence (contract guard only). */
  missingLiterals?: string[];
  missingFields?: string[];
}

export interface StepDef {
  /** Stable identifier — also the directory name and key in priorArtifacts. */
  name: string;
  /** Human-readable purpose of this step. */
  description?: string;
  /** Default provider for all three phases of the Quality Loop. */
  provider: Provider;
  /**
   * Optional per-phase override (provider and/or runOptions). Per AgentFlow
   * guide section 5. Each phase falls back to step-level `provider` /
   * `runOptions` when unset.
   */
  perPhase?: {
    produce?: PhaseConfig;
    review?: PhaseConfig;
    fix?: PhaseConfig;
  };
  /**
   * Either a literal prompt or a function that templates from prior artifacts.
   * Mutually exclusive with `forEach`: set one or the other, not both.
   */
  producePrompt?: string | ProducePromptFn;
  /**
   * Rubric markdown. Engine embeds it in the Review and Fix prompts automatically.
   * The rubric MUST instruct the reviewer to emit a single-line JSON
   * `{"score":N,"passed":[...],"failed":[...],"notes":"..."}` so the default
   * score parser can extract the score.
   *
   * Pass a function to template prior artifacts into the rubric — e.g. inline
   * the ticket text so the reviewer can verify acceptance criteria against it.
   * Without this, the reviewer is asked to grade against criteria it cannot
   * see, which is the root cause of false-positive passes.
   *
   * Mutually exclusive with `forEach`: set one or the other, not both.
   */
  rubric?: string | RubricFn;
  /**
   * When set, the step runs as a forEach: the engine parses an iteration list
   * via `source(ctx)`, then runs a Quality Loop PER item. Per-iter dir +
   * commit + tag (`<NN>-<step>/<itemId>-done`). After all iters pass, the
   * engine writes an aggregate index artifact at the step root, commits, and
   * tags `<NN>-<step>-done` as usual. Cross-iter feedback is opt-in via
   * `ctx.priorIterations[stepName][itemId]` in later steps.
   */
  forEach?: ForEachConfig;
  /** Pass threshold. Default 9. */
  targetScore?: number;
  /** Quality Loop max iterations. Default 3. */
  maxRepeat?: number;
  /**
   * Declares whether this step operates on synthetic content (engine input
   * only) or against a real codebase (filesystem read/write expected).
   *
   * Used by sprint-engine startup validation to catch the common bug of
   * mixing a synthetic brief with file-mutation tools, which causes the
   * provider to perform unintended real-codebase work. A step with
   * intent="synthetic" (the default when omitted) AND any of Write/Edit/Bash
   * in allowedTools will throw at sprint init.
   *
   * Default when omitted: "synthetic".
   */
  intent?: "synthetic" | "real-codebase";
  /**
   * Default runtime options forwarded to the provider for every phase
   * (timeout, tools, etc.). Override per phase via `perPhase[phase].runOptions`.
   */
  runOptions?: ProviderRunOptions;
  /**
   * Optional pre-review hook. The engine calls this before each review attempt
   * and injects the returned string into the reviewer prompt as a
   * `<!-- guard_report -->...<!-- /guard_report -->` block.
   *
   * Used to surface programmatic (non-LLM) checks into the Quality Loop
   * without making them a separate gate — the reviewer's rubric decides how
   * to grade based on the guard report. Force-pass via --gate still works.
   */
  preReview?: (
    ctx: StepContext,
    output: string,
  ) => string | PreReviewResult | Promise<string | PreReviewResult>;
  /**
   * Optional condition function. The engine evaluates this before running the
   * step. If it returns false, the step is skipped.
   */
  /**
   * Optional condition function. The engine evaluates this before running the
   * step. If it returns false, the step is skipped.
   */
  condition?: (ctx: StepContext) => boolean;
  /**
   * Optional multi-model consensus voting configuration for the review phase.
   */
  consensusVoting?: ConsensusVotingConfig;
}

export interface ConsensusVotingConfig {
  /** The list of providers (and optional model/runOptions overrides) participating in the vote. */
  voters: StepProviderOverride[];
  /** Minimum number of positive votes (score >= targetScore) required to pass. Defaults to Math.ceil(voters.length / 2). */
  minVotesToPass?: number;
}

export interface Recipe {
  /** Stable identifier, kebab-case. */
  name: string;
  /** Short human description. */
  description: string;
  /** Ordered list of steps. Sprint runs each in order. */
  steps: StepDef[];
  /** B-6 self-feeding default config */
  selfFeeding?: {
    enabled?: boolean;
    maxFollowUps?: number;
  };
}
