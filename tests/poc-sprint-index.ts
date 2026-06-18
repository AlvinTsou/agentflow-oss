/**
 * Offline check: sprint outcome indexing (A-2).
 * Verifies that the SprintIndex class appends records correctly and that
 * sprint-engine calls SprintIndex on completion to index the sprint summary.
 *
 * Run: pnpm exec tsx tests/poc-sprint-index.ts
 */
import assert from "node:assert/strict";
import os from "node:os";
import { mock } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 1. Mock homedir BEFORE running anything that resolves paths
const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });
const mockHome = mkdtempSync(join(testTmpDir, "home-mock-"));

mock.method(os, "homedir", () => mockHome);

import { SprintIndex } from "../src/workflow/sprint-index.js";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../src/workflow/sprint-repo.js";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";
import type { Recipe } from "../src/recipe/types.js";

const recipe: Recipe = {
  name: "test-indexing-recipe",
  description: "Recipe to test sprint outcome indexing",
  steps: [
    {
      name: "step-one",
      provider: "claude",
      intent: "synthetic",
      producePrompt: "prompt-one",
      rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
    },
  ],
};

async function main() {
  // Mock Middleman so we don't hit real APIs
  mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
    const messages = rawRequest.messages;
    const userMessage = messages.find((m: any) => m.role === "user")?.content ?? "";

    if (userMessage.includes("Score") || userMessage.includes("JSON")) {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: `{"score": 10, "passed": ["C1"], "failed": [], "notes": "ok"}`,
          inputTokens: 100, outputTokens: 50, totalTokens: 150, durationMs: 1, costUsd: 0.0015,
        },
      };
    }
    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "step-one output content",
        inputTokens: 200, outputTokens: 100, totalTokens: 300, durationMs: 1, costUsd: 0.003,
      },
    };
  });

  // Test 1: Unit Test SprintIndex
  {
    const tempIndexFile = join(mockHome, "custom-index.jsonl");
    const index = new SprintIndex(tempIndexFile);
    index.record({
      sprintId: "unit-1",
      recipeName: "dummy",
      sprintDir: "/dummy/dir",
      completedAt: "2026-06-18T00:00:00Z",
      passed: true,
      totalTokens: 100,
      totalCostUsd: 0.002,
      readiness: "ready",
      reviewVerdict: "APPROVE",
      blockingCount: 0,
    });

    assert.ok(existsSync(tempIndexFile));
    const lines = readFileSync(tempIndexFile, "utf-8").trim().split("\n");
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]!);
    assert.equal(rec.sprintId, "unit-1");
    assert.equal(rec.recipeName, "dummy");
    assert.equal(rec.passed, true);
    console.log("ok  SprintIndex unit test passed");
  }

  // Test 2: Integration Test with runSprint
  const tmp = mkdtempSync(join(testTmpDir, "sprint-index-"));
  initSprintRepo(tmp);

  // Write INPUT.md and config
  writeFileSync(join(tmp, "INPUT.md"), "# Test Brief\n\nIndexing test", "utf-8");
  writeFileSync(
    join(tmp, "agentflow.config.json"),
    `{ "recipe": "test-indexing-recipe", "gate": { "defaultMode": "auto" } }`,
    "utf-8"
  );

  const sprintId = "test-sprint-index-1";

  try {
    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId,
    });

    assert.equal(result.passed, true);

    // Verify index record was written to the default index path (~/.agentflow/sprint-index.jsonl)
    // which has been mocked to mockHome/.agentflow/sprint-index.jsonl
    const defaultIndexPath = join(mockHome, ".agentflow", "sprint-index.jsonl");
    assert.ok(existsSync(defaultIndexPath), "Default sprint-index.jsonl should be created");

    const lines = readFileSync(defaultIndexPath, "utf-8").trim().split("\n");
    assert.equal(lines.length, 1);

    const rec = JSON.parse(lines[0]!);
    assert.equal(rec.sprintId, sprintId);
    assert.equal(rec.recipeName, "test-indexing-recipe");
    assert.equal(rec.passed, true);
    assert.equal(rec.sprintDir, tmp);
    assert.equal(rec.readiness, "unknown");
    assert.ok(rec.totalTokens > 0);
    assert.ok(rec.totalCostUsd > 0);
    console.log("ok  runSprint outcome indexing integration verified");

  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(mockHome, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
