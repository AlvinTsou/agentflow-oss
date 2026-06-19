import { watch, existsSync, mkdirSync, statSync, type FSWatcher } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";

export interface TriggerDef {
  name: string;
  type: "cron" | "fs-watch" | "git-hook";
  schedule?: string;
  watchPath?: string;
  gitDir?: string;
  watchRef?: string;
  recipe: string;
  sprintDirPattern?: string; // e.g. "sprints/trigger-{name}-{timestamp}"
}

/**
 * Calculates the millisecond delay until the next matching cron occurrence.
 * Currently supports:
 *   - "*" : every minute
 *   - "* / N" : every N minutes
 *   - "N" : specific minute (0-59)
 */
export function parseCronToNextDelayMs(cronExpr: string, now: Date = new Date(Date.now())): number {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) {
    throw new Error(`Invalid cron expression: "${cronExpr}". Must have at least 5 space-separated fields.`);
  }

  const minPart = parts[0]!;
  
  if (minPart === "*") {
    // Trigger on the next minute boundary
    const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    return delay <= 0 ? 60000 : delay;
  } else if (minPart.startsWith("*/")) {
    const step = parseInt(minPart.slice(2), 10);
    if (isNaN(step) || step <= 0) {
      throw new Error(`Invalid cron step minutes: "${minPart}"`);
    }
    const currentMin = now.getMinutes();
    // Next minute that is a multiple of step
    const nextMin = Math.ceil((currentMin + 1) / step) * step;
    const diffMin = nextMin - currentMin;
    const delay = diffMin * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
    return delay <= 0 ? step * 60000 : delay;
  } else {
    // Specific minute (e.g. "30")
    const targetMin = parseInt(minPart, 10);
    if (isNaN(targetMin) || targetMin < 0 || targetMin > 59) {
      throw new Error(`Unsupported minute value: "${minPart}"`);
    }
    const currentMin = now.getMinutes();
    let diffMin = targetMin - currentMin;
    if (diffMin <= 0) {
      diffMin += 60; // Next hour's matching minute
    }
    const delay = diffMin * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
    return delay <= 0 ? 3600000 : delay;
  }
}

export class TriggerRunner {
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeWatchers: FSWatcher[] = [];

  constructor(
    private readonly triggers: TriggerDef[],
    private readonly dryRun: boolean = false,
  ) {}

  start(onTrigger: (trigger: TriggerDef) => void | Promise<void>): void {
    for (const trig of this.triggers) {
      if (trig.type === "cron") {
        this.scheduleCron(trig, onTrigger);
      } else if (trig.type === "fs-watch") {
        this.scheduleFsWatch(trig, onTrigger);
      } else if (trig.type === "git-hook") {
        this.scheduleGitHook(trig, onTrigger);
      }
    }
  }

  stop(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();

    for (const watcher of this.activeWatchers) {
      watcher.close();
    }
    this.activeWatchers = [];
  }

  private scheduleCron(
    trig: TriggerDef,
    onTrigger: (trigger: TriggerDef) => void | Promise<void>,
  ): void {
    if (!trig.schedule) return;

    try {
      const delay = parseCronToNextDelayMs(trig.schedule);

      const timer = setTimeout(() => {
        console.log(`[TriggerRunner] Triggering "${trig.name}" (${trig.recipe})`);
        if (this.dryRun) {
          console.log(`[TriggerRunner] [Dry-Run] Skipped executing recipe "${trig.recipe}"`);
        } else {
          Promise.resolve(onTrigger(trig)).catch((err) => {
            console.error(`[TriggerRunner] Error executing trigger "${trig.name}":`, err);
          });
        }
        // Re-schedule next run immediately and synchronously
        this.scheduleCron(trig, onTrigger);
      }, delay);

      this.activeTimers.set(trig.name, timer);
    } catch (err) {
      console.error(`[TriggerRunner] Failed to schedule cron "${trig.name}":`, err);
    }
  }

  private invokeTrigger(
    trig: TriggerDef,
    onTrigger: (trigger: TriggerDef) => void | Promise<void>,
    message: string,
  ): void {
    console.log(message);
    if (this.dryRun) {
      console.log(`[TriggerRunner] [Dry-Run] Skipped executing recipe "${trig.recipe}"`);
    } else {
      Promise.resolve(onTrigger(trig)).catch((err) => {
        console.error(`[TriggerRunner] Error executing trigger "${trig.name}":`, err);
      });
    }
  }

  private mtimeMs(path: string): number {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return 0;
    }
  }

  private startPolling(
    key: string,
    watchedPath: string,
    trig: TriggerDef,
    onTrigger: (trigger: TriggerDef) => void | Promise<void>,
    message: string,
  ): void {
    if (this.activeTimers.has(key)) return;

    let lastMtime = this.mtimeMs(watchedPath);
    const timer = setInterval(() => {
      const nextMtime = this.mtimeMs(watchedPath);
      if (nextMtime !== lastMtime) {
        lastMtime = nextMtime;
        this.invokeTrigger(trig, onTrigger, message);
      }
    }, 100);
    this.activeTimers.set(key, timer);
  }

  private scheduleFsWatch(
    trig: TriggerDef,
    onTrigger: (trigger: TriggerDef) => void | Promise<void>,
  ): void {
    if (!trig.watchPath) return;

    try {
      const targetPath = resolve(trig.watchPath);
      if (!existsSync(targetPath)) {
        console.warn(`[TriggerRunner] Warning: watchPath "${targetPath}" does not exist for trigger "${trig.name}".`);
      }
      
      let debounceTimer: NodeJS.Timeout | null = null;
      const watcher = watch(targetPath, { recursive: true }, (eventType, filename) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.invokeTrigger(
            trig,
            onTrigger,
            `[TriggerRunner] fs-watch event "${eventType}" on "${filename}" triggered "${trig.name}"`,
          );
        }, 100); // 100ms debounce
      });
      watcher.on("error", (err) => {
        console.error(`[TriggerRunner] fs-watch error for "${trig.name}":`, err);
        watcher.close();
        this.startPolling(
          `${trig.name}:fs-watch-poll`,
          targetPath,
          trig,
          onTrigger,
          `[TriggerRunner] fs-watch polling detected change triggered "${trig.name}"`,
        );
      });

      this.activeWatchers.push(watcher);
    } catch (err) {
      console.error(`[TriggerRunner] Failed to setup fs-watch for "${trig.name}":`, err);
    }
  }

  private scheduleGitHook(
    trig: TriggerDef,
    onTrigger: (trigger: TriggerDef) => void | Promise<void>,
  ): void {
    try {
      const gitRoot = resolve(trig.gitDir || ".");
      const ref = trig.watchRef || "refs/heads/main";
      const refPath = join(gitRoot, ".git", ref);

      // We direct watch target parent folder to catch ref changes
      const parentDir = dirname(refPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      let debounceTimer: NodeJS.Timeout | null = null;
      const watcher = watch(parentDir, (_, filename) => {
        if (filename === basename(refPath)) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.invokeTrigger(
              trig,
              onTrigger,
              `[TriggerRunner] git-hook ref change detected for "${ref}" triggered "${trig.name}"`,
            );
          }, 100);
        }
      });
      watcher.on("error", (err) => {
        console.error(`[TriggerRunner] git-hook watch error for "${trig.name}":`, err);
        watcher.close();
        this.startPolling(
          `${trig.name}:git-hook-poll`,
          refPath,
          trig,
          onTrigger,
          `[TriggerRunner] git-hook polling detected ref change for "${ref}" triggered "${trig.name}"`,
        );
      });

      this.activeWatchers.push(watcher);
    } catch (err) {
      console.error(`[TriggerRunner] Failed to setup git-hook for "${trig.name}":`, err);
    }
  }
}
