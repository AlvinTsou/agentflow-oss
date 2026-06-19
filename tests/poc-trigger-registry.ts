/**
 * Offline check: trigger-registry (A-1) scheduler.
 * Verifies that cron delay calculation is accurate and TriggerRunner schedules
 * triggers correctly using Node's mock timers. Also tests fs-watch and git-hook types.
 *
 * Run: pnpm exec tsx tests/poc-trigger-registry.ts
 */
import assert from "node:assert/strict";
import { parseCronToNextDelayMs, TriggerRunner, type TriggerDef } from "../src/workflow/trigger-registry.js";
import { mock } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });

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

async function main() {
  // 1. Test cron delay calculation
  await check("parseCronToNextDelayMs calculates correct delays", () => {
    // Base: 2026-06-18 12:00:30.000 (Thursday)
    const base = new Date("2026-06-18T12:00:30.000Z");

    // Every minute (*): should target 12:01:00 (30 seconds diff = 30000ms)
    const d1 = parseCronToNextDelayMs("* * * * *", base);
    assert.equal(d1, 30000);

    // Every 5 minutes (*/5): should target 12:05:00 (4 mins 30 secs diff = 270000ms)
    const d2 = parseCronToNextDelayMs("*/5 * * * *", base);
    assert.equal(d2, 270000);

    // Specific minute (15): should target 12:15:00 (14 mins 30 secs diff = 870000ms)
    const d3 = parseCronToNextDelayMs("15 * * * *", base);
    assert.equal(d3, 870000);

    // Specific minute past (0): should target next hour 13:00:00 (59 mins 30 secs diff = 3570000ms)
    const d4 = parseCronToNextDelayMs("0 * * * *", base);
    assert.equal(d4, 3570000);
  });

  // 2. Test TriggerRunner scheduler integration via mock timers
  await check("TriggerRunner schedules and triggers cron correctly via mock timers", () => {
    mock.timers.enable();

    try {
      const triggers: TriggerDef[] = [
        {
          name: "test-cron",
          type: "cron",
          schedule: "* * * * *",
          recipe: "dummy",
        }
      ];

      const runner = new TriggerRunner(triggers, false);
      let callCount = 0;
      let lastTriggered: any = null;

      runner.start((trig) => {
        callCount++;
        lastTriggered = trig;
      });

      // Tick forward by the exact first delay to trigger the first run
      const firstDelay = parseCronToNextDelayMs("* * * * *");
      mock.timers.tick(firstDelay);

      assert.equal(callCount, 1);
      assert.ok(lastTriggered);
      assert.equal(lastTriggered!.name, "test-cron");

      // Tick forward another 60 seconds (60000ms) to run the second trigger cycle
      mock.timers.tick(60000);
      assert.equal(callCount, 2);

      runner.stop();
    } finally {
      mock.timers.reset();
    }
  });

  // 3. Test fs-watch and git-hook types asynchronously
  await check("TriggerRunner fs-watch and git-hook types trigger correctly", async () => {
    async function runWatchScenario(): Promise<string[]> {
      const tmp = mkdtempSync(join(testTmpDir, "trigger-watch-"));

      const gitDir = join(tmp, "git-project");
      const refsDir = join(gitDir, ".git", "refs", "heads");
      mkdirSync(refsDir, { recursive: true });

      const watchFolder = join(tmp, "watch-folder");
      mkdirSync(watchFolder, { recursive: true });

      const triggers: TriggerDef[] = [
        {
          name: "test-fswatch",
          type: "fs-watch",
          watchPath: watchFolder,
          recipe: "dummy-fs",
        },
        {
          name: "test-githook",
          type: "git-hook",
          gitDir: gitDir,
          watchRef: "refs/heads/main",
          recipe: "dummy-git",
        }
      ];

      const runner = new TriggerRunner(triggers, false);
      const triggeredNames: string[] = [];

      runner.start((trig) => {
        triggeredNames.push(trig.name);
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      try {
        writeFileSync(join(watchFolder, "change.txt"), "modified content", "utf-8");
        writeFileSync(join(refsDir, "main"), "new-commit-sha", "utf-8");

        await new Promise((resolve) => setTimeout(resolve, 300));
        return triggeredNames;
      } finally {
        runner.stop();
        try {
          rmSync(tmp, { recursive: true, force: true });
        } catch {}
      }
    }

    let triggeredNames: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      triggeredNames = await runWatchScenario();
      if (triggeredNames.includes("test-fswatch") && triggeredNames.includes("test-githook")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.ok(triggeredNames.includes("test-fswatch"), "fs-watch trigger should be fired");
    assert.ok(triggeredNames.includes("test-githook"), "git-hook trigger should be fired");
  });

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
