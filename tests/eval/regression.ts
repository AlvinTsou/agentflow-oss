/**
 * AgentFlow Regression Eval Suite (C-7)
 * Runs a suite of mock scenarios representing typical maintainer tasks
 * and checks for verdict correctness to ensure engine updates don't degrade capabilities.
 *
 * Usage: pnpm exec tsx tests/eval/regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, writeFileSync as writeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { runSprint } from "../../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../../src/workflow/sprint-repo.js";
import { Middleman } from "../../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../../src/middleman/middleman.js";
import type { Recipe } from "../../src/recipe/types.js";

const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tmp");
mkdirSync(testTmpDir, { recursive: true });

interface EvalCase {
  name: string;
  recipe: Recipe;
  mockResponses: (req: MiddlemanRequest) => { output: string; score?: number };
  expectedPass: boolean;
  expectErrorSnippet?: string;
}

const evalCases: EvalCase[] = [
  {
    name: "Scenario 1: Simple Maker-Checker (Mini Flow)",
    recipe: {
      name: "mini",
      description: "Mini self-test recipe",
      steps: [
        {
          name: "test-step",
          provider: "claude",
          intent: "synthetic",
          producePrompt: "hello",
          rubric: "must contain score",
        },
      ],
    },
    mockResponses: (req) => {
      const prompt = req.messages.find((m) => m.role === "user")?.content ?? "";
      if (prompt.includes("ARTIFACT UNDER REVIEW")) {
        return { output: `{"score": 10, "passed": ["C1"], "failed": [], "notes": "perfect"}` };
      }
      return { output: "hello world" };
    },
    expectedPass: true,
  },
  {
    name: "Scenario 2: Security Review (Unsafe Logging Check)",
    recipe: {
      name: "security-review",
      description: "Audits repository for security defects",
      steps: [
        {
          name: "security-audit",
          provider: "claude",
          intent: "synthetic",
          producePrompt: "analyze code changes",
          rubric: "look for unsafe operations",
        },
      ],
    },
    mockResponses: (req) => {
      const prompt = req.messages.find((m) => m.role === "user")?.content ?? "";
      if (prompt.includes("ARTIFACT UNDER REVIEW")) {
        // Return low score because of unsafe logging detected
        return { output: `{"score": 5, "passed": [], "failed": ["unsafe logging"], "notes": "unacceptable"}` };
      }
      return { output: "unsafe logging detected in auth service" };
    },
    expectedPass: false,
    expectErrorSnippet: "failed Quality Loop",
  },
  {
    name: "Scenario 3: Consensus Voting (3 Voters, 2/3 Pass)",
    recipe: {
      name: "consensus-flow",
      description: "Consensus flow recipe",
      steps: [
        {
          name: "voting-step",
          provider: "claude",
          intent: "synthetic",
          producePrompt: "produce something",
          rubric: "grade it",
          consensusVoting: {
            voters: [{ provider: "claude" }, { provider: "gemini" }, { provider: "openai-compatible" }],
            minVotesToPass: 2,
          },
        },
      ],
    },
    mockResponses: (() => {
      let count = 0;
      const scores = [10, 5, 9];
      return (req: MiddlemanRequest) => {
        const prompt = req.messages.find((m) => m.role === "user")?.content ?? "";
        if (prompt.includes("ARTIFACT UNDER REVIEW")) {
          const score = scores[count % 3];
          count++;
          return { output: `{"score": ${score}, "passed": [], "failed": [], "notes": "graded"}` };
        }
        return { output: "consensus content" };
      };
    })(),
    expectedPass: true,
  },
];

async function runEval() {
  console.log("Starting Regression Evaluation...");
  const results: { name: string; status: "PASSED" | "FAILED"; details?: string }[] = [];

  for (const tc of evalCases) {
    const tmp = mkdtempSync(join(testTmpDir, "eval-case-"));
    initSprintRepo(tmp);
    writeFileSync(join(tmp, "INPUT.md"), "# Test Brief\n\nRegression evaluation task", "utf-8");
    writeFileSync(
      join(tmp, "agentflow.config.json"),
      `{ "recipe": "${tc.recipe.name}", "gate": { "defaultMode": "auto" } }`,
      "utf-8",
    );

    mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
      const resp = tc.mockResponses(rawRequest);
      const userMsg = rawRequest.messages.find((m) => m.role === "user")?.content ?? "";
      console.log(`[DEBUG] Case: ${tc.name}, userMsg: ${userMsg.substring(0, 100)}...`);
      const provider = _options?.provider ?? "claude";
      return {
        route: { provider, reason: "mock" },
        request: rawRequest,
        result: {
          output: resp.output,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          durationMs: 2,
          costUsd: 0.00015,
          route: { provider, reason: "mock" },
        },
      };
    });

    try {
      const sprintResult = await runSprint({
        recipe: tc.recipe,
        sprintDir: tmp,
        sprintId: `eval-${tc.recipe.name}`,
      });
      if (tc.expectedPass) {
        assert.equal(sprintResult.passed, true);
        results.push({ name: tc.name, status: "PASSED" });
      } else {
        results.push({ name: tc.name, status: "FAILED", details: "Expected sprint to fail, but it passed." });
      }
    } catch (err) {
      if (!tc.expectedPass && tc.expectErrorSnippet && err instanceof Error && err.message.includes(tc.expectErrorSnippet)) {
        results.push({ name: tc.name, status: "PASSED" });
      } else {
        results.push({
          name: tc.name,
          status: "FAILED",
          details: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      mock.reset();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {}
    }
  }

  // Print results and write report
  console.log("\n==============================");
  console.log("Regression Eval Suite Results:");
  console.log("==============================");
  
  let allOk = true;
  const reportLines: string[] = [
    "# Regression Evaluation Report",
    `Date: ${new Date().toISOString()}`,
    "",
    "| Scenario Name | Status | Details |",
    "| --- | --- | --- |"
  ];

  for (const r of results) {
    console.log(`[${r.status}] ${r.name}`);
    if (r.status === "FAILED") {
      allOk = false;
      console.log(`  Details: ${r.details}`);
    }
    reportLines.push(`| ${r.name} | **${r.status}** | ${r.details ?? "None"} |`);
  }

  const reportPath = join(dirname(fileURLToPath(import.meta.url)), "eval-report.md");
  writeSync(reportPath, reportLines.join("\n"), "utf-8");
  console.log(`\nWritten evaluation report to: ${reportPath}`);

  if (!allOk) {
    console.error("FAIL: Regression evaluation suite had failures!");
    process.exit(1);
  } else {
    console.log("SUCCESS: All regression scenarios verified successfully!");
  }
}

runEval().catch((err) => {
  console.error("Fatal error running eval suite:", err);
  process.exit(1);
});
