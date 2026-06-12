/**
 * Offline check: pr-review recipe can be loaded from the recipe
 * registry and exposes the expected PR review workflow shape.
 * Also verifies recipe execution behavior using offline mocks.
 *
 * Run: pnpm exec tsx tests/poc-pr-review.ts
 */
import assert from "node:assert/strict";
import { getRecipe } from "../src/recipe/registry.js";
import type { Recipe, StepDef } from "../src/recipe/types.js";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";

function assertSingleLineJsonRubric(step: StepDef): void {
  assert.equal(typeof step.rubric, "string");
  const rubric = step.rubric as string;
  assert.match(rubric, /Output ONLY a single-line JSON object/);
  assert.match(rubric, /"score": <0-10>/);
  assert.match(rubric, /"passed":/);
  assert.match(rubric, /"failed":/);
}

const recipe = await getRecipe("pr-review");

// 1. Verify recipe properties
{
  assert.equal(recipe.name, "pr-review");
  assert.match(recipe.description, /Pull Request/i);
  assert.deepEqual(recipe.steps.map((s) => s.name), [
    "analyze-diff",
    "review-code",
    "generate-feedback",
  ]);
}

// 2. Verify steps structure
{
  for (const step of recipe.steps) {
    assert.equal(step.provider, "claude");
    assert.equal(step.intent, "real-codebase");
    assert.equal(step.targetScore, 9);
    assert.equal(step.maxRepeat, 3);
    assert.equal(typeof step.producePrompt, "string");
    assertSingleLineJsonRubric(step);
  }
}

// 3. Sprint Mock Execution
let currentScenario = "clean";

mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
  const messages = rawRequest.messages;
  const userMessage = messages.find((m: any) => m.role === "user")?.content ?? "";

  // analyze-diff
  if (userMessage.includes("Inspect the git diff of the current Pull Request")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "Modified src/index.ts. Simple export change.",
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }
  if (userMessage.includes("Score the PR diff analysis report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Looks clean."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // review-code
  if (userMessage.includes("Perform a detailed code review of the changes")) {
    if (currentScenario === "buggy") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "- [blocking] Memory leak in setInterval, missing clearInterval.\n- [nit] trailing spaces.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "Code is logically correct, type-safe, and covered by tests.",
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }
  if (userMessage.includes("Score the code review report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "No issues found."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // generate-feedback
  if (userMessage.includes("Aggregate the review findings from previous steps")) {
    if (currentScenario === "buggy") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "# PR Review Verdict\n\nVerdict: REQUEST CHANGES\n\n## Tasks\n\n- [blocking] Memory leak in setInterval.\n- [nit] trailing spaces.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "# PR Review Verdict\n\nVerdict: APPROVE\n\nNo blocking issues.",
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }
  if (userMessage.includes("Score the final PR review feedback report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Report formatted perfectly."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  throw new Error(`Unexpected prompt in mock: ${userMessage.slice(0, 100)}`);
});

// Run clean PR sprint
{
  currentScenario = "clean";
  const tmp = mkdtempSync(join(tmpdir(), "ag-pr-test-clean-"));
  try {
    const sprintId = `pr-test-clean-${Date.now()}`;
    // Create necessary initial files
    writeFileSync(join(tmp, "INPUT.md"), "# PR Brief\n\nTest clean PR review.", "utf-8");
    writeFileSync(
      join(tmp, "agentflow.config.json"),
      `{ "recipe": "pr-review", "gate": { "defaultMode": "auto" } }`,
      "utf-8"
    );

    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId,
    });

    assert.equal(result.passed, true);
    assert.equal(result.perStep.length, 3);
    assert.equal(result.perStep[0]?.step, "analyze-diff");
    assert.equal(result.perStep[1]?.step, "review-code");
    assert.equal(result.perStep[2]?.step, "generate-feedback");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

// Run buggy PR sprint
{
  currentScenario = "buggy";
  const tmp = mkdtempSync(join(tmpdir(), "ag-pr-test-buggy-"));
  try {
    const sprintId = `pr-test-buggy-${Date.now()}`;
    // Create necessary initial files
    writeFileSync(join(tmp, "INPUT.md"), "# PR Brief\n\nTest buggy PR review.", "utf-8");
    writeFileSync(
      join(tmp, "agentflow.config.json"),
      `{ "recipe": "pr-review", "gate": { "defaultMode": "auto" } }`,
      "utf-8"
    );

    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId,
    });

    assert.equal(result.passed, true);
    assert.equal(result.perStep.length, 3);
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

console.log("poc-pr-review passed");
