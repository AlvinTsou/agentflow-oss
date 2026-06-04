/**
 * ag — unified CLI dispatcher for agentflow-oss.
 *
 * Thin wrapper that re-routes argv to the existing entry scripts so we have
 * a single command surface without rewriting them. Each subcommand calls
 * through to its backing script unchanged.
 *
 * Usage:
 *   pnpm ag init <recipe> [...opts]
 *   pnpm ag run <recipe> [...opts]
 *   pnpm ag run <sprintDir>                  (initialised sprint)
 *   pnpm ag resume <sprintDir> [...opts]
 *   pnpm ag status <sprintDir>
 *   pnpm ag replay <sprintDir>
 *   pnpm ag approve         <sprintDir> --step <name> [--note <msg>]
 *   pnpm ag request-changes <sprintDir> --step <name> --message <msg>
 *   pnpm ag force-pass      <sprintDir> --step <name> [--note <msg>]
 *   pnpm ag resolve         <sprintDir> --id <feedback-id>
 *
 *   <recipe> = mini | sdd | research
 */

import { existsSync, readFileSync, statSync } from "node:fs";

interface Dispatch {
  module: string;
  argv: string[];
}

const KNOWN_RECIPES = new Set(["mini", "sdd", "research"]);

type SprintDirState =
  | { kind: "not-a-dir" }
  | { kind: "no-state" }
  | { kind: "unreadable"; reason: string }
  /** Initialized via `ag init`, or started but no step completed yet. Safe to auto-dispatch. */
  | { kind: "init"; sprintId: string }
  /** At least one step has completed; auto-dispatch could destroy work via gitResetHard. */
  | { kind: "in-progress"; sprintId: string };

/**
 * Inspect a candidate sprintDir so `ag run <path>` can decide whether to
 * auto-dispatch to ag-resume or refuse. "in-progress" covers both partial
 * runs and completed sprints — resumeSprint itself rejects sprint-done
 * tagged sprints with a clear message, so the user sees one error or the
 * other depending on which check fires first.
 */
function inspectSprintDir(p: string): SprintDirState {
  try {
    if (!statSync(p).isDirectory()) return { kind: "not-a-dir" };
  } catch {
    return { kind: "not-a-dir" };
  }
  const statePath = `${p}/state.json`;
  if (!existsSync(statePath)) return { kind: "no-state" };
  try {
    const raw = readFileSync(statePath, "utf-8");
    const s = JSON.parse(raw) as { phase?: string; sprintId?: string; completedSteps?: unknown[] };
    const sprintId = typeof s.sprintId === "string" ? s.sprintId : "?";
    if (s.phase === "initialized") return { kind: "init", sprintId };
    const completed = Array.isArray(s.completedSteps) ? s.completedSteps.length : 0;
    if (completed === 0) return { kind: "init", sprintId };
    return { kind: "in-progress", sprintId };
  } catch (err) {
    return { kind: "unreadable", reason: (err as Error).message };
  }
}

function printHelp(exitCode = 0): never {
  console.error(
    `ag — agentflow-oss CLI\n` +
      `\n` +
      `Usage:\n` +
      `  pnpm ag init <recipe> [...opts]\n` +
      `      Write sprint skeleton (INPUT.md + agentflow.config.json + state.json\n` +
      `      + sprint-init tag) without invoking any provider. Recipe is one of:\n` +
      `      ${[...KNOWN_RECIPES].join(" | ")}.\n` +
      `  pnpm ag run <recipe> [...opts]\n` +
      `      Recipes:\n` +
      `        mini       — 4-step synthetic self-test (no flags)\n` +
      `        sdd        — 9-step SDD; --input/--problem/--prefix/--gate/--language/--lite-preset\n` +
      `        research   — 6-step research report; --input/--problem/--prefix/--gate/--lite-preset\n` +
      `  pnpm ag run <sprintDir>\n` +
      `      Start an ag init-prepared sprint from step 0. Equivalent to\n` +
      `      ag resume <sprintDir> when the sprint has never run a step.\n` +
      `  pnpm ag resume <sprintDir> [...opts]\n` +
      `      Flags: --step <idx> --iter <id> --recipe <name> --no-reset --language <name>\n` +
      `  pnpm ag status <sprintDir>\n` +
      `      Read-only sprint snapshot (phase, current step, scores, cost, latest tag).\n` +
      `  pnpm ag replay <sprintDir>\n` +
      `      Read-only events.jsonl renderer (no API calls)\n` +
      `  pnpm ag approve         <sprintDir> --step <name> [--note <msg>]\n` +
      `  pnpm ag request-changes <sprintDir> --step <name> --message <msg>\n` +
      `  pnpm ag force-pass      <sprintDir> --step <name> [--note <msg>]\n` +
      `      Write a gate record to .agentflow-feedback/feedback.jsonl.\n` +
      `      Author: $AGENTFLOW_AUTHOR -> git user.email -> unknown.\n` +
      `  pnpm ag resolve         <sprintDir> --id <feedback-id>\n` +
      `      Stamp resolvedAt on the matching feedback.jsonl row (closes open RCs).\n`,
  );
  process.exit(exitCode);
}

function dispatch(argv: string[]): Dispatch {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (!sub) printHelp(2);
  if (sub === "--help" || sub === "-h") printHelp(0);

  switch (sub) {
    case "init":
      return { module: "./ag-init.js", argv: rest };
    case "run": {
      const target = rest[0];
      if (!target) {
        console.error(`ag run: missing <recipe> | <sprintDir>`);
        process.exit(2);
      }
      // ag run <sprintDir>: only dispatch to ag-resume for sprints that
      // have not yet completed any step. In-progress / failed / completed
      // sprints fall through to ag resume (or explicit error) because
      // auto-dispatch + gitResetHard could otherwise destroy uncommitted
      // work in the sprint repo.
      if (!KNOWN_RECIPES.has(target)) {
        const inspected = inspectSprintDir(target);
        if (inspected.kind === "init") {
          return { module: "./ag-resume.js", argv: rest };
        }
        if (inspected.kind === "in-progress") {
          console.error(
            `ag run: sprint ${inspected.sprintId} has already executed steps. ` +
              `Use \`ag resume ${target}\` (with --no-reset if you have local commits to preserve).`,
          );
          process.exit(2);
        }
        if (inspected.kind === "unreadable") {
          console.error(`ag run: cannot read ${target}/state.json — ${inspected.reason}`);
          process.exit(2);
        }
        // "not-a-dir" / "no-state" fall through to the recipe-name branch
        // below; that branch produces the existing "unknown recipe" error.
      }
      const remain = rest.slice(1);
      if (target === "mini") return { module: "./run-sprint.js", argv: remain };
      if (target === "sdd") return { module: "./run-sdd.js", argv: remain };
      if (target === "research") return { module: "./run-research.js", argv: remain };
      console.error(
        `ag run: "${target}" is neither a known recipe (${[...KNOWN_RECIPES].join(" | ")}) nor an initialised sprint directory.`,
      );
      process.exit(2);
    }
    case "resume":
      return { module: "./ag-resume.js", argv: rest };
    case "status":
      return { module: "./ag-status.js", argv: rest };
    case "replay":
      return { module: "./ag-replay.js", argv: rest };
    case "approve":
    case "request-changes":
    case "force-pass":
    case "resolve":
      // ag-gate.ts reads the verb from process.argv[2], so re-prepend it.
      return { module: "./ag-gate.js", argv: [sub, ...rest] };
    default:
      console.error(`ag: unknown subcommand "${sub}"`);
      printHelp(2);
  }
}

async function main() {
  const d = dispatch(process.argv.slice(2));
  process.argv = [process.argv[0]!, d.module, ...d.argv];
  await import(d.module);
}

main().catch((err) => {
  console.error("ag: fatal:", err);
  process.exit(1);
});
