import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { OnMaxRepeat } from "./sprint-engine.js";

/**
 * Human gate — pauses the sprint after each step for explicit approval.
 *
 * The engine calls `gate(ctx)` once a step's Quality Loop has converged and its
 * artifact has been written + committed + tagged. The gate decides:
 *
 * - `approve`      — accept and proceed to the next step (default path)
 * - `force-pass`   — accept even though the human had concerns (recorded
 *                    distinctly in events.jsonl). Behaves like `approve` for
 *                    the engine; the differentiation is purely audit-trail.
 * - `rollback`     — roll the repo back to the tag of `targetStepIdx - 1` and
 *                    re-run from `targetStepIdx`. Effectively a "redo from step
 *                    N" command. `targetStepIdx === 0` is rejected by the engine
 *                    today (no pre-step-0 tag exists yet).
 */
export type HumanGateDecisionKind = "approve" | "force-pass" | "rollback";

export interface HumanGateApprove {
  kind: "approve" | "force-pass";
  note?: string;
}

export interface HumanGateRollback {
  kind: "rollback";
  /**
   * Step index to re-run. 0-based. Engine resets to the previous step's tag
   * (or sprint-init when target === 0) and re-runs from `targetStepIdx`.
   */
  targetStepIdx: number;
  note?: string;
}

export type HumanGateDecision = HumanGateApprove | HumanGateRollback;

export interface HumanGateContext {
  step: string;
  stepIdx: number;
  score: number;
  attempts: number;
  artifactPath: string;
  /** The accepted artifact body. */
  output: string;
  /** Step names completed so far, in order. Index = stepIdx in recipe. */
  completedSteps: string[];
  /** Whether the loop force-passed (failed but engine accepted via onMaxRepeat). */
  forced: boolean;
}

export type HumanGate = (ctx: HumanGateContext) => Promise<HumanGateDecision>;

/** Always approves. Equivalent to passing no gate at all. */
export const autoApproveGate: HumanGate = async () => ({ kind: "approve" });

/**
 * Read a decision from stdin. Useful for `tsx run-sprint.ts` usage.
 *
 * Prompt format:
 *   [gate] step "<name>" score=<n> attempts=<n> -> a)pprove  f)orce-pass  r)ollback N  q)uit
 *
 * - "a" / "approve" / "" (enter)            → approve
 * - "f" / "force-pass" [note...]            → force-pass (optional trailing note)
 * - "r N" / "rollback N" [note...]          → rollback to step idx N (1-based as
 *                                              displayed; converted internally)
 * - "q" / "quit"                            → throws AbortError-equivalent
 *
 * Indexes displayed to humans are 1-based (matching the directory prefix); the
 * returned decision uses the engine's 0-based stepIdx.
 */
export const stdinHumanGate: HumanGate = async (ctx) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const stepNum = ctx.stepIdx + 1;
    console.log(
      `\n[gate] step ${stepNum} "${ctx.step}" passed (score=${ctx.score}, attempts=${ctx.attempts}${ctx.forced ? ", forced" : ""}).`,
    );
    console.log(`[gate] artifact: ${ctx.artifactPath}`);
    console.log(
      `[gate] options: (a)pprove · (f)orce-pass · (r N) re-run from step N (1..${stepNum}) · (q)uit`,
    );

    while (true) {
      const raw = (await rl.question("[gate] > ")).trim();
      if (raw === "" || /^a(pprove)?$/i.test(raw)) {
        return { kind: "approve" };
      }
      const forceMatch = raw.match(/^f(?:orce-pass)?(?:\s+(.+))?$/i);
      if (forceMatch) {
        return { kind: "force-pass", note: forceMatch[1] };
      }
      const rollMatch = raw.match(/^r(?:ollback)?\s+(\d+)(?:\s+(.+))?$/i);
      if (rollMatch) {
        const human = Number(rollMatch[1]);
        if (!Number.isInteger(human) || human < 1 || human > stepNum) {
          console.log(`[gate] invalid target: must be 1..${stepNum}`);
          continue;
        }
        return { kind: "rollback", targetStepIdx: human - 1, note: rollMatch[2] };
      }
      if (/^q(uit)?$/i.test(raw)) {
        throw new Error("Sprint aborted by user at human gate.");
      }
      console.log(`[gate] unknown command: ${raw}`);
    }
  } finally {
    rl.close();
  }
};

/**
 * File name the sidecar gate watches. Constant — both the producer
 * (web server) and consumer (engine) reference this. One file per
 * sprint dir; new decisions overwrite. The engine removes the file
 * after consumption so a stale decision from the previous step never
 * resolves the current one.
 */
export const SIDECAR_GATE_FILE = ".gate-decision.json";

/** Parsed decision file contents. Mirror of HumanGateDecision but
 *  with `stepIdx` so the web client can address a specific gate. */
export interface SidecarGateDecisionFile {
  kind: HumanGateDecisionKind;
  /** Step index the decision targets. Engine compares against the
   *  current `ctx.stepIdx`; mismatched files are ignored. */
  stepIdx?: number;
  /** Required when kind="rollback". */
  targetStepIdx?: number;
  /** Required when kind="rollback" — must be 0 or positive. */
  note?: string;
}

/**
 * Parses + validates a sidecar decision file's parsed JSON. Returns the
 * matching `HumanGateDecision` or `null` if the payload is invalid. We
 * never throw on bad input — the caller polls again on the next tick.
 *
 * Exported for the web layer to validate POST /gate bodies against the
 * same shape the engine accepts.
 */
export function parseSidecarDecision(raw: unknown): HumanGateDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === "approve" || kind === "force-pass") {
    const note = typeof obj.note === "string" ? obj.note : undefined;
    return { kind, ...(note ? { note } : {}) };
  }
  if (kind === "rollback") {
    const target = obj.targetStepIdx;
    if (!Number.isInteger(target) || (target as number) < 0) return null;
    const note = typeof obj.note === "string" ? obj.note : undefined;
    return { kind, targetStepIdx: target as number, ...(note ? { note } : {}) };
  }
  return null;
}

/**
 * Builds a `HumanGate` that resolves when `<dir>/.gate-decision.json`
 * appears with a matching `stepIdx` field. Used by sprints spawned from
 * the web UI: the server POST /gate writes the file, the engine picks
 * it up at its next poll, and the loop proceeds.
 *
 * Polls at `pollIntervalMs` (default 250ms). The file is removed after
 * a successful read so a stale decision can't leak into the next step.
 * Decisions for a different step (mismatched `stepIdx`) are ignored
 * silently — they may belong to a downstream step that has not yet
 * reached its gate.
 */
export function sidecarHumanGate(
  dir: string,
  options: { pollIntervalMs?: number } = {},
): HumanGate {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  // Ensure the dir exists once at build time so the first poll doesn't
  // race against a not-yet-created parent.
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, SIDECAR_GATE_FILE);

  return async (ctx) => {
    console.log(
      `[sidecar-gate] waiting for decision on step ${ctx.stepIdx + 1} "${ctx.step}" — write ${filePath}`,
    );
    while (true) {
      if (existsSync(filePath)) {
        try {
          const raw = readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const targetStep = parsed.stepIdx;
          if (Number.isInteger(targetStep) && targetStep !== ctx.stepIdx) {
            // Stale decision for a different step — leave it alone in
            // case a downstream gate picks it up later. Skip and wait.
          } else {
            const decision = parseSidecarDecision(parsed);
            if (decision) {
              try { unlinkSync(filePath); } catch { /* ignore */ }
              return decision;
            }
            // Malformed; remove and keep waiting.
            try { unlinkSync(filePath); } catch { /* ignore */ }
          }
        } catch {
          // Mid-write race or corrupt JSON — try again next tick.
        }
      }
      await delay(pollIntervalMs);
    }
  };
}

/**
 * `onMaxRepeat` implementation that pauses the engine when a step's Quality
 * Loop fails to reach targetScore within maxRepeat attempts, and asks the
 * human at the terminal whether to abort or force-pass.
 *
 * This is the canonical `action_on_max_fail: "human_intervene"` mode from the
 * AgentFlow guide — every step must clear its own Quality Loop before the
 * engine proceeds; if 3 attempts can't converge, a human decides.
 *
 *   - "a" / "abort"          → tag sprint-failed and throw (default behaviour)
 *   - "f" / "force-pass"     → accept last-attempt output (artifact records
 *                              `forced: true`), continue to next step
 */
export const stdinOnMaxRepeat: OnMaxRepeat = async (ctx) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      `\n[max-repeat] step ${ctx.stepIdx + 1} "${ctx.step}" did not converge after ${ctx.attempts} attempts.`,
    );
    console.log(`[max-repeat] final score: ${ctx.finalScore} (target=${ctx.targetScore})`);
    const preview = ctx.finalOutput.length > 400
      ? ctx.finalOutput.slice(0, 400) + "\n…(truncated)"
      : ctx.finalOutput;
    console.log("[max-repeat] last output preview:");
    console.log("--- ARTIFACT ---");
    console.log(preview);
    console.log("--- END ---");
    console.log(`[max-repeat] options: (a)bort sprint · (f)orce-pass and continue`);

    while (true) {
      const raw = (await rl.question("[max-repeat] > ")).trim();
      if (raw === "" || /^a(bort)?$/i.test(raw)) return "abort";
      if (/^f(orce-pass)?$/i.test(raw)) return "force-pass";
      console.log(`[max-repeat] unknown command: ${raw}`);
    }
  } finally {
    rl.close();
  }
};
