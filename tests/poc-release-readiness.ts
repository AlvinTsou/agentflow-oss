/**
 * Offline check: release-readiness recipe can be loaded from the recipe
 * registry and exposes the expected release audit workflow shape.
 * Also verifies recipe execution behavior using offline mocks against fixtures.
 *
 * Run: pnpm exec tsx tests/poc-release-readiness.ts
 */
import assert from "node:assert/strict";
import { getRecipe } from "../src/recipe/registry.js";
import type { Recipe, StepDef } from "../src/recipe/types.js";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { parseReviewFindings } from "../src/workflow/readiness.js";
import { mkdtempSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// -------------------------------------------------------------
// Offline Mock Sprint Execution & Fixture Verification (Day 2)
// -------------------------------------------------------------

let currentScenario = "";

mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
  const messages = rawRequest.messages;
  const userMessage = messages.find((m: any) => m.role === "user")?.content ?? "";

  // 1. audit-changelog
  if (userMessage.includes("Analyze the git history and inspect the CHANGELOG.md")) {
    if (currentScenario === "missing-changelog") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "- [blocking] CHANGELOG.md does not exist in the workspace.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "CHANGELOG.md exists and is up to date.",
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  if (userMessage.includes("Score the Changelog audit report")) {
    if (currentScenario === "missing-changelog") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: `{"score": 5, "passed": ["C2"], "failed": ["C1", "C3"], "notes": "CHANGELOG.md is missing."}`,
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Changelog looks good."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // 2. check-version
  if (userMessage.includes("Compare the current version specified in package.json")) {
    if (currentScenario === "version-mismatch") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "- [deferred] package.json version 0.1.0 does not match latest release 0.2.0 in the changelog.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "package.json version matches.",
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  if (userMessage.includes("Score the version check report")) {
    if (currentScenario === "version-mismatch") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: `{"score": 6, "passed": ["C1", "C2"], "failed": ["C3"], "notes": "Version mismatch detected."}`,
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Version increment is correct."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // 3. validate-docs
  if (userMessage.includes("Analyze the recent source code changes and check if any new configuration")) {
    if (currentScenario === "missing-docs") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "- [nit] CLI options are not documented in the docs/ directory.",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "All features appropriately documented.",
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  if (userMessage.includes("Score the docs validation report")) {
    if (currentScenario === "missing-docs") {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: `{"score": 7, "passed": ["C1"], "failed": ["C2", "C3"], "notes": "Documentation gaps identified."}`,
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: `{"score": 10, "passed": ["C1", "C2", "C3"], "failed": [], "notes": "Documentation complete."}`,
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  // Fallback for fix phase
  if (userMessage.includes("You are a fixing agent.")) {
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "Fixed.",
        inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
      },
    };
  }

  throw new Error(`Unexpected LLM prompt in mock: ${userMessage.slice(0, 100)}`);
});

const scenarios = [
  {
    name: "missing-changelog",
    expectedCategory: "blocking" as const,
    expectedText: "CHANGELOG.md does not exist in the workspace.",
    stepName: "01-audit-changelog",
  },
  {
    name: "version-mismatch",
    expectedCategory: "deferred" as const,
    expectedText: "package.json version 0.1.0 does not match latest release 0.2.0 in the changelog.",
    stepName: "02-check-version",
  },
  {
    name: "missing-docs",
    expectedCategory: "nit" as const,
    expectedText: "CLI options are not documented in the docs/ directory.",
    stepName: "03-validate-docs",
  },
  {
    name: "release-ready",
    expectedCategory: null,
    expectedText: null,
    stepName: null,
  },
];

for (const sc of scenarios) {
  currentScenario = sc.name;

  const sprintId = `test-release-readiness-${sc.name}-${Date.now()}`;
  const sprintDir = mkdtempSync(join(tmpdir(), "ag-sprint-"));

  try {
    // Copy fixture files to sprint directory before running
    const fixtureDir = join(__dirname, "fixtures", "release-readiness", sc.name);
    cpSync(fixtureDir, sprintDir, { recursive: true });

    // Run the sprint with the release-readiness recipe
    const result = await runSprint({
      recipe,
      sprintDir,
      sprintId,
      onMaxRepeat: () => "force-pass", // force pass so we can inspect output.md after maxRepeat
    });

    assert.ok(result.passed);

    // Verify findings category matching
    if (sc.expectedCategory && sc.stepName) {
      const stepOutputDir = join(sprintDir, sc.stepName);
      const outputMdPath = join(stepOutputDir, "output.md");
      const outputMd = readFileSync(outputMdPath, "utf-8");

      const findings = parseReviewFindings(outputMd);
      assert.ok(findings.length > 0, `Scenario ${sc.name} should yield findings`);

      const found = findings.find((f) => f.severity === sc.expectedCategory);
      assert.ok(found, `Scenario ${sc.name} should yield ${sc.expectedCategory} finding`);
      assert.equal(found.text, sc.expectedText);
    } else {
      // release-ready scenario should have no blocking/deferred/nit findings
      for (const stepName of ["01-audit-changelog", "02-check-version", "03-validate-docs"]) {
        const stepOutputDir = join(sprintDir, stepName);
        const outputMdPath = join(stepOutputDir, "output.md");
        const outputMd = readFileSync(outputMdPath, "utf-8");
        const findings = parseReviewFindings(outputMd);
        const issues = findings.filter((f) => ["blocking", "deferred", "nit"].includes(f.severity));
        assert.equal(issues.length, 0, `release-ready scenario should have no issues, got: ${JSON.stringify(issues)}`);
      }
    }
  } finally {
    // Cleanup temporary sprint directory
    rmSync(sprintDir, { recursive: true, force: true });
  }
}

console.log("poc-release-readiness passed");
