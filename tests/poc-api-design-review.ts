/**
 * Offline check: api-design-review recipe can be loaded from the recipe
 * registry and exposes the expected API design review workflow shape.
 * Also verifies recipe execution behavior using offline mocks.
 *
 * Run: pnpm exec tsx tests/poc-api-design-review.ts
 */
import assert from "node:assert/strict";
import { getRecipe } from "../src/recipe/registry.js";
import type { StepDef } from "../src/recipe/types.js";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../src/workflow/sprint-repo.js";
import { mkdtempSync, rmSync, writeFileSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testTmpDir = join(__dirname, "tmp");
mkdirSync(testTmpDir, { recursive: true });

function assertSingleLineJsonRubric(step: StepDef): void {
  assert.equal(typeof step.rubric, "string");
  const rubric = step.rubric as string;
  assert.match(rubric, /Output ONLY a single-line JSON object/);
  assert.match(rubric, /"score":/);
  assert.match(rubric, /"passed":/);
  assert.match(rubric, /"failed":/);
}

const recipe = await getRecipe("api-design-review");

// 1. Verify recipe properties
{
  assert.equal(recipe.name, "api-design-review");
  assert.match(recipe.description, /API/i);
  assert.deepEqual(recipe.steps.map((s) => s.name), [
    "map-api-changes",
    "audit-api-standards",
    "generate-api-verdict",
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
let currentScenario = "clean-rest-api";

mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
  const messages = rawRequest.messages;
  const userMessage = messages.find((m: any) => m.role === "user")?.content ?? "";

  // 1. map-api-changes
  if (userMessage.includes("Map all touched API routes and payload models")) {
    if (currentScenario === "clean-rest-api") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "API Change Map: GET /api/v1/users added. Schema is clean camelCase.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "breaking-change") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "API Change Map: PUT /api/v1/users/:id modified. Schema fields deleted.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "non-standard-naming") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "API Change Map: POST /api/v1/users_list modified. Schema uses snake_case.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
  }

  if (userMessage.includes("Score the API change map report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Map is correct."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // 2. audit-api-standards
  if (userMessage.includes("Verify compliance with RESTful URL guidelines")) {
    if (currentScenario === "clean-rest-api") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "No API standard violations detected.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "breaking-change") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Findings:\n- [high] user-controller.ts: Removed response field 'email' (breaking change).",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "non-standard-naming") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Findings:\n- [medium] user-controller.ts: Naming convention uses snake_case instead of camelCase.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
  }

  if (userMessage.includes("Score the API standards audit findings report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Audit complete."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // 3. generate-api-verdict
  if (userMessage.includes("generate a final API design verdict report")) {
    if (currentScenario === "clean-rest-api") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Verdict: PASS\n\nAll designs conform to standards.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "breaking-change") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Verdict: BLOCK\n\nBreaking changes detected in user schemas.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "non-standard-naming") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Verdict: BLOCK\n\nNon-standard naming conventions detected.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
  }

  if (userMessage.includes("Score the final API design verdict report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Verdict registered."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  return {
    route: { provider: "claude" as const, reason: "mock" },
    request: rawRequest,
    result: {
      output: `{"score": 10, "passed": [], "failed": [], "notes": ""}`,
      inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
    },
  };
});

// Run scenarios
const SCENARIOS = ["clean-rest-api", "breaking-change", "non-standard-naming"];

for (const sc of SCENARIOS) {
  currentScenario = sc;
  const sprintId = `api-design-review-${sc}-${Date.now()}`;
  const tmp = mkdtempSync(join(testTmpDir, "api-review-"));
  initSprintRepo(tmp);

  try {
    // Copy fixture files to trigger git changes
    cpSync(join(__dirname, `fixtures/api-design-review/${sc}`), tmp, { recursive: true });

    // Initialize config and input
    writeFileSync(join(tmp, "INPUT.md"), `# API Design Review Brief\n\nTest for ${sc}.`, "utf-8");
    writeFileSync(
      join(tmp, "agentflow.config.json"),
      JSON.stringify({ recipe: "api-design-review", gate: { defaultMode: "auto" } }, null, 2),
      "utf-8"
    );

    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId,
    });

    assert.equal(result.passed, true);
    assert.equal(result.perStep.length, 3);
    assert.equal(result.perStep[0]?.step, "map-api-changes");
    assert.equal(result.perStep[1]?.step, "audit-api-standards");
    assert.equal(result.perStep[2]?.step, "generate-api-verdict");

    const lastOutput = readFileSync(join(tmp, "03-generate-api-verdict/output.md"), "utf-8");
    if (sc === "clean-rest-api") {
      assert.match(lastOutput, /Verdict:\s*PASS/);
    } else if (sc === "breaking-change" || sc === "non-standard-naming") {
      assert.match(lastOutput, /Verdict:\s*BLOCK/);
    }

  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

console.log("poc-api-design-review passed");
