import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface SprintFailure {
  step: string;
  stepIdx: number;
  score: number;
  attempts: number;
  ts: string;
  /**
   * "convergence" — Quality Loop ran maxRepeat attempts and never hit
   * targetScore. score/attempts are meaningful.
   *
   * "runtime" — a step phase threw (timeout, 80K breaker, max-turns, parse
   * error, etc.). score=0 and attempts=0 are placeholders; see the
   * accompanying `sprint-failed` event's `msg` for the error text.
   */
  reason?: "convergence" | "runtime";
  /** Error message for runtime failures. */
  errorMessage?: string;
  /**
   * forEach iteration id (e.g. "T3") when failure happens inside a forEach
   * step. Undefined for non-forEach steps or step-level failures.
   */
  iteration?: string;
}

export interface SprintState {
  recipeName: string;
  sprintId: string;
  currentStepIdx: number;
  completedSteps: string[];
  startedAt: string;
  lastEventTs: string;
  /**
   * Sprint lifecycle phase (Phase 7.2). `"initialized"` means `ag init`
   * wrote this state.json + the sprint-init tag without running any step
   * yet; resumes from step 0 should hydrate rather than re-init. Absent
   * for legacy sprints (those went through runSprint directly).
   */
  phase?: "initialized";
  failedAt?: SprintFailure;
  /** Live during a forEach step. Cleared once the step's aggregate finalises. */
  currentIteration?: string;
  /**
   * Per-step completed iteration ids, populated as each iteration passes.
   * Used by resume to skip already-done iterations within a forEach step.
   */
  completedIterations?: { [stepName: string]: string[] };
  /**
   * Recipe options snapshotted at sprint-init. Opaque to the engine — consumers
   * read it to reconstruct recipe-level config (e.g. language) on resume so
   * the CLI does not need to re-specify it. Never mutated after init.
   */
  recipeOptions?: Record<string, unknown>;
}

export type SprintEventType =
  | "sprint-started"
  | "sprint-resumed"
  | "sprint-completed"
  | "sprint-failed"
  | "step-started"
  | "step-passed"
  | "step-failed"
  | "step-force-passed"
  | "step-approved"
  | "step-skipped"
  | "step-condition-skipped"
  | "step-blocked"
  | "feedback-consumed"
  | "iteration-started"
  | "iteration-passed"
  | "iteration-failed"
  | "iteration-force-passed"
  | "rollback"
  | "phase"
  // Web-originated events (Phase 6 Stage 4). Written by the web server
  // when a browser triggers a gated action; never emitted by the engine.
  | "web-resume"
  | "web-gate-decision"
  | "web-pin-iter";

export interface SprintEvent {
  ts: string;
  type: SprintEventType;
  step?: string;
  /** forEach iteration id (e.g. "T3") for iteration-* events. */
  iteration?: string;
  attempt?: number;
  score?: number;
  tokens?: number;
  costUsd?: number;
  msg?: string;
  /**
   * Resolved per-iter provider override, formatted as
   * "<provider>" or "<provider>:<model>". Emitted on iteration-started
   * when ForEachConfig.providerForItemById / providerForItem resolved a
   * non-undefined override for this iter. Omitted when the iter ran
   * on the step-level default. Phase 5.
   */
  providerOverride?: string;
  /** Route decision metadata (Day 6 - Security Profiles And Route Audit). */
  route?: {
    provider: string;
    model?: string;
    reason: string;
    matchedRule?: string;
    warnings?: string[];
    policyProfile?: string;
  };
}

export class StateStore {
  private statePath: string;
  private eventsPath: string;
  private listeners: Array<(ev: SprintEvent) => void> = [];

  constructor(sprintDir: string) {
    mkdirSync(sprintDir, { recursive: true });
    this.statePath = join(sprintDir, "state.json");
    this.eventsPath = join(sprintDir, "events.jsonl");
  }

  load(): SprintState | null {
    if (!existsSync(this.statePath)) return null;
    return JSON.parse(readFileSync(this.statePath, "utf-8")) as SprintState;
  }

  save(state: SprintState): void {
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  init(recipeName: string, sprintId: string): SprintState {
    const now = new Date().toISOString();
    const state: SprintState = {
      recipeName,
      sprintId,
      currentStepIdx: 0,
      completedSteps: [],
      startedAt: now,
      lastEventTs: now,
    };
    this.save(state);
    return state;
  }

  subscribe(listener: (ev: SprintEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: Omit<SprintEvent, "ts">): SprintEvent {
    const ts = new Date().toISOString();
    const ev: SprintEvent = { ts, ...event };
    appendFileSync(this.eventsPath, JSON.stringify(ev) + "\n", "utf-8");
    for (const listener of this.listeners) {
      try {
        listener(ev);
      } catch (err) {
        console.error("[StateStore] Listener failed:", err);
      }
    }
    return ev;
  }
}
