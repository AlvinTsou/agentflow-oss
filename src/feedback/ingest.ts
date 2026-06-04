/**
 * Feedback ingestion helper.
 *
 * Reads `.agentflow-feedback/{issues.json, feedback.jsonl, edits.jsonl}` and
 * builds a Markdown block the engine prepends to producePrompt + rubric
 * so PM / designer notes reach the next step's LLM call. Audit-only by
 * itself — sprint-engine.ts decides when to inject (default: every
 * non-skipped step where consumeFeedback is not explicitly false).
 *
 * Filters:
 * - issues:   open  = WebIssue.status !== "done"
 * - feedback: open  = !resolvedAt && type !== "force-pass"
 *               (force-pass notes carry no actionable content, but are
 *                listed under their own header for the audit trail)
 * - edits:    most-recent N where targetStep === step
 *
 * Returns the rendered block plus the list of IDs that were folded in,
 * so the engine's `feedback-consumed` event closes the loop.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArtifactEdit, WebFeedbackEvent, WebIssue } from "./types.js";
import { FEEDBACK_DIR } from "./paths.js";

export interface IngestResult {
  /** Markdown block. Empty string when no items match. */
  contextBlock: string;
  /** IDs of every issue / feedback / edit that appeared in the block. */
  consumedIds: string[];
  /** Open request-changes records for this step (unresolved). Caller
   *  decides whether to block step pass on these. */
  openRequestChanges: WebFeedbackEvent[];
}

export interface BlockedCheck {
  /** True when at least one open RC exists AND no force-pass record for
   *  the step is newer than the most recent open RC. */
  blocked: boolean;
  /** IDs of every open RC that contributed to the block (empty when
   *  `blocked` is false). */
  blockingIds: string[];
  /** Most recent force-pass record for this step, if any. Newer than
   *  every open RC means the block is bypassed. */
  latestForcePassAt?: string;
}

export interface IngestOptions {
  sprintDir: string;
  step: string;
  /** When set, returns feedback that's either step-wide
   *  (`fb.iteration` unset) OR matches `opts.iteration`. When unset,
   *  returns step-level feedback only (every iter is excluded, matching
   *  the single-pass call site's expectation). */
  iteration?: string;
  /** Newest-first cap on direct edit audit lines. Default 5. */
  maxEditSummaries?: number;
}

function readJsonlSafe<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

function readJsonSafe<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function fmtDate(iso: string): string {
  return iso.split("T")[0] ?? iso;
}

function quoteBody(body: string): string {
  return body
    .trim()
    .split("\n")
    .map((l) => `  > ${l}`)
    .join("\n");
}

/**
 * Build the human_context block for one step. Returns an empty block
 * when nothing matches — callers can skip injection cheaply.
 */
export function ingestFeedback(opts: IngestOptions): IngestResult {
  const { sprintDir, step } = opts;
  const iter = opts.iteration;
  const maxEdits = opts.maxEditSummaries ?? 5;
  const feedbackDir = join(sprintDir, FEEDBACK_DIR);

  const allIssues = readJsonSafe<WebIssue[]>(join(feedbackDir, "issues.json"), []);
  const allFeedback = readJsonlSafe<WebFeedbackEvent>(join(feedbackDir, "feedback.jsonl"));
  const allEdits = readJsonlSafe<ArtifactEdit>(join(feedbackDir, "edits.jsonl"));

  const openIssues = allIssues.filter(
    (it) => it.status !== "done" && it.linkedStep === step,
  );

  // Iteration filter:
  // - opts.iteration set   -> include fb where fb.iteration is unset (step-wide)
  //                           OR fb.iteration === opts.iteration
  // - opts.iteration unset -> include fb where fb.iteration is unset only
  //                           (don't bleed iter-targeted feedback into the
  //                           single-pass / step-aggregate prompt)
  const iterMatch = (fb: WebFeedbackEvent): boolean =>
    iter !== undefined ? !fb.iteration || fb.iteration === iter : !fb.iteration;

  const stepFeedback = allFeedback.filter(
    (fb) => fb.step === step && !fb.resolvedAt && iterMatch(fb),
  );
  const comments = stepFeedback.filter((fb) => fb.type === "comment");
  const changeRequests = stepFeedback.filter((fb) => fb.type === "change-request");
  const requestChanges = stepFeedback.filter((fb) => fb.type === "request-changes");
  const approvals = stepFeedback.filter((fb) => fb.type === "approval");
  // force-pass: include resolved + unresolved (audit-only, no action).
  // iter filter still applies — a per-iter force-pass shouldn't show
  // in every iter's context.
  const forcePasses = allFeedback.filter(
    (fb) => fb.step === step && fb.type === "force-pass" && iterMatch(fb),
  );

  const stepEdits = allEdits
    .filter((ed) => ed.targetStep === step)
    .slice(-maxEdits)
    .reverse();

  const sections: string[] = [];
  const consumedIds: string[] = [];

  if (openIssues.length > 0) {
    sections.push(`### Open issues (PM / designer)`);
    for (const it of openIssues) {
      sections.push(
        `- **#${it.id}** [${it.status}] ${it.title} — ${it.author}, ${fmtDate(it.createdAt)}`,
      );
      if (it.body.trim()) sections.push(quoteBody(it.body));
      consumedIds.push(it.id);
    }
    sections.push("");
  }

  if (requestChanges.length > 0) {
    sections.push(`### Request changes (must be addressed)`);
    for (const fb of requestChanges) {
      sections.push(
        `- **${fb.id}** ${fb.author}, ${fmtDate(fb.createdAt)}`,
      );
      sections.push(quoteBody(fb.body));
      consumedIds.push(fb.id);
    }
    sections.push("");
  }

  if (changeRequests.length > 0) {
    sections.push(`### Change requests`);
    for (const fb of changeRequests) {
      sections.push(`- **${fb.id}** ${fb.author}, ${fmtDate(fb.createdAt)}`);
      sections.push(quoteBody(fb.body));
      consumedIds.push(fb.id);
    }
    sections.push("");
  }

  if (comments.length > 0) {
    sections.push(`### Comments`);
    for (const fb of comments) {
      sections.push(`- **${fb.id}** ${fb.author}, ${fmtDate(fb.createdAt)}: ${fb.body.trim()}`);
      consumedIds.push(fb.id);
    }
    sections.push("");
  }

  if (approvals.length > 0) {
    sections.push(`### Approvals (informational)`);
    for (const fb of approvals) {
      sections.push(`- **${fb.id}** ${fb.author}, ${fmtDate(fb.createdAt)}: ${fb.body.trim()}`);
      consumedIds.push(fb.id);
    }
    sections.push("");
  }

  if (forcePasses.length > 0) {
    sections.push(`### Force-pass notes (informational)`);
    for (const fb of forcePasses) {
      sections.push(`- **${fb.id}** ${fb.author}, ${fmtDate(fb.createdAt)}: ${fb.body.trim()}`);
      consumedIds.push(fb.id);
    }
    sections.push("");
  }

  if (stepEdits.length > 0) {
    sections.push(`### Recent direct edits (audit)`);
    for (const ed of stepEdits) {
      sections.push(
        `- ${fmtDate(ed.createdAt)} ${ed.author} edited ${ed.targetFile} (${ed.baseHash.slice(0, 7)} → ${ed.newHash.slice(0, 7)})`,
      );
      consumedIds.push(ed.id);
    }
    sections.push("");
  }

  const contextBlock = sections.length > 0
    ? `## Human context for step "${step}"\n\n` + sections.join("\n")
    : "";

  return {
    contextBlock,
    consumedIds,
    openRequestChanges: requestChanges,
  };
}

/**
 * Pure check: does any open request-changes record for this step
 * supersede the most recent force-pass record?
 *
 * Semantics (time-based supersession, no engine state mutation):
 * - "Open" = !resolvedAt.
 * - When no open RC exists -> not blocked.
 * - When open RC exists AND no force-pass record exists for the step
 *   -> blocked.
 * - When open RC exists AND a force-pass record exists for the step,
 *   AND the most recent force-pass createdAt > the most recent open
 *   RC createdAt -> NOT blocked (force-pass supersedes).
 * - Otherwise -> blocked.
 *
 * New RCs filed after a force-pass legitimately block again. This
 * keeps the gate single-use per "round" without engine bookkeeping.
 */
export function checkRequestChangesBlock(opts: {
  sprintDir: string;
  step: string;
  /** Iter-level block check (engine calls per iter). Same
   *  filter semantics as ingestFeedback: unset = step-level only,
   *  set = step-level OR matching iter. */
  iteration?: string;
}): BlockedCheck {
  const { sprintDir, step } = opts;
  const iter = opts.iteration;
  // Block filter is STRICTER than ingest's filter:
  // - iter call (iter set)   -> only fb.iteration === iter (step-wide
  //                              RCs do NOT block individual iters;
  //                              they block the aggregate instead).
  // - aggregate (iter unset) -> only !fb.iteration (iter-specific RCs
  //                              don't block the aggregate; they block
  //                              their own iter).
  // The cross-cutting matrix is intentional: a step-wide RC blocks once
  // at the aggregate, NOT N times across N iters; an iter-specific RC
  // blocks only that iter and lets the rest of the forEach continue.
  const iterMatch = (fb: WebFeedbackEvent): boolean =>
    iter !== undefined ? fb.iteration === iter : !fb.iteration;
  const feedbackDir = join(sprintDir, FEEDBACK_DIR);
  const allFeedback = readJsonlSafe<WebFeedbackEvent>(
    join(feedbackDir, "feedback.jsonl"),
  );
  const openRCs = allFeedback.filter(
    (fb) =>
      fb.type === "request-changes" &&
      fb.step === step &&
      !fb.resolvedAt &&
      iterMatch(fb),
  );
  if (openRCs.length === 0) {
    return { blocked: false, blockingIds: [] };
  }
  const forcePasses = allFeedback.filter(
    (fb) => fb.type === "force-pass" && fb.step === step && iterMatch(fb),
  );
  const latestRCAt = openRCs
    .map((r) => r.createdAt)
    .sort()
    .pop()!;
  const latestFPAt = forcePasses
    .map((f) => f.createdAt)
    .sort()
    .pop();
  if (latestFPAt && latestFPAt > latestRCAt) {
    return { blocked: false, blockingIds: [], latestForcePassAt: latestFPAt };
  }
  return {
    blocked: true,
    blockingIds: openRCs.map((r) => r.id),
    ...(latestFPAt ? { latestForcePassAt: latestFPAt } : {}),
  };
}
