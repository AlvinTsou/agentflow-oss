/**
 * Offline check: streaming checkpoint foundation (B-5).
 * Verifies that each Quality Loop phase appends a resumable checkpoint record
 * with management-dashboard metadata and a stable output hash.
 *
 * Run: pnpm exec tsx tests/poc-streaming-checkpoint.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../src/workflow/sprint-repo.js";
import { readStreamingCheckpoints, streamingCheckpointPath } from "../src/workflow/streaming-checkpoint.js";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";
import type { Recipe } from "../src/recipe/types.js";

const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });

const recipe: Recipe = {
  name: "test-streaming-checkpoint",
  description: "Recipe to test streaming checkpoint persistence",
  steps: [
    {
      name: "checkpoint-step",
      provider: "claude",
      intent: "synthetic",
      producePrompt: "produce checkpoint output",
      rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
    },
  ],
};

async function main() {
  mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
    const userMessage = rawRequest.messages.find((m: any) => m.role === "user")?.content ?? "";

    if (userMessage.includes("Score") || userMessage.includes("JSON")) {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: `{"score": 10, "passed": ["C1"], "failed": [], "notes": "checkpoint ok"}`,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          durationMs: 2,
          costUsd: 0.00015,
          route: { provider: "claude", reason: "mock" },
        },
      };
    }

    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "checkpoint produce artifact body",
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        durationMs: 3,
        costUsd: 0.0003,
        route: { provider: "claude", reason: "mock" },
      },
    };
  });

  const tmp = mkdtempSync(join(testTmpDir, "streaming-checkpoint-"));
  initSprintRepo(tmp);

  writeFileSync(join(tmp, "INPUT.md"), "# Test Brief\n\nStreaming checkpoint test", "utf-8");
  writeFileSync(
    join(tmp, "agentflow.config.json"),
    `{ "recipe": "test-streaming-checkpoint", "gate": { "defaultMode": "auto" } }`,
    "utf-8",
  );

  try {
    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId: "test-streaming-checkpoint-1",
    });
    assert.equal(result.passed, true);

    const path = streamingCheckpointPath(tmp);
    assert.ok(existsSync(path), "streaming-checkpoints.jsonl should be written");

    const checkpoints = readStreamingCheckpoints(tmp);
    assert.equal(checkpoints.length, 2, "produce and review checkpoints should be recorded");

    const produce = checkpoints.find((entry) => entry.phase === "produce");
    assert.ok(produce, "produce checkpoint exists");
    assert.equal(produce.step, "checkpoint-step");
    assert.equal(produce.attempt, 1);
    assert.equal(produce.provider, "claude");
    assert.equal(produce.tokens, 30);
    assert.equal(produce.artifactPath, "01-checkpoint-step/reviews/produce_v1.md");
    assert.equal(produce.outputPreview, "checkpoint produce artifact body");
    assert.equal(
      produce.outputSha256,
      createHash("sha256").update("checkpoint produce artifact body").digest("hex"),
    );

    const review = checkpoints.find((entry) => entry.phase === "review");
    assert.ok(review, "review checkpoint exists");
    assert.equal(review.score, 10);
    assert.equal(review.artifactPath, "01-checkpoint-step/reviews/review_v1.md");
    console.log("ok  streaming checkpoint records verified");
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
