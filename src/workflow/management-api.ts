import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SprintEvent, StateStore } from "./state-store.js";

export interface SprintSummary {
  sprintId: string;
  recipeName: string;
  sprintDir: string;
  phase: "initialized" | "completed" | "failed" | "running";
  currentStepIdx: number;
  completedSteps: string[];
  startedAt: string;
  lastEventTs: string;
  totalTokens: number;
  totalCostUsd: number;
  readiness?: string;
}

export type ControlActionType =
  | "approve"
  | "request-changes"
  | "force-pass"
  | "resume"
  | "pin-iter";

export interface ControlAction {
  action: ControlActionType;
  step?: string;
  note?: string;
}

/**
 * Helper to build a SprintSummary from a sprint directory.
 */
export function getSprintSummary(sprintDir: string): SprintSummary | null {
  const stateStore = new StateStore(sprintDir);
  const state = stateStore.load();
  if (!state) return null;

  const eventsPath = join(sprintDir, "events.jsonl");
  let events: SprintEvent[] = [];
  if (existsSync(eventsPath)) {
    try {
      events = readFileSync(eventsPath, "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as SprintEvent);
    } catch {}
  }

  // Calculate total tokens and cost
  let totalTokens = 0;
  let totalCostUsd = 0;
  let lastEventTs = state.lastEventTs;

  for (const ev of events) {
    if (ev.tokens) totalTokens += ev.tokens;
    if (ev.costUsd) totalCostUsd += ev.costUsd;
    if (ev.ts) lastEventTs = ev.ts;
  }

  // Determine sprint phase
  let phase: SprintSummary["phase"] = "running";
  if (state.phase === "initialized") {
    phase = "initialized";
  } else if (state.failedAt) {
    phase = "failed";
  } else if (events.some((e) => e.type === "sprint-completed")) {
    phase = "completed";
  }

  // Try to find readiness status from events
  let readiness = "unknown";
  const readinessEv = events.find((e) => e.type === "step-passed" && e.msg?.includes("readiness"));
  if (readinessEv) {
    readiness = "ready";
  } else if (phase === "completed") {
    readiness = "ready";
  }

  return {
    sprintId: state.sprintId,
    recipeName: state.recipeName,
    sprintDir,
    phase,
    currentStepIdx: state.currentStepIdx,
    completedSteps: state.completedSteps,
    startedAt: state.startedAt,
    lastEventTs,
    totalTokens,
    totalCostUsd,
    readiness,
  };
}
