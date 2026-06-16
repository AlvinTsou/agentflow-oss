import { loadProjectEnv } from "./src/util/load-env.js";
loadProjectEnv();
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, basename } from "node:path";
import { initSprintRepo } from "./src/workflow/sprint-repo.js";
import {
  assertGitToplevel,
  gitCommit,
  gitTag,
  sprintInitTagName,
} from "./src/workflow/git-checkpoint.js";
import { StateStore, type SprintState } from "./src/workflow/state-store.js";
import { getRecipe } from "./src/recipe/registry.js";
import type { SDDRecipeOptions } from "./recipes/sdd/recipe.js";
import type { ResearchRecipeOptions } from "./recipes/research/recipe.js";
import { parsePinSpec } from "./run-research.js";
import type { Recipe, StepDef } from "./src/recipe/types.js";
import type { Provider } from "./src/middleman/provider.js";
import { renderCarryOverSection } from "./src/workflow/readiness.js";
import type { ReadinessReport } from "./src/workflow/readiness.js";

const ALLOWED_REVIEW_PROVIDERS: ReadonlySet<Provider> = new Set([
  "codex", "claude", "gemini", "openrouter", "openai-compatible",
]);
const KNOWN_RECIPES = ["mini", "sdd", "research", "release-readiness", "pr-review", "security-review"] as const;
type KnownRecipe = (typeof KNOWN_RECIPES)[number];

interface ParsedInitArgs {
  recipe: KnownRecipe;
  problemPath?: string;
  problem?: string;
  sprintIdPrefix?: string;
  language?: string;
  reviewProvider?: Provider;
  reviewModel?: string;
  litePreset: boolean;
  pinIters: NonNullable<ResearchRecipeOptions["pinIters"]>;
  carryOver?: string;
  includeDeferred?: boolean;
}

function printHelp(): never {
  console.error(
    `Usage: pnpm exec tsx ag-init.ts <recipe> [opts]\n` +
      `  <recipe>            One of: ${KNOWN_RECIPES.join(" | ")}\n` +
      `\n` +
      `Brief:\n` +
      `  --input <file>          Markdown brief (required for sdd / research)\n` +
      `  --problem "<text>"      Inline brief\n` +
      `  --prefix <id>           Sprint id prefix (default matches recipe name)\n` +
      `\n` +
      `SDD:\n` +
      `  --language <name>       Default TypeScript\n` +
      `  --review-provider <p>   ${[...ALLOWED_REVIEW_PROVIDERS].join(" | ")}\n` +
      `  --review-model <id>     Model id for the review step\n` +
      `  --lite-preset           Route low-risk steps to gemini-3.1-flash-lite\n` +
      `\n` +
      `Research:\n` +
      `  --lite-preset           Route pure-prose steps to gemini-3.1-flash-lite\n` +
      `  --pin Q<n>=<provider>[:<model>]  Repeatable\n` +
      `\n` +
      `Writes <sprintDir>/{INPUT.md, agentflow.config.json, state.json},\n` +
      `initialises the sprint's own .git, and creates the sprint-init tag.\n` +
      `No LLM provider is invoked — use \`ag run <sprintDir>\` to start execution.`,
  );
  process.exit(2);
}

export function parseInitArgs(argv: string[]): ParsedInitArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") printHelp();
  const recipe = args[0]!;
  if (!(KNOWN_RECIPES as readonly string[]).includes(recipe)) {
    throw new Error(`Unknown recipe "${recipe}". Known: ${KNOWN_RECIPES.join(", ")}.`);
  }
  const out: ParsedInitArgs = {
    recipe: recipe as KnownRecipe,
    litePreset: false,
    pinIters: {},
  };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--input") out.problemPath = args[++i];
    else if (a === "--problem") out.problem = args[++i];
    else if (a === "--prefix") out.sprintIdPrefix = args[++i];
    else if (a === "--language") out.language = args[++i];
    else if (a === "--review-provider") {
      const v = args[++i];
      if (!v || !ALLOWED_REVIEW_PROVIDERS.has(v as Provider)) {
        throw new Error(
          `--review-provider must be one of: ${[...ALLOWED_REVIEW_PROVIDERS].join(", ")}`,
        );
      }
      out.reviewProvider = v as Provider;
    } else if (a === "--review-model") out.reviewModel = args[++i];
    else if (a === "--lite-preset") out.litePreset = true;
    else if (a === "--pin") {
      const spec = args[++i];
      if (!spec) throw new Error(`--pin requires a value`);
      const { iterId, override } = parsePinSpec(spec);
      if (out.pinIters[iterId]) throw new Error(`--pin ${iterId} specified more than once`);
      out.pinIters[iterId] = override;
    } else if (a === "--carry-over") {
      const v = args[++i];
      if (!v || v.startsWith("--")) throw new Error(`--carry-over requires a <prevSprintDir> path`);
      out.carryOver = v;
    } else if (a === "--include-deferred") out.includeDeferred = true;
    else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (out.includeDeferred && !out.carryOver) {
    throw new Error(`--include-deferred requires --carry-over`);
  }
  if (out.recipe !== "mini" && !out.problemPath && !out.problem) {
    throw new Error(`recipe "${out.recipe}" requires --input <file> or --problem "<text>".`);
  }
  if (out.recipe === "sdd" && !out.language) {
    out.language = "TypeScript";
  }
  if (out.litePreset && (out.reviewProvider || out.reviewModel) && out.recipe !== "research") {
    throw new Error(
      `--lite-preset already routes the review step; do not combine with --review-provider / --review-model.`,
    );
  }
  return out;
}

const SDD_LITE_PRESET_STEP_PROVIDERS: NonNullable<SDDRecipeOptions["stepProviders"]> = {
  discuss:   { provider: "gemini", model: "gemini-3.1-flash-lite" },
  explore:   { provider: "gemini", model: "gemini-3.1-flash-lite" },
  prototype: { provider: "gemini", model: "gemini-3.1-flash-lite" },
  wrap:      { provider: "gemini", model: "gemini-3.1-flash-lite" },
  review:    { provider: "gemini", model: "gemini-3.1-flash-lite" },
};

const RESEARCH_LITE_PRESET_STEP_PROVIDERS: NonNullable<ResearchRecipeOptions["stepProviders"]> = {
  frame:      { provider: "gemini", model: "gemini-3.1-flash-lite" },
  plan:       { provider: "gemini", model: "gemini-3.1-flash-lite" },
  synthesize: { provider: "gemini", model: "gemini-3.1-flash-lite" },
  finalize:   { provider: "gemini", model: "gemini-3.1-flash-lite" },
};

interface BuiltRecipe {
  recipe: Recipe;
  recipeOptions: Record<string, unknown>;
}

export async function buildRecipe(parsed: ParsedInitArgs): Promise<BuiltRecipe> {
  const stepProviders = parsed.litePreset
    ? parsed.recipe === "sdd"
      ? SDD_LITE_PRESET_STEP_PROVIDERS
      : RESEARCH_LITE_PRESET_STEP_PROVIDERS
    : undefined;

  const recipe = await getRecipe(parsed.recipe, {
    language: parsed.language,
    reviewProvider: parsed.reviewProvider,
    reviewModel: parsed.reviewModel,
    stepProviders,
    pinIters: parsed.pinIters,
  });

  return {
    recipe,
    recipeOptions: {
      ...(parsed.language ? { language: parsed.language } : {}),
      ...(parsed.reviewProvider ? { reviewProvider: parsed.reviewProvider } : {}),
      ...(parsed.reviewModel ? { reviewModel: parsed.reviewModel } : {}),
      ...(stepProviders ? { stepProviders } : {}),
      ...(parsed.pinIters ? { pinIters: parsed.pinIters } : {}),
    },
  };
}

interface SkeletonResult {
  sprintDir: string;
  sprintId: string;
  configPath: string;
}

/**
 * Render the agentflow.config.json stub as JSONC. The loader strips
 * `//` and `/ * * /` comments before JSON.parse (Phase 7.3), so the
 * header comment is documentation that travels with the file.
 *
 * The body itself is valid plain JSON — every step entry uses only
 * `targetScore` + `maxRepeat` as recipe defaults, so users can
 * uncomment-and-add-comma-free. The schema reference (full list of
 * per-step overrides + the forEach.pinIters shape) lives in the
 * header so users can copy field names without needing to keep the
 * trailing-comma rules straight inside `steps`.
 */
function renderConfigStubJsonc(recipe: Recipe, language?: string): string {
  const lines: string[] = [];
  lines.push(`// AgentFlow per-sprint config. JSONC: // and /* */ comments allowed.`);
  lines.push(`// Recipe-level defaults apply for any field you do not set.`);
  lines.push(`//`);
  lines.push(`// Top-level fields:`);
  lines.push(`//   "recipe":   string (must match the engine's recipe; mismatch warns)`);
  lines.push(`//   "language": string (replaces state.recipeOptions.language)`);
  lines.push(`//   "gate":     { "defaultMode": "auto" | "human-in-the-loop" }`);
  lines.push(`//   "steps":    per-step overrides (see below)`);
  lines.push(`//   "forEach":  per-step iteration pins, shape:`);
  lines.push(`//                 { "<stepName>": { "pinIters": { "<itemId>": "provider[:model]" } } }`);
  lines.push(`//`);
  lines.push(`// Per-step overrides accepted inside "steps":`);
  lines.push(`//   "skipStep":        boolean (stub the step, no provider call)`);
  lines.push(`//   "targetScore":     number  (Quality Loop pass threshold)`);
  lines.push(`//   "maxRepeat":       integer (Quality Loop max attempts)`);
  lines.push(`//   "onMaxRepeat":     "abort" | "force-pass" | "human-intervene"`);
  lines.push(`//   "provider":        "claude" | "codex" | "openai-compatible" | "openrouter" | "gemini" | "gemini-oauth"`);
  lines.push(`//   "model":           string (provider-specific model id)`);
  lines.push(`//   "gateRequired":    boolean (overrides gate.defaultMode for this step)`);
  lines.push(`//   "consumeFeedback": boolean (inject .agentflow-feedback/ feedback into prompt; default true)`);
  lines.push(`//   "perPhase":        { "review": { "provider": <provider>, "model": <id> } }`);
  lines.push(`//                      per-step review provider/model override (review phase only).`);
  lines.push(`//                      NOTE: antigravity is NOT recommended as a full SDD reviewer —`);
  lines.push(`//                      it can return empty output on large review prompts. The engine`);
  lines.push(`//                      now falls back to codex, but pin a reliable review provider here.`);
  lines.push(`//`);
  lines.push(`// Full schema reference: docs/feature-status.md.`);
  lines.push(`{`);
  lines.push(`  "recipe": ${JSON.stringify(recipe.name)},`);
  if (language) lines.push(`  "language": ${JSON.stringify(language)},`);
  lines.push(`  "gate": { "defaultMode": "auto" },`);
  lines.push(`  "steps": {`);
  const stepDefs = recipe.steps as StepDef[];
  stepDefs.forEach((step, idx) => {
    const isLast = idx === stepDefs.length - 1;
    const ts = step.targetScore ?? 9;
    const mr = step.maxRepeat ?? 3;
    lines.push(
      `    ${JSON.stringify(step.name)}: { "targetScore": ${ts}, "maxRepeat": ${mr} }${isLast ? "" : ","}`,
    );
  });
  lines.push(`  }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

/**
 * Resolve a `--carry-over <prevSprintDir>` into a markdown section for the new
 * INPUT. Hard-errors if the dir is absent (caller must invoke this BEFORE any
 * sprint mkdir/writeFile so a bad path never leaves a half-initialised sprint).
 * A missing/unparseable carry-over.json is non-fatal (warn + null).
 */
export function carryOverSectionFor(carryOverDir: string, includeDeferred: boolean): string | null {
  const dir = isAbsolute(carryOverDir) ? carryOverDir : resolve(process.cwd(), carryOverDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`--carry-over: sprint dir not found: ${carryOverDir}`);
  }
  const file = join(dir, "carry-over.json");
  if (!existsSync(file)) {
    console.warn(`[ag-init] --carry-over: no carry-over.json in ${carryOverDir} — skipping carry-over injection.`);
    return null;
  }
  let report: ReadinessReport;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as ReadinessReport).carryOvers)) {
      console.warn(`[ag-init] --carry-over: carry-over.json in ${carryOverDir} is not a readiness report — skipping.`);
      return null;
    }
    report = parsed as ReadinessReport;
  } catch {
    console.warn(`[ag-init] --carry-over: carry-over.json in ${carryOverDir} is unparseable — skipping.`);
    return null;
  }
  return renderCarryOverSection(report, basename(dir), { includeDeferred });
}

/**
 * Write the sprint skeleton without invoking any LLM provider. Idempotency
 * is intentionally NOT supported: re-running `ag init` against an existing
 * sprintDir would silently overwrite the user's edits to INPUT.md /
 * agentflow.config.json. Callers must pick a fresh sprintId.
 */
export function writeSprintSkeleton(args: {
  recipe: Recipe;
  recipeOptions: Record<string, unknown>;
  briefText: string;
  sprintDir: string;
  sprintId: string;
  language?: string;
}): SkeletonResult {
  const { recipe, recipeOptions, briefText, sprintDir, sprintId, language } = args;
  mkdirSync(sprintDir, { recursive: true });

  const inputPath = join(sprintDir, "INPUT.md");
  writeFileSync(inputPath, briefText.trim() + "\n", "utf-8");

  const configPath = join(sprintDir, "agentflow.config.json");
  writeFileSync(configPath, renderConfigStubJsonc(recipe, language), "utf-8");

  const now = new Date().toISOString();
  const state: SprintState = {
    recipeName: recipe.name,
    sprintId,
    currentStepIdx: 0,
    completedSteps: [],
    startedAt: now,
    lastEventTs: now,
    phase: "initialized",
    recipeOptions,
  };
  new StateStore(sprintDir).save(state);

  initSprintRepo(sprintDir);
  assertGitToplevel(sprintDir);
  gitCommit(["."], `chore(agentflow): sprint ${sprintId} init (ag init)`, sprintDir);
  gitTag(sprintInitTagName(sprintId), sprintDir);

  return { sprintDir, sprintId, configPath };
}

async function main(): Promise<void> {
  const parsed = parseInitArgs(process.argv);
  const briefText = parsed.problemPath
    ? readFileSync(
        isAbsolute(parsed.problemPath)
          ? parsed.problemPath
          : resolve(process.cwd(), parsed.problemPath),
        "utf-8",
      )
    : parsed.problem ?? "# Brief\n\n(Edit INPUT.md to fill in the brief before running.)\n";

  const { recipe, recipeOptions } = await buildRecipe(parsed);
  const prefix = parsed.sprintIdPrefix ?? parsed.recipe;
  const sprintId = `${prefix}-${Date.now()}`;
  const sprintDir = join(process.cwd(), "sprints", sprintId);

  let finalBrief = briefText;
  if (parsed.carryOver) {
    // Pre-flight BEFORE any sprint mkdir/writeFile: a bad --carry-over path
    // hard-errors here, leaving no half-initialised sprint.
    const section = carryOverSectionFor(parsed.carryOver, parsed.includeDeferred ?? false);
    if (section) finalBrief = `${briefText.trimEnd()}\n\n${section}\n`;
  }

  const result = writeSprintSkeleton({
    recipe,
    recipeOptions,
    briefText: finalBrief,
    sprintDir,
    sprintId,
    language: parsed.language,
  });

  console.log(`[ag-init] recipe=${recipe.name} sprintId=${sprintId}`);
  console.log(`[ag-init] sprintDir=${result.sprintDir}`);
  console.log(`[ag-init] steps=${recipe.steps.map((s) => s.name).join(" -> ")}`);
  console.log(`[ag-init] config=${result.configPath}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review/edit ${join(result.sprintDir, "INPUT.md")}`);
  console.log(`  2. Tune    ${result.configPath} (per-step targetScore / maxRepeat)`);
  console.log(`  3. Launch:    pnpm exec tsx ag.ts run ${result.sprintDir}`);
  console.log(`     or:        pnpm exec tsx ag.ts resume ${result.sprintDir}`);
}

const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /(?:^|[\\/])ag-init\.(?:ts|js)$/.test(process.argv[1]);
if (invokedAsScript) {
  main().catch((err) => {
    console.error("[ag-init] fatal:", (err as Error).message ?? err);
    process.exit(1);
  });
}
