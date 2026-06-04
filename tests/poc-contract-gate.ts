/**
 * contract-gate (Slice 1) — pure parser + conservative missing-token matcher.
 * Offline, no fs, no provider.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseContractBlocks,
  checkContract,
  escapeRegExp,
  extractHeuristicContract,
} from "../src/workflow/contract-gate.js";
import { qualityLoop } from "../src/workflow/quality-loop.js";
import type { StepResult } from "../src/middleman/claude.js";
import { contractGuard, createSDDRecipe, wrapTicketConsistencyGuard } from "../recipes/sdd/recipe.js";
import { tmpdir } from "node:os";

let failures = 0;
function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`ok  ${label}`))
    .catch((err) => {
      failures++;
      console.error(`FAIL  ${label}\n  ${(err as Error).message ?? err}`);
    });
}

const BLOCK = [
  "Some brief prose.",
  "",
  "```agentflow-contract",
  "literals ActionStatus: OK, DUPLICATE, TASK_FAILED, MODEL_FAILED",
  "this line is malformed and should be skipped",
  "fields AuditEntry: workspaceId, confidence",
  "future SomeKind: ignored",
  "```",
  "",
  "More prose.",
].join("\n");

async function main() {
  await check("parses literals + fields, skips malformed + unknown kind", () => {
    const c = parseContractBlocks(BLOCK);
    assert.deepEqual(c.literals.get("ActionStatus"), ["OK", "DUPLICATE", "TASK_FAILED", "MODEL_FAILED"]);
    assert.deepEqual(c.fields.get("AuditEntry"), ["workspaceId", "confidence"]);
    assert.equal(c.literals.has("SomeKind"), false);
    assert.equal(c.fields.has("SomeKind"), false);
  });

  await check("same-name union merge across blocks", () => {
    const md = [
      "```agentflow-contract",
      "literals S: A, B",
      "```",
      "```agentflow-contract",
      "literals S: B, C",
      "```",
    ].join("\n");
    assert.deepEqual(parseContractBlocks(md).literals.get("S"), ["A", "B", "C"]);
  });

  await check("no contract block -> NONE", () => {
    const c = parseContractBlocks("no contract here");
    const r = checkContract(c, "anything");
    assert.equal(r.status, "NONE");
  });

  await check("all tokens present (prose/table/code) -> OK", () => {
    const c = parseContractBlocks(BLOCK);
    const out = "Status is OK or DUPLICATE; TASK_FAILED and MODEL_FAILED too. Fields workspaceId, confidence.";
    assert.equal(checkContract(c, out).status, "OK");
  });

  await check("missing literal -> MISMATCH lists it", () => {
    const c = parseContractBlocks(BLOCK);
    const out = "OK DUPLICATE TASK_FAILED workspaceId confidence"; // MODEL_FAILED dropped
    const r = checkContract(c, out);
    assert.equal(r.status, "MISMATCH");
    assert.deepEqual(r.missingLiterals, ["MODEL_FAILED"]);
    assert.deepEqual(r.missingFields, []);
  });

  await check("complete-token: TASK_FAILED not satisfied by TASK_FAILED_X", () => {
    const c = parseContractBlocks("```agentflow-contract\nliterals E: TASK_FAILED\n```");
    assert.equal(checkContract(c, "only TASK_FAILED_X here").status, "MISMATCH");
    assert.equal(checkContract(c, "exact TASK_FAILED here").status, "OK");
  });

  await check("camelCase field matches as identifier", () => {
    const c = parseContractBlocks("```agentflow-contract\nfields F: workspaceId\n```");
    assert.equal(checkContract(c, "the workspaceId field").status, "OK");
    assert.equal(checkContract(c, "a tournament here").status, "MISMATCH");
  });

  await check("escapeRegExp neutralises metachars (no false present)", () => {
    assert.equal(escapeRegExp("a.b+c"), "a\\.b\\+c");
    const c = parseContractBlocks("```agentflow-contract\nliterals E: A.B\n```");
    // 'AxB' must NOT satisfy 'A.B' (dot escaped, so literal dot required)
    assert.equal(checkContract(c, "AxB").status, "MISMATCH");
  });

  const mkStep = (output: string): StepResult => ({
    output,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    costUsd: 0,
  });

  await check("clamp: MISMATCH(cap 4) overrides reviewer score 10", async () => {
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      parseScore: (t) => Number(t.trim()), // review output IS the score
      targetScore: 9,
      maxRepeat: 1,
      producer: async () => mkStep("produced"),
      reviewer: async () => mkStep("10"),
      preReview: () => ({
        guardName: "input-fidelity-contract",
        status: "MISMATCH",
        report: "missing MODEL_FAILED",
        scoreCap: 4,
      }),
    });
    assert.equal(res.finalScore, 4, "score clamped to 4");
    assert.equal(res.passed, false, "clamped score cannot pass target 9");
    const reviewEv = res.history.find((h) => h.phase === "review");
    assert.equal(reviewEv?.score, 4, "recorded event reflects clamped score");
  });

  await check("clamp: OK guard does not cap (passes at 10)", async () => {
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      parseScore: (t) => Number(t.trim()),
      targetScore: 9,
      maxRepeat: 1,
      producer: async () => mkStep("produced"),
      reviewer: async () => mkStep("10"),
      preReview: () => ({
        guardName: "input-fidelity-contract",
        status: "OK",
        report: "",
      }),
    });
    assert.equal(res.passed, true);
    assert.equal(res.finalScore, 10);
    const okEv = res.history.find((h) => h.phase === "review");
    assert.equal(okEv?.score, 10, "OK path records unclamped score");
  });

  await check("clamp: fallback branch also clamps MISMATCH to cap 4", async () => {
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      // primary review is unparseable -> null -> triggers reviewFallback
      parseScore: (t) => {
        const n = Number(t.trim());
        return Number.isNaN(n) ? null : n;
      },
      targetScore: 9,
      maxRepeat: 1,
      producer: async () => mkStep("produced"),
      reviewer: async () => mkStep("not-a-number"),
      reviewFallback: async () => mkStep("10"),
      preReview: () => ({
        guardName: "input-fidelity-contract",
        status: "MISMATCH",
        report: "missing MODEL_FAILED",
        scoreCap: 4,
      }),
    });
    assert.equal(res.finalScore, 4, "fallback score clamped to 4");
    assert.equal(res.passed, false);
    const fb = res.history.find((h) => h.phase === "review" && h.fallback === true);
    assert.equal(fb?.score, 4, "recorded fallback event reflects clamped score");
  });

  await check("regression: string-returning preReview never clamps", async () => {
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      parseScore: (t) => Number(t.trim()),
      targetScore: 9,
      maxRepeat: 1,
      producer: async () => mkStep("produced"),
      reviewer: async () => mkStep("10"),
      preReview: () => "some legacy guard report",
    });
    assert.equal(res.passed, true);
    assert.equal(res.finalScore, 10);
  });

  const mkSprintDir = (inputMd: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "agf-contract-"));
    writeFileSync(join(dir, "INPUT.md"), inputMd);
    return dir;
  };
  const ctxFor = (dir: string) => ({
    sprintId: "t",
    sprintDir: dir,
    priorArtifacts: {},
    priorIterations: {},
  });
  const INPUT_WITH_CONTRACT = [
    "# Brief",
    "```agentflow-contract",
    "literals ActionStatus: OK, DUPLICATE, MODEL_FAILED, REJECTED",
    "```",
  ].join("\n");

  await check("contractGuard: MISMATCH -> scoreCap 4 + lists missing", () => {
    const dir = mkSprintDir(INPUT_WITH_CONTRACT);
    try {
      const r = contractGuard(ctxFor(dir), "spec mentions OK and DUPLICATE only");
      assert.equal(r.status, "MISMATCH");
      assert.equal(r.scoreCap, 4);
      assert.equal(r.guardName, "input-fidelity-contract");
      assert.match(r.report, /MODEL_FAILED/);
      assert.match(r.report, /REJECTED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("contractGuard: all present -> OK, no cap", () => {
    const dir = mkSprintDir(INPUT_WITH_CONTRACT);
    try {
      const r = contractGuard(ctxFor(dir), "OK DUPLICATE MODEL_FAILED REJECTED");
      assert.equal(r.status, "OK");
      assert.equal(r.scoreCap, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("contractGuard: no contract block -> NONE, no cap", () => {
    const dir = mkSprintDir("# Brief\nNo contract here.");
    try {
      const r = contractGuard(ctxFor(dir), "anything");
      assert.equal(r.status, "NONE");
      assert.equal(r.scoreCap, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---- Slice 2: heuristic extractor ----
  const flat = (m: Map<string, string[]>) =>
    Array.from(new Set([...m.values()].flat())).sort();

  await check("heuristic: extracts >=2-member string-literal union from ts fence", () => {
    const md = [
      "```ts",
      "export type Tier = 'LOW' | 'MEDIUM' | 'HIGH';",
      "```",
    ].join("\n");
    const c = extractHeuristicContract(md);
    assert.deepEqual(flat(c.literals), ["HIGH", "LOW", "MEDIUM"]);
    assert.deepEqual(flat(c.fields), []);
  });

  await check("heuristic: extracts interface field names (incl optional)", () => {
    const md = [
      "```typescript",
      "export interface Foo {",
      "  id: string;",
      "  note?: string;",
      "}",
      "```",
    ].join("\n");
    const c = extractHeuristicContract(md);
    assert.deepEqual(flat(c.fields), ["id", "note"]);
  });

  await check("heuristic: single standalone string literal is NOT extracted (noise guard)", () => {
    const md = ["```ts", "const msg = 'NOT_A_UNION';", "```"].join("\n");
    const c = extractHeuristicContract(md);
    assert.deepEqual(flat(c.literals), []);
  });

  await check("heuristic: multi-line union captured whole", () => {
    const md = [
      "```ts",
      "type S =",
      "  | 'A'",
      "  | 'B'",
      "  | 'C';",
      "```",
    ].join("\n");
    assert.deepEqual(flat(extractHeuristicContract(md).literals), ["A", "B", "C"]);
  });

  await check("heuristic: non-ts fence is ignored", () => {
    const md = ["```json", '{"x": "A" }', "```"].join("\n");
    const c = extractHeuristicContract(md);
    assert.deepEqual(flat(c.literals), []);
    assert.deepEqual(flat(c.fields), []);
  });

  await check("heuristic: agentflow-contract block is NOT scanned by heuristic", () => {
    const md = ["```agentflow-contract", "literals E: A, B", "```"].join("\n");
    const c = extractHeuristicContract(md);
    assert.deepEqual(flat(c.literals), []);
  });

  await check("heuristic: no ts fence -> empty contract", () => {
    const c = extractHeuristicContract("# just prose, no code");
    assert.deepEqual(flat(c.literals), []);
    assert.deepEqual(flat(c.fields), []);
  });

  await check("heuristic: empty interface yields no fields", () => {
    const md = ["```ts", "interface X {", "}", "```"].join("\n");
    assert.deepEqual(flat(extractHeuristicContract(md).fields), []);
  });

  await check("heuristic: field-level union extracts BOTH the field and its literals", () => {
    const md = [
      "```ts",
      "interface Row {",
      "  status: 'OK' | 'FAIL';",
      "}",
      "```",
    ].join("\n");
    const c = extractHeuristicContract(md);
    assert.deepEqual(flat(c.fields), ["status"]);
    assert.deepEqual(flat(c.literals), ["FAIL", "OK"]);
  });

  // ---- Slice 2: contractGuard explicit-vs-heuristic branch ----
  await check("guard: explicit block present -> Slice 1 clamp path (not heuristic)", () => {
    const md = [
      "# Brief",
      "```agentflow-contract",
      "literals ActionStatus: OK, DUPLICATE, MODEL_FAILED",
      "```",
      "```ts",
      "type T = 'A' | 'B';",
      "```",
    ].join("\n");
    const dir = mkSprintDir(md);
    try {
      const r = contractGuard(ctxFor(dir), "mentions OK and DUPLICATE only");
      assert.equal(r.status, "MISMATCH");
      assert.equal(r.scoreCap, 4);
      assert.match(r.report, /MODEL_FAILED/);
      assert.doesNotMatch(r.report, /\bB\b/);
      assert.equal(r.source, "explicit");
      assert.deepEqual(r.missingLiterals, ["MODEL_FAILED"]);
      assert.deepEqual(r.missingFields, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("guard: no explicit block, TS drift -> WARN, no scoreCap", () => {
    const md = [
      "# Brief",
      "```ts",
      "export interface Row {",
      "  status: 'OK' | 'DUPLICATE' | 'FAILED';",
      "  resourceId: string;",
      "}",
      "```",
    ].join("\n");
    const dir = mkSprintDir(md);
    try {
      const r = contractGuard(ctxFor(dir), "Row.status is OK or DUPLICATE; has resourceId.");
      assert.equal(r.status, "WARN");
      assert.equal(r.scoreCap, undefined);
      assert.match(r.report, /FAILED/);
      assert.match(r.report, /WARN/);
      assert.equal(r.source, "heuristic");
      assert.deepEqual(r.missingLiterals, ["FAILED"]);
      assert.deepEqual(r.missingFields, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("guard: no explicit block, TS all present -> OK", () => {
    const md = ["# Brief", "```ts", "type Tier = 'LOW' | 'HIGH';", "```"].join("\n");
    const dir = mkSprintDir(md);
    try {
      const r = contractGuard(ctxFor(dir), "Tier is LOW or HIGH.");
      assert.equal(r.status, "OK");
      assert.equal(r.scoreCap, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("guard: no explicit block, no TS -> NONE", () => {
    const dir = mkSprintDir("# Brief\nplain prose only.");
    try {
      const r = contractGuard(ctxFor(dir), "anything");
      assert.equal(r.status, "NONE");
      assert.equal(r.scoreCap, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // S3 omitted: its INPUT carries no heuristic-parseable TS union/interface contract.
  // ---- Slice 2: fixture-driven heuristic checks (S1/S2/S4/S5) ----
  const FX_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "contract-heuristic");
  const fx = (sprint: string, file: string) => readFileSync(join(FX_DIR, sprint, file), "utf8");

  await check("fixture S2: actionStatus drift -> lists the 5 dropped literals", () => {
    const c = extractHeuristicContract(fx("s2", "input.md"));
    assert.deepEqual(flat(c.fields), ["actionStatus", "actorRole", "workspaceId"]);
    const r = checkContract(c, fx("s2", "drifted.md"));
    assert.equal(r.status, "MISMATCH"); // pure-level; guard maps this to WARN
    assert.deepEqual(
      r.missingLiterals.sort(),
      ["CANCELLED", "CONFIRMATION_REQUIRED", "EXECUTION_FAILED", "MODEL_FAILED", "REJECTED"],
    );
    assert.deepEqual(r.missingFields, []);
  });

  await check("fixture S4: drops ADMIN literal AND confidence field", () => {
    const c = extractHeuristicContract(fx("s4", "input.md"));
    const r = checkContract(c, fx("s4", "drifted.md"));
    assert.equal(r.status, "MISMATCH");
    assert.deepEqual(r.missingLiterals, ["ADMIN"]);
    assert.deepEqual(r.missingFields, ["confidence"]);
  });

  // S1 expresses its union via a `satisfies Record<..., 'LOW' | 'MEDIUM' | 'HIGH'>` constraint (literals on the value side).
  await check("fixture S1: union-only (no interface) -> drops HIGH", () => {
    const c = extractHeuristicContract(fx("s1", "input.md"));
    assert.deepEqual(flat(c.literals), ["HIGH", "LOW", "MEDIUM"]);
    assert.deepEqual(flat(c.fields), []);
    const r = checkContract(c, fx("s1", "drifted.md"));
    assert.deepEqual(r.missingLiterals, ["HIGH"]);
  });

  await check("fixture S5: drops DUPLICATE literal AND endpointCalled field", () => {
    const c = extractHeuristicContract(fx("s5", "input.md"));
    assert.deepEqual(flat(c.literals), ["DUPLICATE", "OK"]);
    assert.deepEqual(flat(c.fields), ["endpointCalled", "status"]);
    const r = checkContract(c, fx("s5", "drifted.md"));
    assert.deepEqual(r.missingLiterals, ["DUPLICATE"]);
    assert.deepEqual(r.missingFields, ["endpointCalled"]);
  });

  // ---- Slice 3a: qualityLoop exposes finalGuard (best-so-far-consistent) ----
  const guardObj = (status: string, scoreCap?: number) => ({
    guardName: "input-fidelity-contract",
    status: status as "OK" | "MISMATCH" | "WARN" | "NONE",
    report: `g:${status}`,
    ...(scoreCap !== undefined ? { scoreCap } : {}),
  });

  await check("finalGuard: best-so-far keeps the drifted artifact's guard", async () => {
    let n = 0;
    const reviews = ["4", "3"];
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      parseScore: (t) => Number(t.trim()),
      targetScore: 9,
      maxRepeat: 2,
      producer: async () => mkStep("A"),
      fixer: async () => mkStep("B"),
      reviewer: async () => mkStep(reviews[n++]),
      preReview: (out) => (out === "A" ? guardObj("MISMATCH", 4) : guardObj("OK")),
    });
    assert.equal(res.finalOutput, "A");
    assert.equal(res.finalScore, 4);
    assert.equal(res.finalGuard?.status, "MISMATCH");
  });

  await check("finalGuard: a real fix wins -> OK guard", async () => {
    let n = 0;
    const reviews = ["4", "8"];
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      parseScore: (t) => Number(t.trim()),
      targetScore: 9,
      maxRepeat: 2,
      producer: async () => mkStep("A"),
      fixer: async () => mkStep("B"),
      reviewer: async () => mkStep(reviews[n++]),
      preReview: (out) => (out === "A" ? guardObj("MISMATCH", 4) : guardObj("OK")),
    });
    assert.equal(res.finalOutput, "B");
    assert.equal(res.finalScore, 8);
    assert.equal(res.finalGuard?.status, "OK");
  });

  await check("finalGuard: MISMATCH at reviewer score 0 still captured (best-so-far seed)", async () => {
    // Regression: a legitimate score-0 MISMATCH attempt must still surface its
    // guard. With strict `>` and bestScore init 0, 0 > 0 is false, so bestGuard
    // would be lost and the sidecar never written. The first attempt must seed.
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      parseScore: (t) => Number(t.trim()),
      targetScore: 9,
      maxRepeat: 1,
      producer: async () => mkStep("A"),
      reviewer: async () => mkStep("0"),
      preReview: () => guardObj("MISMATCH", 4),
    });
    assert.equal(res.finalOutput, "A");
    assert.equal(res.finalScore, 0);
    assert.equal(res.finalGuard?.status, "MISMATCH");
  });

  await check("finalGuard: pass path uses that attempt's guard", async () => {
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      parseScore: (t) => Number(t.trim()),
      targetScore: 9,
      maxRepeat: 2,
      producer: async () => mkStep("A"),
      reviewer: async () => mkStep("10"),
      preReview: () => guardObj("OK"),
    });
    assert.equal(res.passed, true);
    assert.equal(res.finalGuard?.status, "OK");
  });

  await check("finalGuard: string-return preReview -> undefined", async () => {
    const res = await qualityLoop({
      producePrompt: "p",
      reviewPromptFor: () => "r",
      fixPromptFor: () => "f",
      parseScore: (t) => Number(t.trim()),
      targetScore: 9,
      maxRepeat: 1,
      producer: async () => mkStep("A"),
      reviewer: async () => mkStep("10"),
      preReview: () => "plain string report",
    });
    assert.equal(res.finalGuard, undefined);
  });

  // ---- Slice 3b: contractGuard wired on tkt ----
  await check("wiring: contract guard on spec + tkt; wrap keeps its own; dev unguarded", () => {
    const r = createSDDRecipe();
    const step = (name: string) => r.steps.find((s) => s.name === name);
    assert.equal(step("spec")?.preReview, contractGuard);
    assert.equal(step("tkt")?.preReview, contractGuard);
    assert.equal(step("wrap")?.preReview, wrapTicketConsistencyGuard);
    assert.equal(step("dev")?.preReview, undefined);
  });

  const DRIFTED_TKT = [
    "## T1: writeRow",
    "Persist the audit row with actionStatus OK or DUPLICATE.",
    "## T2: processTask",
    "Capture payload from the mic.",
  ].join("\n"); // drops the mandated MODEL_FAILED literal

  await check("behavior: contractGuard on tkt artifact — explicit drift -> MISMATCH + cap 4", () => {
    const dir = mkSprintDir(
      ["# Brief", "```agentflow-contract", "literals ActionStatus: OK, DUPLICATE, MODEL_FAILED", "```"].join("\n"),
    );
    try {
      const g = contractGuard(ctxFor(dir), DRIFTED_TKT);
      assert.equal(g.status, "MISMATCH");
      assert.equal(g.scoreCap, 4);
      assert.equal(g.source, "explicit");
      assert.match(g.report, /MODEL_FAILED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("behavior: contractGuard on tkt artifact — heuristic drift -> WARN, no cap", () => {
    const dir = mkSprintDir(
      ["# Brief", "```ts", "type ActionStatus = 'OK' | 'DUPLICATE' | 'MODEL_FAILED';", "```"].join("\n"),
    );
    try {
      const g = contractGuard(ctxFor(dir), DRIFTED_TKT);
      assert.equal(g.status, "WARN");
      assert.equal(g.scoreCap, undefined);
      assert.equal(g.source, "heuristic");
      assert.match(g.report, /MODEL_FAILED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

main().finally(() => {
  if (failures > 0) {
    console.error(`\n${failures} contract-gate test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll contract-gate tests passed.");
});
