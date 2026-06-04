import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SPRINT_GIT_IDENT_ARGS } from "./git-checkpoint.js";

/**
 * Initialise a per-sprint git repo inside the sprint directory. Idempotent.
 *
 * After Phase 2.0, every sprint owns its own .git/ so engine-level git ops
 * (commit, tag, reset --hard) never touch the engine repo. Old sprints (no
 * .git/ inside their dir) continue to work for read-only inspection.
 *
 * Per Phase 7.2 review finding #4: the initial empty commit pins author
 * identity via `git -c` so CI runners / fresh dev machines without a
 * global user.email / user.name still succeed.
 */
export function initSprintRepo(sprintDir: string): void {
  if (existsSync(`${sprintDir}/.git`)) return;
  execFileSync("git", ["init", "--quiet"], { cwd: sprintDir });
  execFileSync(
    "git",
    [...SPRINT_GIT_IDENT_ARGS, "commit", "--allow-empty", "-m", "sprint repo init"],
    { cwd: sprintDir },
  );
}
