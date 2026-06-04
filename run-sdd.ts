import { loadProjectEnv } from "./src/util/load-env.js";
loadProjectEnv();
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { runSprint } from "./src/workflow/sprint-engine.js";
import { createSDDRecipe, type SDDRecipeOptions } from "./recipes/sdd/recipe.js";
import type { Provider } from "./src/middleman/provider.js";

const ALLOWED_REVIEW_PROVIDERS: Provider[] = ["codex", "claude", "gemini", "openrouter", "openai-compatible"];

/**
 * `--lite-preset` routes the five low-risk steps (pure-prose or meta-rubric)
 * through Gemini Flash-Lite on the free tier; spec / usage / tkt / dev stay
 * on Claude for implementation-heavy work.
 */
const LITE_PRESET_STEP_PROVIDERS: NonNullable<SDDRecipeOptions["stepProviders"]> = {
  discuss:   { provider: "gemini", model: "gemini-3.1-flash-lite" },
  explore:   { provider: "gemini", model: "gemini-3.1-flash-lite" },
  prototype: { provider: "gemini", model: "gemini-3.1-flash-lite" },
  wrap:      { provider: "gemini", model: "gemini-3.1-flash-lite" },
  review:    { provider: "gemini", model: "gemini-3.1-flash-lite" },
};

interface ParsedArgs {
  problemPath?: string;
  problem?: string;
  sprintIdPrefix: string;
  withGate: boolean;
  language: string;
  reviewProvider?: Provider;
  reviewModel?: string;
  litePreset: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.error(
      `Usage: pnpm exec tsx run-sdd.ts [--input <file>] [--problem "<text>"] [--prefix <id>] [--gate]\n` +
        `                                [--language <name>] [--review-provider <name>] [--review-model <id>]\n` +
        `                                [--lite-preset]\n` +
        `  --input <file>          Path to a markdown file with the problem brief\n` +
        `  --problem "<text>"      Inline problem text\n` +
        `  --prefix <id>           Sprint id prefix (default: sdd)\n` +
        `  --gate                  Interactive stdin gates: after each step (approve/force-pass/rollback)\n` +
        `                          AND on max_repeat failure (abort/force-pass)\n` +
        `  --language <name>       Implementation language (default: TypeScript; also: Rust, Python, Go, JavaScript)\n` +
        `  --review-provider <p>   Provider for the review step (default: codex). One of:\n` +
        `                          ${ALLOWED_REVIEW_PROVIDERS.join(" | ")}\n` +
        `  --review-model <id>     Model id for the review step (provider-specific; e.g. gemini-3.1-flash-lite,\n` +
        `                          openrouter/free, anthropic/claude-haiku-4.5)\n` +
        `  --lite-preset           Route discuss/explore/prototype/wrap/review to gemini-3.1-flash-lite.\n` +
        `                          Leaves spec/usage/tkt/dev on Claude. Cannot be combined with\n` +
        `                          --review-provider / --review-model.`,
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const out: ParsedArgs = { sprintIdPrefix: "sdd", withGate: false, language: "TypeScript", litePreset: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--input") out.problemPath = args[++i];
    else if (a === "--problem") out.problem = args[++i];
    else if (a === "--prefix") out.sprintIdPrefix = args[++i] ?? "sdd";
    else if (a === "--gate") out.withGate = true;
    else if (a === "--language") out.language = args[++i] ?? "TypeScript";
    else if (a === "--review-provider") {
      const v = args[++i];
      if (!v || !ALLOWED_REVIEW_PROVIDERS.includes(v as Provider)) {
        throw new Error(`--review-provider must be one of: ${ALLOWED_REVIEW_PROVIDERS.join(", ")}`);
      }
      out.reviewProvider = v as Provider;
    } else if (a === "--review-model") out.reviewModel = args[++i];
    else if (a === "--lite-preset") out.litePreset = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.problemPath && !out.problem) {
    throw new Error("Provide --input <file> or --problem \"<text>\".");
  }
  if (out.litePreset && (out.reviewProvider !== undefined || out.reviewModel !== undefined)) {
    throw new Error(
      "--lite-preset already routes the review step; do not combine it with --review-provider / --review-model.",
    );
  }
  return out;
}

async function main() {
  const { problemPath, problem, sprintIdPrefix, withGate, language, reviewProvider, reviewModel, litePreset } =
    parseArgs(process.argv);
  const briefText = problemPath
    ? readFileSync(isAbsolute(problemPath) ? problemPath : resolve(process.cwd(), problemPath), "utf-8")
    : problem!;

  const stepProviders = litePreset ? LITE_PRESET_STEP_PROVIDERS : undefined;
  const recipe = createSDDRecipe({ language, reviewProvider, reviewModel, stepProviders });
  const sprintId = `${sprintIdPrefix}-${Date.now()}`;
  const sprintDir = join(process.cwd(), "sprints", sprintId);
  mkdirSync(sprintDir, { recursive: true });
  writeFileSync(join(sprintDir, "INPUT.md"), briefText.trim() + "\n", "utf-8");

  const reviewStep = recipe.steps.find((s) => s.name === "review");
  const reviewProviderEffective = reviewStep?.provider ?? "codex";
  const reviewModelEffective = reviewStep?.runOptions?.model;
  console.log(`[run-sdd] recipe=${recipe.name} sprintId=${sprintId} language=${language}`);
  console.log(`[run-sdd] sprintDir=${sprintDir}`);
  console.log(`[run-sdd] steps=${recipe.steps.map((s) => s.name).join(" -> ")}`);
  console.log(`[run-sdd] review=${reviewProviderEffective}${reviewModelEffective ? `:${reviewModelEffective}` : ""}`);
  if (litePreset) {
    const liteSteps = Object.keys(LITE_PRESET_STEP_PROVIDERS).join(", ");
    console.log(`[run-sdd] lite-preset=on (gemini-3.1-flash-lite on: ${liteSteps})`);
  }
  console.log(`[run-sdd] gate=${withGate ? "stdin" : "none"}\n`);

  const gateModule = withGate ? await import("./src/workflow/human-gate.js") : null;
  const humanGate = gateModule?.stdinHumanGate;
  const onMaxRepeat = gateModule?.stdinOnMaxRepeat;

  const result = await runSprint({
    recipe,
    sprintDir,
    sprintId,
    humanGate,
    onMaxRepeat,
    recipeOptions: { language, reviewProvider, reviewModel, stepProviders },
  });

  console.log("\n[run-sdd] === SUMMARY ===");
  for (const s of result.perStep) {
    console.log(`  ${s.step.padEnd(10)} score=${s.score} attempts=${s.attempts} tokens=${s.tokens}`);
  }
  console.log(
    `  TOTAL tokens=${result.meter.totalTokens} cost=$${result.meter.totalCostUsd.toFixed(4)}`,
  );
  console.log(`  summary -> ${join(sprintDir, "summary.json")}\n`);
}

main().catch((err) => {
  console.error("[run-sdd] fatal:", err.message || err);
  process.exit(1);
});
