import { loadProjectEnv } from "./src/util/load-env.js";
loadProjectEnv();
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { runSprint } from "./src/workflow/sprint-engine.js";
import {
  createResearchRecipe,
  type ResearchRecipeOptions,
} from "./recipes/research/recipe.js";
import type { Provider } from "./src/middleman/errors.js";
import type { StepProviderOverride } from "./src/recipe/types.js";

const VALID_PROVIDERS: ReadonlySet<Provider> = new Set([
  "claude", "codex", "openai-compatible", "openrouter", "gemini",
]);
const PIN_ITER_ID_RE = /^Q\d+$/;
const PIN_FLAG_RE = /^(Q\d+)=([a-z-]+)(?::(.+))?$/;

/**
 * Parses one `--pin` argument value. Shape: `Q<n>=<provider>[:<model>]`.
 * Throws with a precise message on shape / provider / iter-id violation so
 * misuse fails fast at CLI parse time, before any sprint dir is created.
 */
export function parsePinSpec(spec: string): { iterId: string; override: StepProviderOverride } {
  const m = PIN_FLAG_RE.exec(spec);
  if (!m) {
    throw new Error(`--pin "${spec}" — expected shape Q<n>=<provider>[:<model>]`);
  }
  const [, iterId, provider, model] = m;
  if (!PIN_ITER_ID_RE.test(iterId!)) {
    throw new Error(`--pin "${spec}" — iter id must match /^Q\\d+$/, got "${iterId}"`);
  }
  if (!VALID_PROVIDERS.has(provider as Provider)) {
    throw new Error(
      `--pin "${spec}" — provider "${provider}" not in {${[...VALID_PROVIDERS].join(", ")}}`,
    );
  }
  const override: StepProviderOverride = { provider: provider as Provider };
  if (model) override.model = model;
  return { iterId: iterId!, override };
}

/**
 * `--lite-preset` for the Research recipe routes the four pure-prose
 * steps to Gemini Flash-Lite. It deliberately leaves `investigate`
 * untouched (its per-item routing via providerForItem is the demo for
 * Phase 5's per-iter override) and leaves `critique` on its
 * recipe-default Gemini Flash-Lite.
 */
const LITE_PRESET_STEP_PROVIDERS: NonNullable<ResearchRecipeOptions["stepProviders"]> = {
  frame:      { provider: "gemini", model: "gemini-3.1-flash-lite" },
  plan:       { provider: "gemini", model: "gemini-3.1-flash-lite" },
  synthesize: { provider: "gemini", model: "gemini-3.1-flash-lite" },
  finalize:   { provider: "gemini", model: "gemini-3.1-flash-lite" },
};

interface ParsedArgs {
  problemPath?: string;
  problem?: string;
  sprintIdPrefix: string;
  withGate: boolean;
  litePreset: boolean;
  pinIters: NonNullable<ResearchRecipeOptions["pinIters"]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.error(
      `Usage: pnpm exec tsx run-research.ts [--input <file>] [--problem "<text>"] [--prefix <id>] [--gate]\n` +
        `                                     [--lite-preset] [--pin Q<n>=<provider>[:<model>]]...\n` +
        `  --input <file>      Path to a markdown file with the research brief\n` +
        `  --problem "<text>"  Inline research brief\n` +
        `  --prefix <id>       Sprint id prefix (default: research)\n` +
        `  --gate              Interactive stdin gates (same semantics as run-sdd)\n` +
        `  --lite-preset       Route frame/plan/synthesize/finalize to gemini-3.1-flash-lite.\n` +
        `                      Leaves investigate's per-item routing intact and leaves critique\n` +
        `                      on its recipe-default gemini-3.1-flash-lite.\n` +
        `  --pin <spec>        Pin one investigate sub-question to a provider/model.\n` +
        `                      Repeatable. Shape: Q<n>=<provider>[:<model>].\n` +
        `                      Example: --pin Q3=gemini:gemini-3.1-flash-lite\n` +
        `                      Wins over the default [exploratory]->gemini routing.`,
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const out: ParsedArgs = {
    sprintIdPrefix: "research",
    withGate: false,
    litePreset: false,
    pinIters: {},
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--input") out.problemPath = args[++i];
    else if (a === "--problem") out.problem = args[++i];
    else if (a === "--prefix") out.sprintIdPrefix = args[++i] ?? "research";
    else if (a === "--gate") out.withGate = true;
    else if (a === "--lite-preset") out.litePreset = true;
    else if (a === "--pin") {
      const spec = args[++i];
      if (!spec) throw new Error(`--pin requires a value`);
      const { iterId, override } = parsePinSpec(spec);
      if (out.pinIters[iterId]) {
        throw new Error(`--pin ${iterId} specified more than once`);
      }
      out.pinIters[iterId] = override;
    }
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.problemPath && !out.problem) {
    throw new Error("Provide --input <file> or --problem \"<text>\".");
  }
  return out;
}

async function main() {
  const { problemPath, problem, sprintIdPrefix, withGate, litePreset, pinIters } = parseArgs(process.argv);
  const briefText = problemPath
    ? readFileSync(isAbsolute(problemPath) ? problemPath : resolve(process.cwd(), problemPath), "utf-8")
    : problem!;

  const stepProviders = litePreset ? LITE_PRESET_STEP_PROVIDERS : undefined;
  const hasPins = Object.keys(pinIters).length > 0;
  const recipeOpts: ResearchRecipeOptions = {
    ...(stepProviders ? { stepProviders } : {}),
    ...(hasPins ? { pinIters } : {}),
  };
  const recipe = createResearchRecipe(recipeOpts);
  const sprintId = `${sprintIdPrefix}-${Date.now()}`;
  const sprintDir = join(process.cwd(), "sprints", sprintId);
  mkdirSync(sprintDir, { recursive: true });
  writeFileSync(join(sprintDir, "INPUT.md"), briefText.trim() + "\n", "utf-8");

  console.log(`[run-research] recipe=${recipe.name} sprintId=${sprintId}`);
  console.log(`[run-research] sprintDir=${sprintDir}`);
  console.log(`[run-research] steps=${recipe.steps.map((s) => s.name).join(" -> ")}`);
  if (litePreset) {
    const liteSteps = Object.keys(LITE_PRESET_STEP_PROVIDERS).join(", ");
    console.log(`[run-research] lite-preset=on (gemini-3.1-flash-lite on: ${liteSteps})`);
  }
  if (hasPins) {
    const summary = Object.entries(pinIters)
      .map(([id, ov]) => `${id}=${ov!.provider}${ov!.model ? `:${ov!.model}` : ""}`)
      .join(", ");
    console.log(`[run-research] pinIters={${summary}}`);
  }
  console.log(`[run-research] gate=${withGate ? "stdin" : "none"}\n`);

  const gateModule = withGate ? await import("./src/workflow/human-gate.js") : null;
  const humanGate = gateModule?.stdinHumanGate;
  const onMaxRepeat = gateModule?.stdinOnMaxRepeat;

  const result = await runSprint({
    recipe,
    sprintDir,
    sprintId,
    humanGate,
    onMaxRepeat,
    recipeOptions: { ...recipeOpts },
  });

  console.log("\n[run-research] === SUMMARY ===");
  for (const s of result.perStep) {
    console.log(`  ${s.step.padEnd(11)} score=${s.score} attempts=${s.attempts} tokens=${s.tokens}`);
  }
  console.log(
    `  TOTAL tokens=${result.meter.totalTokens} cost=$${result.meter.totalCostUsd.toFixed(4)}`,
  );
  console.log(`  summary -> ${join(sprintDir, "summary.json")}\n`);
}

// Only execute as a script when invoked directly (e.g. `tsx run-research.ts`).
// Tests import parsePinSpec / parseArgs and must not trigger sprint creation.
const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedAsScript) {
  main().catch((err) => {
    console.error("[run-research] fatal:", err.message || err);
    process.exit(1);
  });
}
