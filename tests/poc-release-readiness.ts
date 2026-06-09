/**
 * Offline check: release-readiness recipe can be loaded from the recipe
 * registry and exposes the expected release audit workflow shape.
 *
 * Run: pnpm exec tsx tests/poc-release-readiness.ts
 */
import assert from "node:assert/strict";
import { getRecipe } from "../src/recipe/registry.js";
import type { Recipe, StepDef } from "../src/recipe/types.js";

function stepNamed(recipe: Recipe, name: string): StepDef {
  const step = recipe.steps.find((s) => s.name === name);
  if (!step) throw new Error(`step ${name} missing`);
  return step;
}

function assertSingleLineJsonRubric(step: StepDef): void {
  assert.equal(typeof step.rubric, "string");
  const rubric = step.rubric as string;
  assert.match(rubric, /Output ONLY a single-line JSON object/);
  assert.match(rubric, /"score": <0-10>/);
  assert.match(rubric, /"passed":/);
  assert.match(rubric, /"failed":/);
}

const recipe = await getRecipe("release-readiness");

// Registry loading should work without provider credentials or model calls.
{
  assert.equal(recipe.name, "release-readiness");
  assert.match(recipe.description, /release/i);
  assert.deepEqual(recipe.steps.map((s) => s.name), [
    "audit-changelog",
    "check-version",
    "validate-docs",
  ]);
}

// The recipe should be accepted with the same normalized path form supported
// by other registry callers.
{
  const byPath = await getRecipe("recipes/release-readiness");
  assert.equal(byPath.name, recipe.name);
  assert.deepEqual(byPath.steps.map((s) => s.name), recipe.steps.map((s) => s.name));
}

// Each step should be executable by the standard quality-loop contract.
{
  for (const step of recipe.steps) {
    assert.equal(step.provider, "claude");
    assert.equal(step.intent, "real-codebase");
    assert.equal(step.targetScore, 9);
    assert.equal(step.maxRepeat, 3);
    assert.equal(typeof step.producePrompt, "string");
    const producePrompt = step.producePrompt as string;
    assert.match(producePrompt, /Generate .*Markdown|Generate a .*report/i);
    assertSingleLineJsonRubric(step);
  }
}

// Step-specific release checks should cover the first-pass failure classes
// listed in the active maintenance plan.
{
  const changelog = stepNamed(recipe, "audit-changelog");
  assert.match(changelog.producePrompt as string, /CHANGELOG\.md/);
  assert.match(changelog.rubric as string, /CHANGELOG\.md exists/);

  const version = stepNamed(recipe, "check-version");
  assert.match(version.producePrompt as string, /package\.json/);
  assert.match(version.producePrompt as string, /latest release tag/i);
  assert.match(version.rubric as string, /SemVer/);

  const docs = stepNamed(recipe, "validate-docs");
  assert.match(docs.producePrompt as string, /source code changes/);
  assert.match(docs.producePrompt as string, /docs\/ directory/);
  assert.match(docs.rubric as string, /documentation gaps/i);
}

console.log("poc-release-readiness passed");
