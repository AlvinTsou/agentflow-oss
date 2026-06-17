/**
 * Offline check: security-review recipe can be loaded from the recipe
 * registry and exposes the expected security review workflow shape.
 * Also verifies recipe execution behavior using offline mocks.
 *
 * Run: pnpm exec tsx tests/poc-security-review.ts
 */
import assert from "node:assert/strict";
import { getRecipe } from "../src/recipe/registry.js";
import type { StepDef } from "../src/recipe/types.js";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { mkdtempSync, rmSync, writeFileSync, cpSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testTmpDir = join(__dirname, "tmp");
mkdirSync(testTmpDir, { recursive: true });
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

const recipe = await getRecipe("security-review");

// 1. Verify recipe properties
{
  assert.equal(recipe.name, "security-review");
  assert.match(recipe.description, /security/i);
  assert.deepEqual(recipe.steps.map((s) => s.name), [
    "map-security-scope",
    "audit-threats",
    "generate-security-verdict",
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
let currentScenario = "clean-config" as string;

mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
  const messages = rawRequest.messages;
  const userMessage = messages.find((m: any) => m.role === "user")?.content ?? "";

  // 1. map-security-scope
  if (userMessage.includes("Inspect the git diff of the current changes") && userMessage.includes("Produce a concise security risk map")) {
    if (currentScenario === "clean-config") {
      assert.match(userMessage, /maxRetryAttempts/);
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Security Risk Map: Only config.json modified. Class: configuration. Risk: low.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "unsafe-logging") {
      assert.match(userMessage, /password/);
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Security Risk Map: index.ts modified. Class: auth/logging. Risk: high.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "missing-auth") {
      assert.match(userMessage, /api\/admin\/data/);
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Security Risk Map: server.ts modified. Class: public API/routing. Risk: high.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "dependency-change") {
      assert.match(userMessage, /some-thirdparty-library/);
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Security Risk Map: package.json modified. Class: dependencies. Risk: medium.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "auth-plus-logging") {
      assert.match(userMessage, /pass/);
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Security Risk Map: server.ts modified. Class: auth/logging/routing. Risk: high.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "dependency-plus-config") {
      assert.match(userMessage, /another-thirdparty-library/);
      assert.match(userMessage, /maxRetryAttempts/);
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Security Risk Map: package.json and config.json modified. Class: dependencies/configuration. Risk: medium.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "clean-sensitive-name") {
      assert.match(userMessage, /auth-service\.ts/);
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Security Risk Map: auth-service.ts modified. Class: code. Risk: low.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
  }

  if (userMessage.includes("Score the security risk map report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Risk map is correct."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // 2. audit-threats
  if (userMessage.includes("Perform a security audit on the changed code from the git diff") && userMessage.includes("insecure defaults, unsafe logging")) {
    if (currentScenario === "clean-config") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "No security issues detected. Changes are configuration only.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "unsafe-logging") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Findings:\n- [high] index.ts:2-2 Unsafe logging of sensitive value 'pass' in console.log.\n  Preconditions: log access.\n  Fix: Remove pass from console.log.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "missing-auth") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Findings:\n- [high] server.ts:4-7 Missing authentication check on endpoint /api/admin/data.\n  Preconditions: public HTTP request.\n  Fix: Add middleware auth check.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "dependency-change") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Findings:\n- [medium] package.json:4-4 Added dependency some-thirdparty-library.\n  Preconditions: execution of third-party code.\n  Fix: Perform dependency analysis check.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "auth-plus-logging") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Findings:\n- [high] server.ts:10-10 Unsafe logging of password in console.log.\n- [high] server.ts:11-12 Missing authorization check on route /api/admin/data.\n  Preconditions: public HTTP request.\n  Fix: Add middleware auth and remove unsafe log.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "dependency-plus-config") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "Findings:\n- [medium] package.json:4-4 Added dependency another-thirdparty-library.\n  Preconditions: execution of third-party code.\n  Fix: Verify dependencies.\n- [low] config.json:2-3 Changed maxRetryAttempts.\n  Fix: Verify settings.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "clean-sensitive-name") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "No security issues detected. Code is completely clean.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
  }

  if (userMessage.includes("Score the security audit findings report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Audit complete."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // 3. generate-security-verdict
  if (userMessage.includes("Aggregate the security findings from previous steps") && userMessage.includes("PASS, PASS WITH FOLLOW-UP, or BLOCK")) {
    if (currentScenario === "clean-config") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "# Security Verdict\n\nVerdict: PASS\n\nNo issues detected. Public safe.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "unsafe-logging") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "# Security Verdict\n\nVerdict: BLOCK\n\nMandatory Fixes:\n- [blocking] Remove unsafe logging from index.ts.\n\nMaintainer Checklist:\n- [ ] Ensure logs do not contain passwords.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "missing-auth") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "# Security Verdict\n\nVerdict: BLOCK\n\nMandatory Fixes:\n- [blocking] Add auth check in server.ts.\n\nMaintainer Checklist:\n- [ ] Ensure endpoint requires tokens.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "dependency-change") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "# Security Verdict\n\nVerdict: PASS WITH FOLLOW-UP\n\nFollow-up:\n- [deferred] Verify some-thirdparty-library license and vulnerability database status.\n\nMaintainer Checklist:\n- [ ] Run security scan on thirdparty lib.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "auth-plus-logging") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "# Security Verdict\n\nVerdict: BLOCK\n\nMandatory Fixes:\n- [blocking] Remove unsafe logging and add auth check in server.ts.\n\nMaintainer Checklist:\n- [ ] Verify security status.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "dependency-plus-config") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "# Security Verdict\n\nVerdict: PASS WITH FOLLOW-UP\n\nFollow-up:\n- [deferred] Verify another-thirdparty-library.\n\nMaintainer Checklist:\n- [ ] Audit dependency.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    } else if (currentScenario === "clean-sensitive-name") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "# Security Verdict\n\nVerdict: PASS\n\nNo issues detected.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
  }

  if (userMessage.includes("Score the final security verdict report")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Verdict generated successfully."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  throw new Error(`Unexpected prompt in mock: ${userMessage.slice(0, 100)}`);
});

// Run scenarios
const scenarios = [
  "clean-config",
  "unsafe-logging",
  "missing-auth",
  "dependency-change",
  "auth-plus-logging",
  "dependency-plus-config",
  "clean-sensitive-name"
] as const;

for (const sc of scenarios) {
  currentScenario = sc;
  const tmp = mkdtempSync(join(testTmpDir, `ag-sec-test-${sc}-`));
  try {
    const sprintId = `sec-test-${sc}-${Date.now()}`;
    // Copy fixture
    cpSync(join(__dirname, `fixtures/security-review/${sc}`), tmp, { recursive: true });

    // Create necessary initial files
    writeFileSync(join(tmp, "INPUT.md"), `# Security Review Brief\n\nTest security review for ${sc}.`, "utf-8");
    writeFileSync(
      join(tmp, "agentflow.config.json"),
      `{ "recipe": "security-review", "gate": { "defaultMode": "auto" } }`,
      "utf-8"
    );

    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId,
    });

    assert.equal(result.passed, true);
    assert.equal(result.perStep.length, 3);
    assert.equal(result.perStep[0]?.step, "map-security-scope");
    assert.equal(result.perStep[1]?.step, "audit-threats");
    assert.equal(result.perStep[2]?.step, "generate-security-verdict");

    // Double check specific elements in output for each scenario
    const lastOutput = readFileSync(join(tmp, "03-generate-security-verdict/output.md"), "utf-8");
    if (sc === "clean-config") {
      assert.match(lastOutput, /Verdict:\s*PASS/);
    } else if (sc === "unsafe-logging") {
      assert.match(lastOutput, /Verdict:\s*BLOCK/);
      assert.match(lastOutput, /Remove unsafe logging/);
    } else if (sc === "missing-auth") {
      assert.match(lastOutput, /Verdict:\s*BLOCK/);
      assert.match(lastOutput, /Add auth check/);
    } else if (sc === "dependency-change") {
      assert.match(lastOutput, /Verdict:\s*PASS WITH FOLLOW-UP/);
      assert.match(lastOutput, /Verify some-thirdparty-library/);
    } else if (sc === "auth-plus-logging") {
      assert.match(lastOutput, /Verdict:\s*BLOCK/);
      assert.match(lastOutput, /Remove unsafe logging and add auth check/);
    } else if (sc === "dependency-plus-config") {
      assert.match(lastOutput, /Verdict:\s*PASS WITH FOLLOW-UP/);
      assert.match(lastOutput, /Verify another-thirdparty-library/);
    } else if (sc === "clean-sensitive-name") {
      assert.match(lastOutput, /Verdict:\s*PASS/);
    }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

console.log("poc-security-review passed");
