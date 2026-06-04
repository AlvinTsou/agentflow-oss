/**
 * readiness — derive a ReadinessReport from a finished sprint's review + wrap
 * artifacts. Pure parsers + aggregator; no model calls. The SDD review step is
 * a meta-rubric (its score grades the review report, not mergeability), so a
 * 10/10 review can still say "REQUEST CHANGES" with [blocking] findings. This
 * module surfaces that gap. See docs/superpowers/specs/2026-06-02-readiness-gate-design.md.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Severity = "blocking" | "deferred" | "nit";
export type Readiness = "blocked" | "ready" | "unknown";

export interface CarryOver {
  source: "review" | "wrap" | "contract-guard";
  ticket: string; // e.g. "T5" or "T3 / Gate 2"; "" if not attributable
  severity: Severity;
  text: string;
}

export interface ReadinessReport {
  readiness: Readiness;
  reviewVerdict: string | null;
  blockingCount: number;
  carryOvers: CarryOver[];
}

export type GuardStatus = "OK" | "MISMATCH" | "NONE" | "WARN";
export type GuardSeverity = "blocking" | "warning" | "info";

export interface ContractGuardDecision {
  guardName: string;
  step: string;
  iterationId: string | null;
  status: GuardStatus;
  source: "explicit" | "heuristic";
  severity: GuardSeverity;
  missingLiterals: string[];
  missingFields: string[];
  scoreCap?: number;
  attempt: number;
  createdAt: string;
}

interface ContractGuardFile {
  version: 1;
  decisions: ContractGuardDecision[];
}

/** Guard status -> the decision's own severity. NONE => null (not recorded). */
export function guardSeverityFor(status: GuardStatus): GuardSeverity | null {
  if (status === "MISMATCH") return "blocking";
  if (status === "WARN") return "warning";
  if (status === "OK") return "info";
  return null; // NONE
}

/** Map a contract-guard.json document to CarryOvers. blocking->blocking,
 *  warning->deferred (non-blocking), info->omitted. Tolerant of null/malformed. */
export function parseContractGuardCarryOvers(json: string | null): CarryOver[] {
  if (!json) return [];
  let doc: ContractGuardFile;
  try {
    doc = JSON.parse(json);
  } catch {
    return [];
  }
  if (!doc || doc.version !== 1 || !Array.isArray(doc.decisions)) return [];
  const out: CarryOver[] = [];
  for (const d of doc.decisions) {
    const sev = d.severity === "blocking" ? "blocking" : d.severity === "warning" ? "deferred" : null;
    if (!sev) continue;
    const lit = (d.missingLiterals ?? []).join(", ");
    const fld = (d.missingFields ?? []).join(", ");
    const detail =
      lit || fld ? `missing literals [${lit}] / fields [${fld}]` : `guard ${d.guardName}`;
    const text = `${d.step}: contract drift — ${detail}`;
    out.push({ source: "contract-guard", ticket: "", severity: sev, text });
  }
  return out;
}

/** Idempotent upsert: replace any existing decision with the same
 *  guardName+step+iterationId, then append. Tolerant of absent/malformed file. */
export function upsertContractGuardDecision(sprintDir: string, decision: ContractGuardDecision): void {
  const file = join(sprintDir, "contract-guard.json");
  let doc: ContractGuardFile = { version: 1, decisions: [] };
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8"));
      if (parsed && parsed.version === 1 && Array.isArray(parsed.decisions)) doc = parsed;
    } catch {
      // malformed -> start fresh
    }
  }
  doc.decisions = doc.decisions.filter(
    (d) =>
      !(
        d.guardName === decision.guardName &&
        d.step === decision.step &&
        (d.iterationId ?? null) === (decision.iterationId ?? null)
      ),
  );
  doc.decisions.push(decision);
  writeFileSync(file, JSON.stringify(doc, null, 2), "utf-8");
}

/** First non-empty line under a `## Verdict` heading, normalised to a known
 *  token when recognised. Returns null when there is no Verdict section. */
export function parseReviewVerdict(reviewMd: string): string | null {
  const m = reviewMd.match(/^##\s+Verdict\s*\n+([^\n]+)/m);
  if (!m) return null;
  const line = m[1].trim();
  if (/request\s+changes/i.test(line)) return "REQUEST CHANGES";
  if (/approve/i.test(line)) return "APPROVE";
  return line || null;
}

/** Review findings shaped `- T1 [blocking] text` (ticket optional; an
 *  unattributable finding gets `ticket: ""`). */
export function parseReviewFindings(reviewMd: string): CarryOver[] {
  const out: CarryOver[] = [];
  const re = /^-\s*(T\d+)?\s*\[(blocking|deferred|nit)\]\s*(.*)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reviewMd)) !== null) {
    out.push({
      source: "review",
      ticket: (m[1] ?? "").trim(),
      severity: m[2].toLowerCase() as Severity,
      text: m[3].trim(),
    });
  }
  return out;
}

/** Extract ticket from the bold span of a Pattern-B bullet.
 *  Splits on em-dash (U+2014) first, then on a colon that ends the bold title.
 *  Preserves slash-separated compound tickets like `T3 / Gate 2` and `T4 / T8`. */
function extractTicketFromBoldSpan(boldSpan: string): string {
  // em-dash split: "T5 — rootDir conflict" → "T5"
  const emDashIdx = boldSpan.indexOf("—");
  if (emDashIdx !== -1) return boldSpan.slice(0, emDashIdx).trim();
  // colon split: "T8 — barrel not updated" already handled above; fallback for "T8: title"
  const colonIdx = boldSpan.indexOf(":");
  if (colonIdx !== -1) return boldSpan.slice(0, colonIdx).trim();
  return boldSpan.trim();
}

/** Detect a severity word from a non-bullet heading line that contains `**`.
 *  Returns null if the line is not a severity-bearing heading. */
function detectHeadingSeverity(line: string): Severity | null {
  // "Blocking carry-overs from review" (no parens needed)
  if (/blocking carry-?overs/i.test(line)) return "blocking";
  // Must contain ** to be a bold heading candidate
  if (!line.includes("**")) return null;
  // Paren form: (blocking) / (carry-over, blocking)
  const parenMatch = line.match(/\((?:carry-over,\s*)?\s*(blocking|deferred|nit)\b/i);
  if (parenMatch) return parenMatch[1].toLowerCase() as Severity;
  // Plain word form inside bold heading: **Blocking carry-overs...**
  const wordMatch = line.match(/\b(blocking|deferred|nit)\b/i);
  if (wordMatch) return wordMatch[1].toLowerCase() as Severity;
  return null;
}

/** Wrap follow-ups. Handles two structural patterns:
 *
 *  Pattern A — severity inside the bullet's bold span:
 *    `- **T3 (blocking):** text`
 *    `- **T5 (carry-over, blocking):** text`
 *
 *  Pattern B — severity declared in a preceding bold heading line,
 *  bullets underneath carry no in-bullet severity:
 *    `**Carry-over from Review (blocking):**`
 *    `- **T5 — rootDir conflict**: text`
 *
 *  Ticket may be compound, e.g. `T3 / Gate 2` or `T4 / T8`. */
export function parseWrapCarryOvers(wrapMd: string): CarryOver[] {
  const lines = wrapMd.split("\n");

  // Locate the "## Open follow-ups" section.
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+open\s+follow-?ups/i.test(lines[i])) { start = i + 1; break; }
  }
  if (start === -1) return [];

  // Collect section lines up to the next "## " heading or "---" rule.
  const section: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) break;
    section.push(lines[i]);
  }

  const out: CarryOver[] = [];
  let headingSeverity: Severity | null = null;

  for (const line of section) {
    const isBullet = /^\s*-\s/.test(line);

    if (!isBullet) {
      // Check whether this is a severity-bearing bold heading
      const sev = detectHeadingSeverity(line);
      if (sev !== null) headingSeverity = sev;
      continue;
    }

    // --- bullet line ---

    // Pattern A: in-bullet severity (with or without "carry-over," prefix).
    // Bold may close before or after the colon: both `)**:**` and `)**` then `:` accepted.
    const patternA = line.match(
      /^-\s*\*\*(.+?)\s*\((?:carry-over,\s*)?\s*(blocking|deferred|nit)\s*\):?\*\*:?\s*(.*)$/i
    );
    if (patternA) {
      out.push({
        source: "wrap",
        ticket: patternA[1].trim(),
        severity: patternA[2].toLowerCase() as Severity,
        text: patternA[3].trim(),
      });
      continue;
    }

    // Pattern B: no in-bullet severity; rely on heading context
    if (headingSeverity !== null) {
      const patternB = line.match(/^-\s*\*\*(.+?)\*\*\s*:?\s*(.*)$/);
      if (patternB) {
        const ticket = extractTicketFromBoldSpan(patternB[1]);
        const text = patternB[2].trim();
        out.push({
          source: "wrap",
          ticket,
          severity: headingSeverity,
          text,
        });
      }
      // (if no bold span at all, skip — not a classified carry-over)
    }
    // if headingSeverity === null and no Pattern A match, skip
  }

  return out;
}

export function computeReadiness(input: {
  reviewMd: string | null;
  wrapMd: string | null;
  guardCarryOvers?: CarryOver[];
}): ReadinessReport {
  const reviewMd = input.reviewMd;
  const wrapMd = input.wrapMd;

  const reviewVerdict = reviewMd ? parseReviewVerdict(reviewMd) : null;
  const reviewFindings = reviewMd ? parseReviewFindings(reviewMd) : [];
  const wrapCarryOvers = wrapMd ? parseWrapCarryOvers(wrapMd) : [];
  const guardCarryOvers = input.guardCarryOvers ?? [];
  const carryOvers = [...reviewFindings, ...wrapCarryOvers, ...guardCarryOvers];
  const blockingCount = carryOvers.filter((c) => c.severity === "blocking").length;

  const anyBlocking = blockingCount > 0;
  let readiness: Readiness;
  if (anyBlocking) {
    readiness = "blocked";
  } else if (reviewMd === null) {
    readiness = "unknown";
  } else {
    readiness = reviewVerdict === "REQUEST CHANGES" ? "blocked" : "ready";
  }

  return { readiness, reviewVerdict, blockingCount, carryOvers };
}

/**
 * Render the prior sprint's carry-overs as a provenance-stamped, human-editable
 * markdown section to append to the next sprint's INPUT.md. Returns `null` when
 * there is nothing to inject at the selected severity. Pure (no fs). Each
 * carry-over `text` is normalized to a single trimmed line so a multi-line or
 * Markdown-bearing value cannot break the bullet list or leak a heading.
 */
export function renderCarryOverSection(
  report: ReadinessReport,
  sourceSprintId: string,
  opts: { includeDeferred?: boolean } = {},
): string | null {
  const wanted = new Set<Severity>(opts.includeDeferred ? ["blocking", "deferred"] : ["blocking"]);
  const items = report.carryOvers.filter((c) => wanted.has(c.severity));
  if (items.length === 0) return null;

  const lines: string[] = [
    "## Carry-over from prior round — must address",
    "> Provenance (preserve this provenance while this section remains in scope):",
    `> - Source sprint: ${sourceSprintId.replace(/\s+/g, " ").trim()}`,
    `> - Readiness: ${report.readiness}`,
    `> - Review verdict: ${report.reviewVerdict ?? "unknown"}`,
    ">",
    "> Unresolved items from the previous sprint's readiness report.",
    "> Edit/prune the list below before running; remove anything out of scope. If the",
    "> whole section is out of scope, delete it entirely (provenance included).",
    "",
  ];
  for (const c of items) {
    const text = c.text.replace(/\s+/g, " ").trim();
    const ticket = c.ticket.replace(/\s+/g, " ").trim();
    lines.push(ticket ? `- [${c.severity}] ${ticket}: ${text}` : `- [${c.severity}] ${text}`);
  }
  return lines.join("\n");
}

/** fs glue: locate `*-review/output.md` + `*-wrap/output.md` in a sprint dir
 *  and compute the report. Missing files degrade gracefully (null inputs). */
export function buildReadinessReport(sprintDir: string): ReadinessReport {
  const readStep = (suffix: string): string | null => {
    let entries: string[];
    try {
      entries = readdirSync(sprintDir);
    } catch {
      return null;
    }
    const dir = entries.find((e) => e.endsWith(`-${suffix}`));
    if (!dir) return null;
    const file = join(sprintDir, dir, "output.md");
    return existsSync(file) ? readFileSync(file, "utf-8") : null;
  };
  const guardFile = join(sprintDir, "contract-guard.json");
  const guardJson = existsSync(guardFile) ? readFileSync(guardFile, "utf-8") : null;
  return computeReadiness({
    reviewMd: readStep("review"),
    wrapMd: readStep("wrap"),
    guardCarryOvers: parseContractGuardCarryOvers(guardJson),
  });
}
