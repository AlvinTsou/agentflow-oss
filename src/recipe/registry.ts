import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Recipe } from "./types.js";

// Static TS recipes
import { recipe as miniRecipe } from "../../recipes/mini/recipe.js";
import { createSDDRecipe } from "../../recipes/sdd/recipe.js";
import { createResearchRecipe } from "../../recipes/research/recipe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECIPES_DIR = join(__dirname, "../../recipes");

export interface RecipeLoadOptions {
  language?: string;
  reviewProvider?: import("../middleman/provider.js").Provider;
  reviewModel?: string;
  stepProviders?: Record<string, import("../recipe/types.js").StepProviderOverride>;
  pinIters?: Partial<Record<string, import("../recipe/types.js").StepProviderOverride>>;
}

/**
 * Loads a recipe by name. Supports built-in TS recipes (mini, sdd, research)
 * and dynamically loads custom JSON recipes from the recipes/ directory.
 */
export async function getRecipe(
  name: string,
  options: RecipeLoadOptions = {}
): Promise<Recipe> {
  const normalizedName = name.replace(/^recipes\//, "");

  // 1. Check built-in static TS recipes
  if (normalizedName === "mini" || normalizedName === "mini-money-formatter") {
    return miniRecipe;
  }
  if (normalizedName === "sdd") {
    return createSDDRecipe({
      language: options.language ?? "TypeScript",
      reviewProvider: options.reviewProvider,
      reviewModel: options.reviewModel,
      stepProviders: options.stepProviders,
    });
  }
  if (normalizedName === "research") {
    return createResearchRecipe({
      stepProviders: options.stepProviders,
      pinIters: options.pinIters,
    });
  }

  // 2. Check dynamic JSON recipes under recipes/
  const jsonPath = join(RECIPES_DIR, `${normalizedName}.json`);
  if (existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed.name || !parsed.description || !Array.isArray(parsed.steps)) {
        throw new Error(`Invalid JSON recipe format in ${jsonPath}`);
      }
      return parsed as Recipe;
    } catch (err) {
      throw new Error(`Failed to load JSON recipe "${normalizedName}": ${(err as Error).message}`);
    }
  }

  throw new Error(
    `Unknown recipe "${name}". Known: mini, sdd, research, or custom JSON recipes in recipes/`
  );
}
