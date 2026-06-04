/**
 * Quality Loop best-so-far retention (todo: "Quality Loop / dev.forEach
 * hardening", item #1).
 *
 * Offline + deterministic: injects fake producer/reviewer/fixer runners so
 * the score sequence is fully controlled, no provider calls.
 *
 * Behaviour under test: when all attempts fail to reach targetScore, the
 * loop must return the HIGHEST-scoring artifact seen, NOT the last attempt.
 * Reproduces the dev/T6 regression (1 -> 6 -> 4) where the final fix scored
 * worse than an earlier one.
 *
 *   T1 — regressing fail (1 -> 6 -> 4): passed=false, finalScore=6,
 *        finalOutput is the attempt-2 artifact (the best), not attempt-3.
 *   T2 — pass still wins immediately: a target-meeting attempt short-circuits
 *        and returns that artifact even if an earlier attempt scored lower.
 *   T3 — monotonic fail (1 -> 2 -> 3): best == last, finalOutput is attempt-3.
 */
import assert from "node:assert/strict";

import { qualityLoop } from "../src/workflow/quality-loop.js";
import type { StepResult } from "../src/middleman/claude.js";

function stepResult(output: string): StepResult {
  return {
    output,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    durationMs: 0,
    costUsd: 0,
  };
}

/**
 * Build injectable runners that emit a fixed sequence of artifacts and a
 * fixed sequence of review scores. `artifacts[i]` is the i-th produce/fix
 * output; `scores[i]` is the i-th review score. parseScore reads the number
 * the reviewer emits verbatim.
 */
function scriptedRunners(artifacts: string[], scores: number[]) {
  let prodIdx = 0;
  let revIdx = 0;
  const producer = async () => stepResult(artifacts[prodIdx++]!);
  const fixer = async () => stepResult(artifacts[prodIdx++]!);
  const reviewer = async () => stepResult(String(scores[revIdx++]!));
  return { producer, fixer, reviewer };
}

const parseScore = (review: string): number | null => {
  const n = Number(review.trim());
  return Number.isFinite(n) ? n : null;
};

async function t1RegressingFailKeepsBest() {
  // produce=A1(score1), fix=A2(score6), fix=A3(score4). target unreachable.
  const { producer, reviewer, fixer } = scriptedRunners(
    ["A1", "A2", "A3"],
    [1, 6, 4],
  );
  const result = await qualityLoop({
    producePrompt: "p",
    reviewPromptFor: () => "r",
    fixPromptFor: () => "f",
    parseScore,
    targetScore: 9,
    maxRepeat: 3,
    producer,
    reviewer,
    fixer,
  });

  assert.equal(result.passed, false, "T1: should not pass (best 6 < target 9)");
  assert.equal(result.finalScore, 6, "T1: finalScore should be the best (6), not the last (4)");
  assert.equal(result.finalOutput, "A2", "T1: finalOutput should be the best artifact (A2), not the last (A3)");
  console.log("[T1] PASS — regressing fail keeps best (score 6, artifact A2)");
}

async function t2PassWinsImmediately() {
  // produce=A1(score3), fix=A2(score9). Hits target on attempt 2.
  const { producer, reviewer, fixer } = scriptedRunners(
    ["A1", "A2"],
    [3, 9],
  );
  const result = await qualityLoop({
    producePrompt: "p",
    reviewPromptFor: () => "r",
    fixPromptFor: () => "f",
    parseScore,
    targetScore: 9,
    maxRepeat: 3,
    producer,
    reviewer,
    fixer,
  });

  assert.equal(result.passed, true, "T2: should pass on attempt 2");
  assert.equal(result.finalScore, 9, "T2: finalScore 9");
  assert.equal(result.finalOutput, "A2", "T2: finalOutput is the passing artifact A2");
  console.log("[T2] PASS — target-meeting attempt short-circuits");
}

async function t3MonotonicFailBestIsLast() {
  // produce=A1(score1), fix=A2(score2), fix=A3(score3). best == last.
  const { producer, reviewer, fixer } = scriptedRunners(
    ["A1", "A2", "A3"],
    [1, 2, 3],
  );
  const result = await qualityLoop({
    producePrompt: "p",
    reviewPromptFor: () => "r",
    fixPromptFor: () => "f",
    parseScore,
    targetScore: 9,
    maxRepeat: 3,
    producer,
    reviewer,
    fixer,
  });

  assert.equal(result.passed, false, "T3: should not pass");
  assert.equal(result.finalScore, 3, "T3: finalScore is the best == last (3)");
  assert.equal(result.finalOutput, "A3", "T3: finalOutput is A3 (best happens to be last)");
  console.log("[T3] PASS — monotonic fail returns last (which is the best)");
}

async function main() {
  await t1RegressingFailKeepsBest();
  await t2PassWinsImmediately();
  await t3MonotonicFailBestIsLast();
  console.log("\n[poc-best-so-far] all assertions passed");
}

main().catch((err) => {
  console.error("[poc-best-so-far] FAIL:", err.message);
  process.exit(1);
});
