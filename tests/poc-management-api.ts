/**
 * Offline check: management API contract and checkpoint integration (v1.7).
 * Verifies that the management API interfaces are typecheck-safe, getSprintSummary
 * correctly aggregates totals (tokens, cost, events, phase), and checkpoints are readable.
 *
 * Run: pnpm exec tsx tests/poc-management-api.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StateStore } from "../src/workflow/state-store.js";
import { getSprintSummary } from "../src/workflow/management-api.js";
import { appendStreamingCheckpoint, readStreamingCheckpoints } from "../src/workflow/streaming-checkpoint.js";

const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });

async function main() {
  const tmp = mkdtempSync(join(testTmpDir, "management-api-"));

  try {
    const store = new StateStore(tmp);
    store.init("test-recipe", "SPRINT_TEST_001");
    
    // Simulate events
    store.emit({
      type: "sprint-started",
      msg: "Sprint started",
    });

    store.emit({
      type: "step-started",
      step: "step-1",
    });

    store.emit({
      type: "phase",
      step: "step-1",
      attempt: 1,
      tokens: 1000,
      costUsd: 0.015,
      msg: "produce",
    });

    store.emit({
      type: "phase",
      step: "step-1",
      attempt: 1,
      tokens: 500,
      costUsd: 0.005,
      score: 8,
      msg: "review",
    });

    store.emit({
      type: "step-passed",
      step: "step-1",
      msg: "step-1 passed with readiness",
    });

    // Write a mock streaming checkpoint
    appendStreamingCheckpoint(tmp, {
      sprintId: "SPRINT_TEST_001",
      step: "step-1",
      phase: "review",
      attempt: 1,
      provider: "claude",
      score: 8,
      tokens: 500,
      costUsd: 0.005,
      durationMs: 1200,
      artifactPath: "01-step-1/reviews/review_v1.md",
      output: "mock checkpoint body content",
    });

    // Load Sprint Summary
    const summary = getSprintSummary(tmp);
    assert.ok(summary, "Summary should be loaded");
    assert.equal(summary.sprintId, "SPRINT_TEST_001");
    assert.equal(summary.recipeName, "test-recipe");
    assert.equal(summary.phase, "running");
    assert.equal(summary.totalTokens, 1500);
    assert.equal(summary.totalCostUsd, 0.02);
    assert.equal(summary.readiness, "ready");

    // Simulate completion
    store.emit({
      type: "sprint-completed",
      msg: "Sprint completed successfully",
    });

    const summaryCompleted = getSprintSummary(tmp);
    assert.ok(summaryCompleted);
    assert.equal(summaryCompleted.phase, "completed");

    // Verify streaming checkpoint
    const checkpoints = readStreamingCheckpoints(tmp);
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]?.sprintId, "SPRINT_TEST_001");
    assert.equal(checkpoints[0]?.outputPreview, "mock checkpoint body content");

    console.log("ok  management API contract and checkpoint verification passed");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
