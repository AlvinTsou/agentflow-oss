import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

/**
 * Author identity prefix applied to every sprint-repo commit. Per Phase 7.2
 * review finding #4 — without this, sprint commits fail on CI / fresh dev
 * machines that have no global git user.email / user.name configured.
 * The values are deliberately generic: sprint repos are throwaway audit
 * artifacts, not collaborative history, so a synthetic identity is fine.
 */
export const SPRINT_GIT_IDENT_ARGS = [
  "-c",
  "user.email=agentflow@local",
  "-c",
  "user.name=AgentFlow",
] as const;

/**
 * Assert that `cwd` is the toplevel of its own git repository — i.e. it is
 * NOT inside a parent repository's worktree. Used by the sprint engine
 * before any commit/tag/reset operation to prevent the engine from
 * accidentally writing into the outer repo when a sprint dir is nested.
 *
 * Background: Phase 2.0 #2 introduced per-sprint .git/ but did not enforce
 * isolation at the boundary. Run H (Phase 6 closure) surfaced I6 where
 * ag-resume passed `gitCwd = process.cwd()` (engine root) and the engine
 * silently `git add . && commit`ed in the engine repo with sprint-style
 * messages. This guard makes a repeat of that bug fail loudly at init.
 */
export function assertGitToplevel(cwd: string): void {
  let top: string;
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(
      `assertGitToplevel: cwd ${cwd} is not inside any git repository ` +
        `(did initSprintRepo run?): ${(err as Error).message}`,
    );
  }
  const real = realpathSync(cwd);
  const topReal = realpathSync(top);
  if (topReal !== real) {
    throw new Error(
      `Refusing git op: cwd ${cwd} (realpath ${real}) is not the toplevel ` +
        `of its own git repo (toplevel=${topReal}). Sprint repo isolation ` +
        `is broken — the engine would write into the outer repo. ` +
        `Ensure initSprintRepo(${cwd}) ran successfully and sprintDir owns its own .git/.`,
    );
  }
}

export function gitTag(name: string, cwd: string): void {
  execFileSync("git", ["tag", "-f", name], { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

export function gitResetHard(ref: string, cwd: string): void {
  execFileSync("git", ["reset", "--hard", ref], { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

export function gitCurrentSha(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" }).trim();
}

export function gitStagedHasChanges(cwd: string): boolean {
  const out = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf-8" });
  return out.trim().length > 0;
}

/** Stage the given paths, then commit. Skips commit if nothing is staged. */
export function gitCommit(addPaths: string[], message: string, cwd: string): string | null {
  for (const p of addPaths) {
    execFileSync("git", ["add", "--", p], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  }
  if (!gitStagedHasChanges(cwd)) return null;
  execFileSync(
    "git",
    [...SPRINT_GIT_IDENT_ARGS, "commit", "-m", message],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
  return gitCurrentSha(cwd);
}

export function stepTagName(sprintId: string, stepIdx: number, stepName: string): string {
  const idx = String(stepIdx + 1).padStart(2, "0");
  return `agentflow/${sprintId}/${idx}-${stepName}-done`;
}

export function iterationTagName(
  sprintId: string,
  stepIdx: number,
  stepName: string,
  itemId: string,
): string {
  const idx = String(stepIdx + 1).padStart(2, "0");
  return `agentflow/${sprintId}/${idx}-${stepName}/${itemId}-done`;
}

export function sprintDoneTagName(sprintId: string): string {
  return `agentflow/${sprintId}/sprint-done`;
}

export function sprintFailedTagName(sprintId: string): string {
  return `agentflow/${sprintId}/sprint-failed`;
}

export function sprintInitTagName(sprintId: string): string {
  return `agentflow/${sprintId}/sprint-init`;
}

export function gitTagExists(name: string, cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${name}`], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}
