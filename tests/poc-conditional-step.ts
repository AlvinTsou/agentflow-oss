/**
 * Offline check: conditional steps (A-3) skipping behavior.
 * Verifies that the sprint engine skips steps when the condition evaluates to false,
 * emits the step-condition-skipped event, and that ag-replay properly renders it.
 *
 * Run: pnpm exec tsx tests/poc-conditional-step.ts
 */
import assert from "node:assert/strict";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../src/workflow/sprint-repo.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { execSync } from "node:child_process";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";
import type { Recipe } from "../src/recipe/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testTmpDir = join(__dirname, "tmp");
mkdirSync(testTmpDir, { recursive: true });

const recipe: Recipe = {
  name: "test-conditional-steps",
  description: "Recipe to test conditional step skipping",
  steps: [
    {
      name: "step-one",
      provider: "claude",
      intent: "synthetic",
      producePrompt: "prompt-one",
      rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
    },
    {
      name: "step-two",
      provider: "claude",
      intent: "synthetic",
      producePrompt: "prompt-two",
      rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
      condition: () => false, // condition false -> should skip
    },
    {
      name: "step-three",
      provider: "claude",
      intent: "synthetic",
      producePrompt: "prompt-three",
      rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
      condition: () => true, // condition true -> should run
    },
  ],
};

async function main() {
  const calledSteps: string[] = [];

  // Mock Middleman so we don't hit real APIs
  mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
    const messages = rawRequest.messages;
    const userMessage = messages.find((m: any) => m.role === "user")?.content ?? "";

    if (userMessage.includes("prompt-one") || userMessage.includes("step-one")) {
      calledSteps.push("step-one");
      if (userMessage.includes("Score") || userMessage.includes("JSON")) {
        return {
          route: { provider: "claude" as const, reason: "mock" },
          request: rawRequest,
          result: {
            output: `{"score": 10, "passed": ["C1"], "failed": [], "notes": "step-one ok"}`,
            inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
          },
        };
      }
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "step-one output content",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
        },
      };
    }

    if (userMessage.includes("prompt-two") || userMessage.includes("step-two")) {
      calledSteps.push("step-two");
      throw new Error("step-two should have been skipped and never request the provider");
    }

    if (userMessage.includes("prompt-three") || userMessage.includes("step-three")) {
      calledSteps.push("step-three");
      if (userMessage.includes("Score") || userMessage.includes("JSON")) {
        return {
          route: { provider: "claude" as const, reason: "mock" },
          request: rawRequest,
          result: {
            output: `{"score": 10, "passed": ["C1"], "failed": [], "notes": "step-three ok"}`,
            inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, costUsd: 0,
          },
        };
      }
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: "step-three output content",
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

  const tmp = mkdtempSync(join(testTmpDir, "sprint-cond-"));
  initSprintRepo(tmp);

  // Write INPUT.md and config
  writeFileSync(join(tmp, "INPUT.md"), "# Test Brief\n\nCondition test", "utf-8");
  writeFileSync(
    join(tmp, "agentflow.config.json"),
    `{ "recipe": "test-conditional-steps", "gate": { "defaultMode": "auto" } }`,
    "utf-8"
  );

  const sprintId = "test-sprint-cond-1";

  try {
    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId,
    });

    // Verify result
    assert.equal(result.passed, true);
    assert.deepEqual(calledSteps.filter(s => s === "step-two"), [], "step-two should never be called");
    assert.ok(calledSteps.includes("step-one"), "step-one should be run");
    assert.ok(calledSteps.includes("step-three"), "step-three should be run");

    // Read events.jsonl
    const eventsPath = join(tmp, "events.jsonl");
    const eventsContent = readFileSync(eventsPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    // Check events
    const hasCondSkipEvent = eventsContent.some(
      (ev) => ev.type === "step-condition-skipped" && ev.step === "step-two"
    );
    assert.ok(hasCondSkipEvent, "events.jsonl should record step-condition-skipped for step-two");

    const hasStepStartedForTwo = eventsContent.some(
      (ev) => ev.type === "step-started" && ev.step === "step-two"
    );
    assert.ok(!hasStepStartedForTwo, "events.jsonl should NOT record step-started for step-two");

    console.log("ok  sprint-engine condition skip behavior verified");

    // Run ag-replay integration check
    const replayOutput = execSync(
      `node --import tsx ag-replay.ts ${tmp}`,
      { encoding: "utf-8", cwd: dirname(__dirname) }
    );
    assert.match(replayOutput, /step-two\s*\|\s*cond-skipped/);
    console.log("ok  ag-replay rendering of cond-skipped verified");

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
