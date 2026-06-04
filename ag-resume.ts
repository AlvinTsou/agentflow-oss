import { loadProjectEnv } from "./src/util/load-env.js";
loadProjectEnv();
import { isAbsolute, resolve } from "node:path";
import { resumeSprint } from "./src/workflow/resume.js";
import { StateStore } from "./src/workflow/state-store.js";
import { sidecarHumanGate } from "./src/workflow/human-gate.js";
import { recipe as miniRecipe } from "./recipes/mini/recipe.js";
import { createSDDRecipe, type SDDRecipeOptions } from "./recipes/sdd/recipe.js";
import {
  createResearchRecipe,
  type ResearchRecipeOptions,
} from "./recipes/research/recipe.js";
import type { Recipe } from "./src/recipe/types.js";

interface ParsedResumeArgs {
  sprintDir: string;
  target?: number;
  /** undefined when not passed; ag-resume then falls back to state.recipeName. */
  recipeName?: string;
  skipReset: boolean;
  language: string;
  iterId?: string;
  /** When set, install sidecarHumanGate(dir) so an external controller
   *  can resolve the engine's human gate via a file drop. */
  gateDir?: string;
}

function parseArgs(argv: string[]): ParsedResumeArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.error(
      `Usage: pnpm exec tsx ag-resume.ts <sprintDir> [--step <idx>] [--iter <id>] [--recipe <name>] [--no-reset] [--language <name>] [--gate-dir <dir>]\n` +
        `  <sprintDir>       Path to the sprint directory (absolute or relative to cwd)\n` +
        `  --step <idx>      0-based step index to re-run (defaults to failedAt or currentStepIdx)\n` +
        `  --iter <id>       Re-run from this forEach iteration id (e.g. T3). Requires the\n` +
        `                    target step to be a forEach step.\n` +
        `  --recipe <name>   Recipe identifier (default: mini; also: sdd, research)\n` +
        `  --no-reset        Skip git reset --hard. Use when the engine has been patched\n` +
        `                    between failure and resume — reset would drop the new fixes.\n` +
        `  --language <name> (sdd only) Implementation language. MUST match the\n` +
        `                    language used on the original run, or remaining steps\n` +
        `                    will produce code in a different language.\n` +
        `  --gate-dir <dir>  Watch <dir>/.gate-decision.json for human-gate decisions\n` +
        `                    instead of reading stdin. Intended for external controllers.`,
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sprintDirRaw = args[0]!;
  const sprintDir = isAbsolute(sprintDirRaw) ? sprintDirRaw : resolve(process.cwd(), sprintDirRaw);
  let target: number | undefined;
  let recipeName: string | undefined;
  let skipReset = false;
  let language = "TypeScript";
  let iterId: string | undefined;
  let gateDir: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--step") {
      target = Number(args[++i]);
      if (!Number.isInteger(target)) throw new Error(`--step requires an integer; got ${args[i]}`);
    } else if (a === "--iter") {
      iterId = args[++i];
      if (!iterId) throw new Error(`--iter requires an id`);
    } else if (a === "--recipe") {
      recipeName = args[++i] ?? "";
    } else if (a === "--no-reset") {
      skipReset = true;
    } else if (a === "--language") {
      language = args[++i] ?? "TypeScript";
    } else if (a === "--gate-dir") {
      gateDir = args[++i];
      if (!gateDir) throw new Error(`--gate-dir requires a path`);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { sprintDir, target, recipeName, skipReset, language, iterId, gateDir };
}

interface SDDRecipeBuildOpts {
  language: string;
  reviewProvider?: import("./src/middleman/provider.js").Provider;
  reviewModel?: string;
  stepProviders?: SDDRecipeOptions["stepProviders"];
}

async function loadRecipe(
  name: string,
  sddOpts: SDDRecipeBuildOpts,
  researchOpts: ResearchRecipeOptions,
): Promise<Recipe> {
  // The CLI surface uses short keys (mini / sdd / research) but
  // the engine persists `recipe.name`, which can differ:
  //   - mini recipe.name === "mini-money-formatter" (the recipe's own id)
  // Both short and persisted names are accepted so resumes against
  // 7.2-init-prepared sprints land on the same recipe builder.
  if (name === "mini" || name === "mini-money-formatter") return miniRecipe;
  if (name === "sdd") {
    return createSDDRecipe({
      language: sddOpts.language,
      reviewProvider: sddOpts.reviewProvider,
      reviewModel: sddOpts.reviewModel,
      stepProviders: sddOpts.stepProviders,
    });
  }
  if (name === "research") {
    return createResearchRecipe(researchOpts);
  }
  // Future: dynamic import from `recipes/<name>/recipe.ts`
  throw new Error(`Unknown recipe "${name}". Known: mini, mini-money-formatter, sdd, research`);
}

async function main() {
  const { sprintDir, target, recipeName: cliRecipeName, skipReset, language, iterId, gateDir } =
    parseArgs(process.argv);

  // Load state to check for persisted recipeOptions.language
  const store = new StateStore(sprintDir);
  const state = store.load();
  // Phase 7.2: recipe name falls back to state.recipeName (written by
  // `ag init` or any prior runSprint init). Legacy CLI default "mini"
  // applies only when neither --recipe nor state.json is available.
  const recipeName = cliRecipeName ?? state?.recipeName ?? "mini";
  const recipeNameSource = cliRecipeName
    ? "--recipe flag"
    : state?.recipeName
      ? "state.recipeName"
      : "default";
  console.log(`[ag-resume] recipe=${recipeName} (from ${recipeNameSource})`);
  const recipeOptsFromState = (state?.recipeOptions ?? {}) as Record<string, unknown>;
  const persistedLanguage = typeof recipeOptsFromState.language === "string"
    ? (recipeOptsFromState.language as string)
    : undefined;
  const persistedReviewProvider = typeof recipeOptsFromState.reviewProvider === "string"
    ? (recipeOptsFromState.reviewProvider as SDDRecipeBuildOpts["reviewProvider"])
    : undefined;
  const persistedReviewModel = typeof recipeOptsFromState.reviewModel === "string"
    ? (recipeOptsFromState.reviewModel as string)
    : undefined;
  const persistedStepProviders =
    recipeOptsFromState.stepProviders && typeof recipeOptsFromState.stepProviders === "object"
      ? (recipeOptsFromState.stepProviders as SDDRecipeOptions["stepProviders"])
      : undefined;
  const effectiveLanguage = persistedLanguage ?? language;
  const languageSource = persistedLanguage ? "state.recipeOptions" : "--language flag";
  console.log(`[ag-resume] language=${effectiveLanguage} (from ${languageSource})`);
  if (persistedReviewProvider) {
    console.log(`[ag-resume] review=${persistedReviewProvider}${persistedReviewModel ? `:${persistedReviewModel}` : ""} (from state.recipeOptions)`);
  }
  if (persistedStepProviders && Object.keys(persistedStepProviders).length > 0) {
    const summary = Object.entries(persistedStepProviders)
      .map(([step, ov]) => `${step}:${ov?.provider ?? "?"}${ov?.model ? `=${ov.model}` : ""}`)
      .join(", ");
    console.log(`[ag-resume] stepProviders={${summary}} (from state.recipeOptions)`);
  }
  // Research recipes don't take language/reviewProvider; pinIters is the
  // only research-specific field worth hydrating here.
  const persistedPinIters =
    recipeOptsFromState.pinIters && typeof recipeOptsFromState.pinIters === "object"
      ? (recipeOptsFromState.pinIters as ResearchRecipeOptions["pinIters"])
      : undefined;
  if (persistedPinIters && Object.keys(persistedPinIters).length > 0) {
    const summary = Object.entries(persistedPinIters)
      .map(([iter, ov]) => `${iter}:${ov?.provider ?? "?"}${ov?.model ? `=${ov.model}` : ""}`)
      .join(", ");
    console.log(`[ag-resume] pinIters={${summary}} (from state.recipeOptions)`);
  }

  const recipe = await loadRecipe(
    recipeName,
    {
      language: effectiveLanguage,
      reviewProvider: persistedReviewProvider,
      reviewModel: persistedReviewModel,
      stepProviders: persistedStepProviders as SDDRecipeOptions["stepProviders"],
    },
    {
      stepProviders: persistedStepProviders as ResearchRecipeOptions["stepProviders"],
      pinIters: persistedPinIters,
    },
  );
  console.log(
    `[ag-resume] sprintDir=${sprintDir} recipe=${recipeName} target=${target ?? "auto"} iter=${iterId ?? "—"} skipReset=${skipReset}${recipeName === "sdd" ? ` language=${effectiveLanguage}` : ""}`,
  );
  const humanGate = gateDir ? sidecarHumanGate(gateDir) : undefined;
  if (gateDir) {
    console.log(`[ag-resume] gate=sidecar dir=${gateDir}`);
  }
  const result = await resumeSprint({
    recipe,
    sprintDir,
    targetStepIdx: target,
    iterId,
    skipReset,
    humanGate,
  });
  console.log(`\n[ag-resume] resumed. perStep:`);
  for (const s of result.perStep) {
    console.log(`  ${s.step.padEnd(10)} score=${s.score} attempts=${s.attempts}`);
  }
}

main().catch((err) => {
  console.error("[ag-resume] fatal:", err.message);
  process.exit(1);
});
