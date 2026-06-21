/**
 * Offline check: multi-model consensus voting (C-8).
 * Verifies that the engine can run multiple model reviews in parallel,
 * aggregate their votes, and decide passing state based on the vote count.
 *
 * Run: pnpm exec tsx tests/poc-consensus-voting.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../src/workflow/sprint-repo.js";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";
import type { Recipe } from "../src/recipe/types.js";

const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });

async function runTest(minVotes: number, expectedPass: boolean) {
  const recipe: Recipe = {
    name: "test-consensus-voting",
    description: "Recipe to test multi-model consensus voting",
    steps: [
      {
        name: "voting-step",
        provider: "claude",
        intent: "synthetic",
        producePrompt: "produce something",
        rubric: "grade it",
        consensusVoting: {
          voters: [
            { provider: "claude" },
            { provider: "gemini" },
            { provider: "openai-compatible" },
          ],
          minVotesToPass: minVotes,
        },
      },
    ],
  };

  const voterScores = [10, 8, 9]; // claude=10, gemini=8, openai-compatible=9
  let callCount = 0;

  mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
    const userMessage = rawRequest.messages.find((m: any) => m.role === "user")?.content ?? "";

    if (userMessage.includes("Score") || userMessage.includes("JSON") || userMessage.includes("grade")) {
      const score = voterScores[callCount % 3];
      callCount++;
      const provider = _options?.provider ?? "claude";
      return {
        route: { provider, reason: "mock" },
        request: rawRequest,
        result: {
          output: `{"score": ${score}, "passed": [], "failed": [], "notes": "Voter graded ${score}"}`,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          durationMs: 2,
          costUsd: 0.00015,
          route: { provider, reason: "mock" },
        },
      };
    }

    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "produce output content",
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        durationMs: 3,
        costUsd: 0.0003,
        route: { provider: "claude", reason: "mock" },
      },
    };
  });

  const tmp = mkdtempSync(join(testTmpDir, "consensus-voting-"));
  initSprintRepo(tmp);

  writeFileSync(join(tmp, "INPUT.md"), "# Test Brief\n\nConsensus voting test", "utf-8");
  writeFileSync(
    join(tmp, "agentflow.config.json"),
    `{ "recipe": "test-consensus-voting", "gate": { "defaultMode": "auto" } }`,
    "utf-8",
  );

  try {
    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId: `test-consensus-voting-${minVotes}`,
    });
    assert.equal(result.passed, expectedPass);
  } catch (err) {
    if (expectedPass) {
      throw err;
    }
    assert.ok(err instanceof Error && err.message.includes("failed Quality Loop"));
  } finally {
    mock.reset();
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  // Test case 1: minVotes = 2.
  // Target score defaults to 9.
  // Voter scores: 10, 8, 9. Positive votes: 2 (10 and 9).
  // 2 >= 2 -> Expect pass.
  await runTest(2, true);
  console.log("ok  consensus voting test 1: minVotes=2 passed");

  // Test case 2: minVotes = 3.
  // Target score defaults to 9.
  // Voter scores: 10, 8, 9. Positive votes: 2 (10 and 9).
  // 2 >= 3 -> Expect fail.
  await runTest(3, false);
  console.log("ok  consensus voting test 2: minVotes=3 failed as expected");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
