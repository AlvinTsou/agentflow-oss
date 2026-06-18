/**
 * Offline check: parallel forEach execution (A-4).
 * Verifies that the ForEach step respects the maxConcurrent configuration,
 * executing iterations concurrently up to the limit, and using Semaphore to guard the process.
 *
 * Run: pnpm exec tsx tests/poc-parallel-foreach.ts
 */
import assert from "node:assert/strict";
import os from "node:os";
import { mock } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 1. Mock homedir BEFORE running anything that resolves paths
const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });
const mockHome = mkdtempSync(join(testTmpDir, "home-mock-"));

mock.method(os, "homedir", () => mockHome);

import { runSprint } from "../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../src/workflow/sprint-repo.js";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";
import type { Recipe } from "../src/recipe/types.js";

const recipe: Recipe = {
  name: "test-parallel-foreach-recipe",
  description: "Recipe to test parallel forEach step execution and concurrency limit",
  steps: [
    {
      name: "step-parallel",
      provider: "claude",
      intent: "synthetic",
      forEach: {
        source: () => [
          { id: "item-1", data: null },
          { id: "item-2", data: null },
          { id: "item-3", data: null },
          { id: "item-4", data: null },
        ],
        maxConcurrent: 2,
        producePrompt: (_ctx, item) => `Produce prompt for ${item.id}`,
        rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
      },
    },
  ],
};

async function main() {
  let currentConcurrentCalls = 0;
  let maxObservedConcurrentCalls = 0;

  // Mock Middleman with delay to observe concurrency
  mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
    currentConcurrentCalls++;
    if (currentConcurrentCalls > maxObservedConcurrentCalls) {
      maxObservedConcurrentCalls = currentConcurrentCalls;
    }

    // Delay 100ms to allow parallel executions to overlap
    await new Promise((resolve) => setTimeout(resolve, 100));

    currentConcurrentCalls--;

    const messages = rawRequest.messages;
    const userMessage = messages.find((m: any) => m.role === "user")?.content ?? "";

    if (userMessage.includes("Score") || userMessage.includes("JSON") || userMessage.includes("rubric")) {
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
        output: "mock output content for parallel forEach",
        inputTokens: 200, outputTokens: 100, totalTokens: 300, durationMs: 1, costUsd: 0.003,
      },
    };
  });

  const tmp = mkdtempSync(join(testTmpDir, "parallel-foreach-"));
  initSprintRepo(tmp);

  // Write INPUT.md and config
  writeFileSync(join(tmp, "INPUT.md"), "# Test Brief\n\nParallel foreach test", "utf-8");
  writeFileSync(
    join(tmp, "agentflow.config.json"),
    `{ "recipe": "test-parallel-foreach-recipe", "gate": { "defaultMode": "auto" } }`,
    "utf-8"
  );

  const sprintId = "test-sprint-parallel-1";

  try {
    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId,
    });

    assert.equal(result.passed, true, "Sprint should complete successfully");

    // Check that we indeed observed concurrency greater than 1, but not exceeding maxConcurrent (2)
    assert.ok(
      maxObservedConcurrentCalls > 1,
      `Should run tasks concurrently (observed: ${maxObservedConcurrentCalls})`
    );
    assert.ok(
      maxObservedConcurrentCalls <= 2,
      `Should respect maxConcurrent limit of 2 (observed: ${maxObservedConcurrentCalls})`
    );

    // Verify iteration output artifacts
    for (const itemId of ["item-1", "item-2", "item-3", "item-4"]) {
      const iterPath = join(tmp, "01-step-parallel", itemId, "output.md");
      assert.ok(existsSync(iterPath), `Output artifact for ${itemId} should exist`);
    }

    console.log(`ok  Parallel forEach execution verified (maxConcurrent = 2, observed max concurrent = ${maxObservedConcurrentCalls})`);

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
