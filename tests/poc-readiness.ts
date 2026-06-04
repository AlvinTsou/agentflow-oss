/**
 * readiness — parse review/wrap artifacts into a ReadinessReport.
 * Offline; pure-string cases here, fixture cases added in Task 2.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseReviewVerdict,
  parseReviewFindings,
  parseWrapCarryOvers,
  computeReadiness,
  buildReadinessReport,
  parseContractGuardCarryOvers,
  upsertContractGuardDecision,
  guardSeverityFor,
  renderCarryOverSection,
} from "../src/workflow/readiness.js";

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

const REVIEW_BLOCKED = `<!--agentflow
{"step":"review","score":10}
-->
## Verdict
REQUEST CHANGES. T5 fails the audit ordering and T6 is corrupted.

## Findings
- T1 [blocking] deriveTargetId can throw on null intent.
- T2 [nit] setTimeout().unref() is Node-specific.
- T5 [blocking] writeWorkflowRow is not awaited.
`;

const REVIEW_APPROVE = `## Verdict
APPROVE. All criteria met.

## Findings
- T1 [nit] minor naming.
`;

const WRAP_BLOCKED = `## Open follow-ups
- **T5 (carry-over, blocking):** writeWorkflowRow is not awaited.
- **T3 / Gate 2 (carry-over, deferred):** HMAC gate not implemented.
- **T4 (carry-over, nit):** RiskLevel not imported.
`;

async function main(): Promise<void> {
  await check("parseReviewVerdict — REQUEST CHANGES", () => {
    assert.equal(parseReviewVerdict(REVIEW_BLOCKED), "REQUEST CHANGES");
  });
  await check("parseReviewVerdict — APPROVE", () => {
    assert.equal(parseReviewVerdict(REVIEW_APPROVE), "APPROVE");
  });
  await check("parseReviewVerdict — no verdict section -> null", () => {
    assert.equal(parseReviewVerdict("## Findings\n- T1 [nit] x"), null);
  });

  await check("parseReviewFindings — extracts ticket/severity/text, source review", () => {
    const f = parseReviewFindings(REVIEW_BLOCKED);
    assert.equal(f.length, 3);
    assert.deepEqual(
      f.map((x) => [x.source, x.ticket, x.severity]),
      [["review", "T1", "blocking"], ["review", "T2", "nit"], ["review", "T5", "blocking"]],
    );
    assert.match(f[0].text, /deriveTargetId/);
  });

  await check("parseWrapCarryOvers — handles compound ticket + severities", () => {
    const c = parseWrapCarryOvers(WRAP_BLOCKED);
    assert.equal(c.length, 3);
    assert.deepEqual(
      c.map((x) => [x.source, x.ticket, x.severity]),
      [["wrap", "T5", "blocking"], ["wrap", "T3 / Gate 2", "deferred"], ["wrap", "T4", "nit"]],
    );
  });

  await check("computeReadiness — blocked via review verdict OR blocking findings OR wrap blocking", () => {
    const r = computeReadiness({ reviewMd: REVIEW_BLOCKED, wrapMd: WRAP_BLOCKED });
    assert.equal(r.readiness, "blocked");
    assert.equal(r.reviewVerdict, "REQUEST CHANGES");
    // review blocking: T1, T5 (2) + wrap blocking: T5 (1) = 3
    assert.equal(r.blockingCount, 3);
    assert.equal(r.carryOvers.length, 6);
  });

  await check("computeReadiness — ready when approve + no blocking anywhere", () => {
    const r = computeReadiness({ reviewMd: REVIEW_APPROVE, wrapMd: "## Open follow-ups\n- **T1 (carry-over, nit):** x" });
    assert.equal(r.readiness, "ready");
    assert.equal(r.blockingCount, 0);
  });

  await check("computeReadiness — unknown when review absent", () => {
    // WRAP_BLOCKED has a blocking carry-over; per the contract-guard readiness spec,
    // any blocking carry-over flips readiness to blocked even when reviewMd is null.
    const r = computeReadiness({ reviewMd: null, wrapMd: WRAP_BLOCKED });
    assert.equal(r.readiness, "blocked");
  });

  await check("computeReadiness — blocked via wrap even if review approves", () => {
    const r = computeReadiness({ reviewMd: REVIEW_APPROVE, wrapMd: WRAP_BLOCKED });
    assert.equal(r.readiness, "blocked");
  });

  // Pattern A — severity in bullet
  await check("parseWrapCarryOvers — pattern A (severity in bullet, with/without carry-over prefix)", () => {
    const c = parseWrapCarryOvers(
      "## Open follow-ups\n" +
      "- **T3 (blocking):** column uses a type alias.\n" +
      "- **T5 (carry-over, blocking):** writeWorkflowRow not awaited.\n" +
      "- **T3 / Gate 2 (carry-over, deferred):** HMAC gate.\n"
    );
    assert.deepEqual(c.map((x) => [x.ticket, x.severity]),
      [["T3", "blocking"], ["T5", "blocking"], ["T3 / Gate 2", "deferred"]]);
    assert.equal(c.every((x) => x.source === "wrap"), true);
    assert.match(c[0].text, /type alias/);
  });

  // Pattern B — severity in heading, bullets underneath
  await check("parseWrapCarryOvers — pattern B (severity from bold heading context)", () => {
    const c = parseWrapCarryOvers(
      "## Open follow-ups\n" +
      "**Carry-over from Review (blocking):**\n" +
      "- **T5 — rootDir conflict**: tsconfig extends main config.\n" +
      "- **T4 / T8 — missing setPrototypeOf**: instanceof can fail.\n" +
      "**Carry-over from Review (nit):**\n" +
      "- **T5 — path assumption**: ci-gate hard-codes path.\n"
    );
    assert.deepEqual(c.map((x) => [x.ticket, x.severity]),
      [["T5", "blocking"], ["T4 / T8", "blocking"], ["T5", "nit"]]);
    assert.match(c[0].text, /tsconfig extends/);
  });

  await check("parseWrapCarryOvers — 'Blocking carry-overs from review' heading implies blocking", () => {
    const c = parseWrapCarryOvers(
      "## Open follow-ups\n**Blocking carry-overs from review**\n- **T8 — barrel not updated**: index.ts missing export.\n"
    );
    assert.equal(c.length, 1);
    assert.equal(c[0].severity, "blocking");
    assert.equal(c[0].ticket, "T8");
  });

  const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "readiness");

  await check("parseWrapCarryOvers — ignores lines outside the Open follow-ups section", () => {
    const md =
      "## Open follow-ups\n" +
      "- **T1 (carry-over, blocking):** real follow-up.\n" +
      "\n" +
      "## Audit trail\n" +
      "**Blocking carry-overs from review**\n" +
      "- **dev / T1** — produced the thing.\n" +
      "- **review** — verdict REQUEST CHANGES.\n";
    const c = parseWrapCarryOvers(md);
    assert.equal(c.length, 1, "only the Open follow-ups bullet, not audit-trail bullets");
    assert.equal(c[0].ticket, "T1");
    assert.equal(c[0].severity, "blocking");
  });

  for (const s of ["s1", "s2", "s3", "s4", "s5"]) {
    await check(`parseWrapCarryOvers — ${s}: only Open-follow-ups items, no audit-trail bleed`, () => {
      const md = readFileSync(join(FIX, s, "09-wrap", "output.md"), "utf-8");
      const c = parseWrapCarryOvers(md);
      assert.ok(c.length > 0 && c.length <= 12, `${s} carryOvers count sane (got ${c.length})`);
      assert.ok(c.filter((x) => x.severity === "blocking").length >= 1, `${s} has >=1 blocking`);
      for (const co of c) {
        assert.doesNotMatch(co.ticket, /\b(dev|review|spec|usage|wrap|explore|prototype|discuss)\b/i,
          `${s} ticket "${co.ticket}" looks like an audit-trail step, not a follow-up ticket`);
      }
    });
  }

  for (const s of ["s1", "s2", "s3", "s4", "s5"]) {
    await check(`buildReadinessReport — ${s} is blocked (REQUEST CHANGES + blocking)`, () => {
      const r = buildReadinessReport(join(FIX, s));
      assert.equal(r.readiness, "blocked", `${s} readiness`);
      assert.match(r.reviewVerdict ?? "", /REQUEST CHANGES/);
      assert.ok(r.blockingCount > 0, `${s} blockingCount > 0`);
    });
  }

  await check("buildReadinessReport — synthetic ready", () => {
    const r = buildReadinessReport(join(FIX, "ready"));
    assert.equal(r.readiness, "ready");
    assert.equal(r.blockingCount, 0);
  });

  await check("buildReadinessReport — review absent but blocking wrap -> blocked", () => {
    // Fixture has a blocking wrap carry-over; per contract-guard readiness spec,
    // any blocking carry-over flips readiness to blocked even without a review.
    const r = buildReadinessReport(join(FIX, "unknown"));
    assert.equal(r.readiness, "blocked");
  });

  await check("buildReadinessReport — missing dir -> unknown, no throw", () => {
    const r = buildReadinessReport(join(FIX, "does-not-exist"));
    assert.equal(r.readiness, "unknown");
  });

  const mkdirSyncP = (p: string) => mkdirSync(p, { recursive: true });

  await check("guardSeverityFor maps guard status -> decision severity", () => {
    assert.equal(guardSeverityFor("MISMATCH"), "blocking");
    assert.equal(guardSeverityFor("WARN"), "warning");
    assert.equal(guardSeverityFor("OK"), "info");
    assert.equal(guardSeverityFor("NONE"), null);
  });

  await check("parseContractGuardCarryOvers: blocking MISMATCH -> blocking CarryOver", () => {
    const json = JSON.stringify({
      version: 1,
      decisions: [
        { guardName: "input-fidelity-contract", step: "spec", iterationId: null,
          status: "MISMATCH", source: "explicit", severity: "blocking",
          missingLiterals: ["MODEL_FAILED"], missingFields: [], scoreCap: 4, attempt: 1,
          createdAt: "2026-06-03T00:00:00.000Z" },
      ],
    });
    const cos = parseContractGuardCarryOvers(json);
    assert.equal(cos.length, 1);
    assert.equal(cos[0].source, "contract-guard");
    assert.equal(cos[0].severity, "blocking");
    assert.match(cos[0].text, /spec/);
    assert.match(cos[0].text, /MODEL_FAILED/);
  });

  await check("parseContractGuardCarryOvers: WARN -> deferred, OK/info -> none", () => {
    const json = JSON.stringify({
      version: 1,
      decisions: [
        { guardName: "g", step: "spec", iterationId: null, status: "WARN", source: "heuristic",
          severity: "warning", missingLiterals: ["X"], missingFields: [], attempt: 1, createdAt: "t" },
        { guardName: "g", step: "spec", iterationId: null, status: "OK", source: "explicit",
          severity: "info", missingLiterals: [], missingFields: [], attempt: 1, createdAt: "t" },
      ],
    });
    const cos = parseContractGuardCarryOvers(json);
    assert.equal(cos.length, 1);
    assert.equal(cos[0].severity, "deferred");
  });

  await check("parseContractGuardCarryOvers: null/malformed/wrong-version -> []", () => {
    assert.deepEqual(parseContractGuardCarryOvers(null), []);
    assert.deepEqual(parseContractGuardCarryOvers("not json"), []);
    assert.deepEqual(parseContractGuardCarryOvers(JSON.stringify({ version: 2, decisions: [] })), []);
  });

  await check("computeReadiness: blocking guard carry-over -> blocked even if review APPROVES", () => {
    const r = computeReadiness({
      reviewMd: "## Verdict\nAPPROVE",
      wrapMd: null,
      guardCarryOvers: [
        { source: "contract-guard", ticket: "", severity: "blocking", text: "spec: contract drift" },
      ],
    });
    assert.equal(r.readiness, "blocked");
    assert.ok(r.blockingCount >= 1);
  });

  await check("computeReadiness: deferred guard carry-over does NOT block", () => {
    const r = computeReadiness({
      reviewMd: "## Verdict\nAPPROVE",
      wrapMd: null,
      guardCarryOvers: [
        { source: "contract-guard", ticket: "", severity: "deferred", text: "spec: heuristic warn" },
      ],
    });
    assert.equal(r.readiness, "ready");
  });

  await check("computeReadiness: blocking guard carry-over flips null-review unknown -> blocked", () => {
    const r = computeReadiness({
      reviewMd: null,
      wrapMd: null,
      guardCarryOvers: [
        { source: "contract-guard", ticket: "", severity: "blocking", text: "spec: drift" },
      ],
    });
    assert.equal(r.readiness, "blocked");
  });

  await check("upsertContractGuardDecision: same key replaces, no stale", () => {
    const dir = mkdtempSync(join(tmpdir(), "agf-guardsc-"));
    try {
      upsertContractGuardDecision(dir, {
        guardName: "input-fidelity-contract", step: "spec", iterationId: null,
        status: "MISMATCH", source: "explicit", severity: "blocking",
        missingLiterals: ["MODEL_FAILED"], missingFields: [], scoreCap: 4, attempt: 1,
        createdAt: "2026-06-03T00:00:00.000Z",
      });
      upsertContractGuardDecision(dir, {
        guardName: "input-fidelity-contract", step: "spec", iterationId: null,
        status: "OK", source: "explicit", severity: "info",
        missingLiterals: [], missingFields: [], attempt: 2,
        createdAt: "2026-06-03T00:01:00.000Z",
      });
      const file = JSON.parse(readFileSync(join(dir, "contract-guard.json"), "utf-8"));
      assert.equal(file.version, 1);
      assert.equal(file.decisions.length, 1);
      assert.equal(file.decisions[0].status, "OK");
      assert.deepEqual(parseContractGuardCarryOvers(JSON.stringify(file)), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("buildReadinessReport: merges contract-guard.json blocking decision", () => {
    const dir = mkdtempSync(join(tmpdir(), "agf-guardrr-"));
    try {
      const reviewDir = join(dir, "08-review");
      mkdirSyncP(reviewDir);
      writeFileSync(join(reviewDir, "output.md"), "## Verdict\nAPPROVE\n");
      upsertContractGuardDecision(dir, {
        guardName: "input-fidelity-contract", step: "spec", iterationId: null,
        status: "MISMATCH", source: "explicit", severity: "blocking",
        missingLiterals: ["MODEL_FAILED"], missingFields: [], scoreCap: 4, attempt: 1,
        createdAt: "2026-06-03T00:00:00.000Z",
      });
      const r = buildReadinessReport(dir);
      assert.equal(r.readiness, "blocked");
      assert.ok(r.carryOvers.some((c) => c.source === "contract-guard" && c.severity === "blocking"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("computeReadiness: null review + only non-blocking guard carry-over -> unknown", () => {
    const r = computeReadiness({
      reviewMd: null,
      wrapMd: null,
      guardCarryOvers: [
        { source: "contract-guard", ticket: "", severity: "deferred", text: "spec: heuristic warn" },
      ],
    });
    assert.equal(r.readiness, "unknown");
  });

  await check("buildReadinessReport: no contract-guard.json -> unchanged behaviour", () => {
    const dir = mkdtempSync(join(tmpdir(), "agf-guardrr2-"));
    try {
      const reviewDir = join(dir, "08-review");
      mkdirSyncP(reviewDir);
      writeFileSync(join(reviewDir, "output.md"), "## Verdict\nAPPROVE\n");
      const r = buildReadinessReport(dir);
      assert.equal(r.readiness, "ready");
      assert.equal(r.carryOvers.filter((c) => c.source === "contract-guard").length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await check("renderCarryOverSection: blocking-only by default, provenance, ticket-less", () => {
    const report = {
      readiness: "blocked" as const,
      reviewVerdict: "REQUEST CHANGES",
      blockingCount: 2,
      carryOvers: [
        { source: "review" as const, ticket: "T3", severity: "blocking" as const, text: "enum drift" },
        { source: "wrap" as const, ticket: "", severity: "blocking" as const, text: "no ticket here" },
        { source: "review" as const, ticket: "T9", severity: "deferred" as const, text: "later" },
        { source: "review" as const, ticket: "T1", severity: "nit" as const, text: "style" },
      ],
    };
    const s = renderCarryOverSection(report, "maintainer-s2-audit-1780297139639", {})!;
    assert.match(s, /## Carry-over from prior round/);
    assert.match(s, /Source sprint: maintainer-s2-audit-1780297139639/);
    assert.match(s, /Readiness: blocked/);
    assert.match(s, /Review verdict: REQUEST CHANGES/);
    assert.match(s, /- \[blocking\] T3: enum drift/);
    assert.match(s, /- \[blocking\] no ticket here/);
    assert.doesNotMatch(s, /T9|later/);
    assert.doesNotMatch(s, /T1: style|nit/);
  });

  await check("renderCarryOverSection: includeDeferred adds deferred, never nit", () => {
    const report = {
      readiness: "blocked" as const,
      reviewVerdict: "REQUEST CHANGES",
      blockingCount: 1,
      carryOvers: [
        { source: "review" as const, ticket: "T3", severity: "blocking" as const, text: "b" },
        { source: "review" as const, ticket: "T9", severity: "deferred" as const, text: "d" },
        { source: "review" as const, ticket: "T1", severity: "nit" as const, text: "n" },
      ],
    };
    const s = renderCarryOverSection(report, "sid", { includeDeferred: true })!;
    assert.match(s, /- \[blocking\] T3: b/);
    assert.match(s, /- \[deferred\] T9: d/);
    assert.doesNotMatch(s, /\[nit\]/);
  });

  await check("renderCarryOverSection: only-nit / empty -> null", () => {
    const onlyNit = {
      readiness: "blocked" as const, reviewVerdict: null, blockingCount: 0,
      carryOvers: [{ source: "review" as const, ticket: "T1", severity: "nit" as const, text: "n" }],
    };
    assert.equal(renderCarryOverSection(onlyNit, "sid", {}), null);
    const empty = { readiness: "ready" as const, reviewVerdict: null, blockingCount: 0, carryOvers: [] };
    assert.equal(renderCarryOverSection(empty, "sid", {}), null);
  });

  await check("renderCarryOverSection: null verdict -> 'unknown'; text normalized to one line", () => {
    const report = {
      readiness: "blocked" as const,
      reviewVerdict: null,
      blockingCount: 1,
      carryOvers: [
        { source: "review" as const, ticket: "T2", severity: "blocking" as const, text: "line one\n# Heading\n-  sub   item" },
      ],
    };
    const s = renderCarryOverSection(report, "sid", {})!;
    assert.match(s, /Review verdict: unknown/);
    assert.match(s, /- \[blocking\] T2: line one # Heading - sub item/);
    assert.equal(s.split("\n").filter((l) => l.startsWith("- [")).length, 1);
  });

  await check("renderCarryOverSection: ticket + sourceSprintId normalized to single line", () => {
    const report = {
      readiness: "blocked" as const,
      reviewVerdict: "REQUEST CHANGES",
      blockingCount: 1,
      carryOvers: [
        { source: "review" as const, ticket: "T3\n / Gate 2", severity: "blocking" as const, text: "drift" },
      ],
    };
    const s = renderCarryOverSection(report, "sid\ninjected", {})!;
    // provenance + bullet must each remain a single line (no break-out)
    assert.match(s, /> - Source sprint: sid injected/);
    assert.match(s, /- \[blocking\] T3 \/ Gate 2: drift/);
    assert.equal(s.split("\n").filter((l) => l.startsWith("- [")).length, 1);
    assert.equal(s.split("\n").filter((l) => l.startsWith("> - Source sprint:")).length, 1);
  });
}

main().finally(() => {
  if (failures > 0) {
    console.error(`\n${failures} readiness test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll readiness tests passed.");
});
