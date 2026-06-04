/**
 * Offline check: Research recipe shape, sub-question parser, default
 * per-iter routing, pinIters precedence.
 *
 * Run: pnpm exec tsx tests/poc-research-recipe.ts
 */
import assert from "node:assert/strict";
import {
  createResearchRecipe,
  parseSubQuestionsFromBody,
  defaultProviderForSubQuestion,
  type ResearchSubQuestionData,
} from "../recipes/research/recipe.js";
import type { ForEachItem } from "../src/recipe/types.js";
import { parsePinSpec, parseArgs } from "../run-research.js";

function stepNamed(recipe: ReturnType<typeof createResearchRecipe>, name: string) {
  const step = recipe.steps.find((s) => s.name === name);
  if (!step) throw new Error(`step ${name} missing`);
  return step;
}

// Default recipe: 6 steps in expected order.
{
  const recipe = createResearchRecipe();
  const names = recipe.steps.map((s) => s.name);
  assert.deepEqual(names, [
    "frame", "plan", "investigate", "synthesize", "critique", "finalize",
  ]);
}

// Default per-step providers.
{
  const recipe = createResearchRecipe();
  assert.equal(stepNamed(recipe, "frame").provider, "claude");
  assert.equal(stepNamed(recipe, "plan").provider, "claude");
  assert.equal(stepNamed(recipe, "investigate").provider, "claude");
  assert.equal(stepNamed(recipe, "synthesize").provider, "claude");
  assert.equal(stepNamed(recipe, "critique").provider, "gemini");
  assert.equal(stepNamed(recipe, "critique").runOptions?.model, "gemini-3.1-flash-lite");
  assert.equal(stepNamed(recipe, "finalize").provider, "claude");
}

// targetScore deviations from canonical 9 are intentional.
{
  const recipe = createResearchRecipe();
  assert.equal(stepNamed(recipe, "frame").targetScore, 8);
  assert.equal(stepNamed(recipe, "plan").targetScore, 9);
  assert.equal(stepNamed(recipe, "synthesize").targetScore, 9);
  assert.equal(stepNamed(recipe, "critique").targetScore, 7);
  assert.equal(stepNamed(recipe, "finalize").targetScore, 8);
}

// Investigate is a forEach step with provider routing wired up.
{
  const recipe = createResearchRecipe();
  const investigate = stepNamed(recipe, "investigate");
  const fe = investigate.forEach;
  assert.ok(fe, "investigate.forEach must exist");
  assert.equal(typeof fe.source, "function");
  assert.equal(typeof fe.producePrompt, "function");
  assert.equal(typeof fe.rubric, "function");
  assert.equal(fe.targetScore, 9);
  assert.equal(typeof fe.providerForItem, "function");
  // pinIters not set -> providerForItemById is undefined or empty
  assert.ok(!fe.providerForItemById || Object.keys(fe.providerForItemById).length === 0);
}

// parseSubQuestionsFromBody — happy path: 3 Qs, mixed tags.
{
  const body = `
## Q1 [exploratory]: Framework history & positioning
- **Angle**: surveys what each framework set out to solve.
- **Deliverable**: claims + examples.

## Q2 [normative]: Performance characteristics for low-latency
- **Angle**: precise latency benchmarks per framework.
- **Deliverable**: numbers from authoritative sources.

## Q3 [exploratory]: Ecosystem maturity
- **Angle**: type support, middleware breadth.
`.trim();
  const items = parseSubQuestionsFromBody(body);
  assert.equal(items.length, 3);
  assert.equal(items[0]!.id, "Q1");
  assert.equal((items[0]!.data as ResearchSubQuestionData).tag, "exploratory");
  assert.equal(items[1]!.id, "Q2");
  assert.equal((items[1]!.data as ResearchSubQuestionData).tag, "normative");
  assert.equal(items[2]!.id, "Q3");
  assert.equal((items[2]!.data as ResearchSubQuestionData).tag, "exploratory");
  // Body for Q1 should contain header + bullets
  const q1Body = (items[0]!.data as ResearchSubQuestionData).body;
  assert.match(q1Body, /## Q1 \[exploratory\]:/);
  assert.match(q1Body, /surveys what each framework/);
}

// parseSubQuestionsFromBody — sloppy headers without a tag fail to match.
{
  const body = `## Q1: missing tag\n- this should not parse`;
  const items = parseSubQuestionsFromBody(body);
  assert.equal(items.length, 0);
}

// defaultProviderForSubQuestion routes by tag.
{
  const explor: ForEachItem = { id: "Q1", data: { tag: "exploratory", body: "" } };
  const ov = defaultProviderForSubQuestion(explor);
  assert.equal(ov?.provider, "gemini");
  assert.equal(ov?.model, "gemini-3.1-flash-lite");

  const norm: ForEachItem = { id: "Q2", data: { tag: "normative", body: "" } };
  assert.equal(defaultProviderForSubQuestion(norm), undefined);

  // Missing data -> undefined (graceful fallback).
  const missing: ForEachItem = { id: "Q3", data: {} };
  assert.equal(defaultProviderForSubQuestion(missing), undefined);
}

// pinIters takes precedence over the default exploratory routing in
// the engine's resolveItemOverride pipeline. We assert the recipe wires
// providerForItemById from opts.pinIters straight through to the forEach
// config; engine precedence is covered by poc-foreach-per-item-providers.
{
  const pinned = { Q1: { provider: "claude" as const } };
  const recipe = createResearchRecipe({ pinIters: pinned });
  const investigate = stepNamed(recipe, "investigate");
  assert.deepEqual(investigate.forEach!.providerForItemById, pinned);
}

// opts.stepProviders applies to the container step (not the forEach
// itself) — useful for routing synthesize / finalize through Gemini.
{
  const recipe = createResearchRecipe({
    stepProviders: {
      synthesize: { provider: "gemini", model: "gemini-3.1-flash-lite" },
    },
  });
  const synth = stepNamed(recipe, "synthesize");
  assert.equal(synth.provider, "gemini");
  assert.equal(synth.runOptions?.model, "gemini-3.1-flash-lite");
  // Other steps untouched
  assert.equal(stepNamed(recipe, "frame").provider, "claude");
  assert.equal(stepNamed(recipe, "finalize").provider, "claude");
}

// parsePinSpec — happy paths (provider only; provider + model).
{
  const a = parsePinSpec("Q1=gemini");
  assert.equal(a.iterId, "Q1");
  assert.equal(a.override.provider, "gemini");
  assert.equal(a.override.model, undefined);

  const b = parsePinSpec("Q12=gemini:gemini-3.1-flash-lite");
  assert.equal(b.iterId, "Q12");
  assert.equal(b.override.provider, "gemini");
  assert.equal(b.override.model, "gemini-3.1-flash-lite");

  const c = parsePinSpec("Q3=openai-compatible:gpt-4o");
  assert.equal(c.override.provider, "openai-compatible");
  assert.equal(c.override.model, "gpt-4o");
}

// parsePinSpec — validation errors fire BEFORE any side-effect.
{
  assert.throws(() => parsePinSpec("Q1"),                /expected shape/);
  assert.throws(() => parsePinSpec("T1=gemini"),         /expected shape/);
  assert.throws(() => parsePinSpec("Q=gemini"),          /expected shape/);
  assert.throws(() => parsePinSpec("Q1=bogus"),          /not in/);
  assert.throws(() => parsePinSpec("Q1=Claude"),         /expected shape/); // case-sensitive provider
}

// parseArgs — wires --pin into pinIters, repeatable, dup detected.
{
  const a = parseArgs([
    "node", "run-research.ts", "--problem", "p",
    "--pin", "Q1=gemini",
    "--pin", "Q3=claude",
  ]);
  assert.deepEqual(a.pinIters, {
    Q1: { provider: "gemini" },
    Q3: { provider: "claude" },
  });

  assert.throws(
    () => parseArgs(["node", "run-research.ts", "--problem", "p", "--pin", "Q1=gemini", "--pin", "Q1=claude"]),
    /more than once/,
  );

  assert.throws(
    () => parseArgs(["node", "run-research.ts", "--problem", "p", "--pin"]),
    /requires a value/,
  );
}

// --pin flows into createResearchRecipe via pinIters (engine-side wiring).
{
  const a = parseArgs([
    "node", "run-research.ts", "--problem", "p",
    "--pin", "Q2=gemini:gemini-3.1-flash-lite",
  ]);
  const recipe = createResearchRecipe({ pinIters: a.pinIters });
  const investigate = recipe.steps.find((s) => s.name === "investigate")!;
  assert.deepEqual(investigate.forEach!.providerForItemById, {
    Q2: { provider: "gemini", model: "gemini-3.1-flash-lite" },
  });
}

console.log("poc-research-recipe passed");
