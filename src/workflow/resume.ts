import { StateStore } from "./state-store.js";
import {
  gitResetHard,
  gitTagExists,
  stepTagName,
  iterationTagName,
  sprintDoneTagName,
  sprintInitTagName,
} from "./git-checkpoint.js";
import { runSprint, type RunSprintOptions, type SprintResult } from "./sprint-engine.js";
import type { Recipe } from "../recipe/types.js";

export interface ResumeSprintOptions
  extends Omit<RunSprintOptions, "startFromStepIdx" | "sprintId"> {
  recipe: Recipe;
  sprintDir: string;
  /** Defaults to the failedAt.stepIdx when set, otherwise state.currentStepIdx. */
  targetStepIdx?: number;
  /**
   * Re-run from this iteration of the target step's forEach (e.g. "T3").
   * Trims `state.completedIterations[stepName]` to drop this id and any after
   * it, so the engine re-executes from this iter forward. Only valid when the
   * target step has `forEach` set.
   */
  iterId?: string;
  /**
   * Skip the `git reset --hard` step. Use when the engine itself has been
   * patched between the original failure and this resume — a reset would
   * jump HEAD back to the pre-fix commit and re-trigger the same bug. The
   * caller is responsible for ensuring the sprint dir / working tree is in
   * a consistent state (state.json + step artifacts intact). Default false.
   */
  skipReset?: boolean;
}

function prevStepResetTag(
  sprintId: string,
  target: number,
  recipe: Recipe,
): string {
  return target === 0
    ? sprintInitTagName(sprintId)
    : stepTagName(sprintId, target - 1, recipe.steps[target - 1]!.name);
}

/**
 * Resume a sprint that previously aborted (sprint-failed) or was paused.
 *
 * Behaviour:
 * 1. Refuses if `sprint-done` tag already exists (sprint is complete).
 * 2. Picks target step: explicit `targetStepIdx` > state.failedAt.stepIdx > state.currentStepIdx.
 * 3. Computes reset tag:
 *      - `--iter` set OR `state.failedAt.iteration` set: reset to the previous
 *        completed iteration's tag (or previous step tag if none).
 *      - otherwise: reset to previous step tag (or sprint-init when target===0).
 * 4. `git reset --hard <tag>` unless `--no-reset` is passed; when `--no-reset`
 *    is used with `--iter`, trims `state.completedIterations[stepName]` in
 *    place so the engine re-runs the requested iter (and any after).
 * 5. Calls runSprint with `startFromStepIdx = target`, which `load`s state,
 *    emits `sprint-resumed`, and hydrates prior step + iteration artifacts.
 */
export async function resumeSprint(opts: ResumeSprintOptions): Promise<SprintResult> {
  const { recipe, sprintDir } = opts;
  const store = new StateStore(sprintDir);
  const state = store.load();
  if (!state) {
    throw new Error(`No state.json found at ${sprintDir}; nothing to resume.`);
  }

  const sprintId = state.sprintId;
  if (gitTagExists(sprintDoneTagName(sprintId), sprintDir)) {
    throw new Error(
      `Refusing to resume: sprint ${sprintId} already has ${sprintDoneTagName(sprintId)}.`,
    );
  }

  const target =
    opts.targetStepIdx ??
    state.failedAt?.stepIdx ??
    state.currentStepIdx;
  if (target < 0 || target >= recipe.steps.length) {
    throw new Error(
      `targetStepIdx=${target} out of bounds (recipe has ${recipe.steps.length} steps).`,
    );
  }

  const targetStep = recipe.steps[target]!;
  const completedList = state.completedIterations?.[targetStep.name] ?? [];

  let resetTag: string;
  let trimmedListForSkipReset: string[] | null = null;

  if (opts.iterId) {
    if (!targetStep.forEach) {
      throw new Error(
        `--iter requires a forEach step; "${targetStep.name}" is not configured for forEach.`,
      );
    }
    const idx = completedList.indexOf(opts.iterId);
    const trimmed = idx >= 0 ? completedList.slice(0, idx) : completedList;
    if (trimmed.length === 0) {
      resetTag = prevStepResetTag(sprintId, target, recipe);
    } else {
      resetTag = iterationTagName(sprintId, target, targetStep.name, trimmed[trimmed.length - 1]!);
    }
    trimmedListForSkipReset = trimmed;
  } else if (state.failedAt?.iteration && state.failedAt.stepIdx === target) {
    if (completedList.length === 0) {
      resetTag = prevStepResetTag(sprintId, target, recipe);
    } else {
      resetTag = iterationTagName(
        sprintId,
        target,
        targetStep.name,
        completedList[completedList.length - 1]!,
      );
    }
  } else {
    resetTag = prevStepResetTag(sprintId, target, recipe);
  }

  // Phase 7.2 review #1: when the sprint is still in the `ag init` phase,
  // the user has been told to edit INPUT.md / agentflow.config.json BEFORE
  // launching. A blind `git reset --hard sprint-init` would silently revert
  // those edits and run the sprint against the placeholder brief. Treat
  // phase="initialized" as an implicit --no-reset so the workflow the docs
  // describe actually works.
  const effectiveSkipReset = opts.skipReset || state.phase === "initialized";

  if (effectiveSkipReset) {
    if (trimmedListForSkipReset !== null) {
      const map = { ...(state.completedIterations ?? {}) };
      if (trimmedListForSkipReset.length === 0) {
        delete map[targetStep.name];
      } else {
        map[targetStep.name] = trimmedListForSkipReset;
      }
      state.completedIterations = map;
      store.save(state);
    }
  } else {
    if (!gitTagExists(resetTag, sprintDir)) {
      throw new Error(`Cannot resume: tag ${resetTag} not found.`);
    }
    gitResetHard(resetTag, sprintDir);
  }

  return runSprint({
    ...opts,
    sprintId,
    startFromStepIdx: target,
  });
}
