/**
 * Offline check: replan & self-feeding loops (B-6).
 * Verifies that blocked sprints trigger follow-up sprints with Carry-Over.
 *
 * Run: pnpm exec tsx tests/poc-replan.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../src/workflow/sprint-repo.js";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { Recipe } from "../src/recipe/types.js";

const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });

const recipe: Recipe = {
  name: "test-replan",
  description: "Recipe to test replan and self-feeding loops",
  selfFeeding: {
    enabled: true,
    maxFollowUps: 2,
  },
  steps: [
    {
      name: "step-1",
      provider: "claude",
      intent: "synthetic",
      producePrompt: "prompt 1",
      rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
    },
    {
      name: "review",
      provider: "claude",
      intent: "synthetic",
      producePrompt: "prompt review",
      rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
    }
  ],
};

async function main() {
  // Mock middleman response
  mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest) => {
    const userMessage = rawRequest.messages.find((m: any) => m.role === "user")?.content ?? "";

    if (userMessage.includes("Score") || userMessage.includes("JSON")) {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: `{"score": 10, "passed": ["C1"], "failed": [], "notes": "ok"}`,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          durationMs: 2,
          costUsd: 0.00015,
        },
      };
    }

    if (userMessage.includes("review") || userMessage.includes("Verdict") || userMessage.includes("verdict")) {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: `## Verdict\n\nREQUEST CHANGES\n\n## Findings\n\n- T1 [blocking] critical bug in prototype`,
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
          durationMs: 3,
          costUsd: 0.0003,
        },
      };
    }

    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "artifact body",
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        durationMs: 3,
        costUsd: 0.0003,
      },
    };
  });

  const tmp = mkdtempSync(join(testTmpDir, "replan-"));
  initSprintRepo(tmp);

  writeFileSync(join(tmp, "INPUT.md"), "# Test Brief\n\nInitial task description", "utf-8");
  writeFileSync(
    join(tmp, "agentflow.config.json"),
    `{ "recipe": "test-replan", "gate": { "defaultMode": "auto" }, "selfFeeding": { "enabled": true, "maxFollowUps": 2 } }`,
    "utf-8"
  );

  try {
    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId: "test-sprint",
    });
    assert.equal(result.passed, true);

    // The sprint was blocked, so it should trigger self-feeding loops up to maxFollowUps (2).
    const followup1Dir = tmp + "-followup-1";
    const followup2Dir = tmp + "-followup-2";

    assert.ok(existsSync(followup1Dir), "followup-1 directory should be created");
    assert.ok(existsSync(followup2Dir), "followup-2 directory should be created");
    
    // Check follow-up 1 input contains carry-overs
    const followup1Input = readFileSync(join(followup1Dir, "INPUT.md"), "utf-8");
    assert.ok(followup1Input.includes("Carry-over from prior round"), "followup-1 input should contain carry-over header");
    assert.ok(followup1Input.includes("T1: critical bug in prototype"), "followup-1 input should contain carry-over finding");
    assert.ok(followup1Input.includes("Source sprint: test-sprint"), "followup-1 input should contain source sprint provenance");

    // Check follow-up 2 input contains carry-overs and stripped previous carry-overs
    const followup2Input = readFileSync(join(followup2Dir, "INPUT.md"), "utf-8");
    assert.ok(followup2Input.includes("Source sprint: test-sprint-followup-1"), "followup-2 input should reference followup-1 as source");
    
    // Verify that the original brief is preserved
    assert.ok(followup2Input.includes("Initial task description"), "original brief should be preserved in followup-2");

    console.log("ok  replan and self-feeding loop verified");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(tmp + "-followup-1", { recursive: true, force: true });
      rmSync(tmp + "-followup-2", { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
