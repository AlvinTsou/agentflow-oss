/**
 * ag-status — read-only sprint snapshot renderer (Phase 7.2.x).
 *
 * Reads state.json (required) + summary.json (optional, completed sprints)
 * + events.jsonl (optional) + the sprint repo's git refs from <sprintDir>
 * and prints a single-shot status:
 *
 *   - sprint id, recipe, phase, started + last-event timestamps
 *   - current step (in-progress only) or completed-step score table
 *   - accumulated tokens + cost (final for completed, running otherwise)
 *   - failure record + suggested resume command (failed only)
 *   - latest git tag in the sprint repo
 *
 * No provider calls. No mutation. Pure inspect.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import type { SprintEvent, SprintState } from "./src/workflow/state-store.js";
import type { SprintSummary } from "./src/workflow/sprint-engine.js";

export type StatusPhase = "initialized" | "in-progress" | "failed" | "completed";

export interface StatusReport {
  sprintDir: string;
  state: SprintState;
  summary: SprintSummary | null;
  phase: StatusPhase;
  /** Most recent step-started event's step name; undefined when no step has started. */
  currentStepName?: string;
  /** From summary.json when present, otherwise summed from events.jsonl. */
  totalTokens: number;
  totalCostUsd: number;
  /** Latest tag in the sprint repo, or undefined when the dir is not a git repo. */
  latestTag?: string;
}

export function parseStatusArgs(argv: string[]): { sprintDir: string } {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.error(
      `Usage: pnpm exec tsx ag.ts status <sprintDir>\n` +
        `Reads state.json + summary.json + events.jsonl from <sprintDir> and\n` +
        `prints a one-shot status snapshot. No provider calls.`,
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const raw = args[0]!;
  return { sprintDir: isAbsolute(raw) ? raw : resolve(process.cwd(), raw) };
}

function readState(sprintDir: string): SprintState {
  const p = join(sprintDir, "state.json");
  if (!existsSync(p)) {
    throw new Error(`${p} not found — is "${sprintDir}" an AgentFlow sprint dir?`);
  }
  return JSON.parse(readFileSync(p, "utf-8")) as SprintState;
}

function readSummary(sprintDir: string): SprintSummary | null {
  const p = join(sprintDir, "summary.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as SprintSummary;
}

function readEvents(sprintDir: string): SprintEvent[] {
  const p = join(sprintDir, "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as SprintEvent);
}

function derivePhase(state: SprintState, summary: SprintSummary | null): StatusPhase {
  if (summary !== null) return "completed";
  if (state.failedAt) return "failed";
  if (state.phase === "initialized" && state.completedSteps.length === 0) return "initialized";
  return "in-progress";
}

function findCurrentStep(events: SprintEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "step-started" && ev.step) return ev.step;
  }
  return undefined;
}

function sumRunning(events: SprintEvent[]): { tokens: number; cost: number } {
  let tokens = 0;
  let cost = 0;
  for (const ev of events) {
    if (ev.type !== "phase") continue;
    tokens += ev.tokens ?? 0;
    cost += ev.costUsd ?? 0;
  }
  return { tokens, cost };
}

function readLatestTag(sprintDir: string): string | undefined {
  // .git can be a directory (normal repo) or a file (worktree). Either is fine
  // for `git for-each-ref`; absence means the dir is not a sprint git repo.
  try {
    statSync(join(sprintDir, ".git"));
  } catch {
    return undefined;
  }
  try {
    const out = execFileSync(
      "git",
      [
        "for-each-ref",
        "--sort=-creatordate",
        "--count=1",
        "--format=%(refname:short)",
        "refs/tags",
      ],
      { cwd: sprintDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export function buildReport(sprintDir: string): StatusReport {
  const state = readState(sprintDir);
  const summary = readSummary(sprintDir);
  const events = readEvents(sprintDir);
  const phase = derivePhase(state, summary);
  const currentStepName = phase === "in-progress" ? findCurrentStep(events) : undefined;
  const running = summary ? null : sumRunning(events);
  return {
    sprintDir,
    state,
    summary,
    phase,
    currentStepName,
    totalTokens: summary?.totalTokens ?? running?.tokens ?? 0,
    totalCostUsd: summary?.totalCostUsd ?? running?.cost ?? 0,
    latestTag: readLatestTag(sprintDir),
  };
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function render(rep: StatusReport): string {
  const lines: string[] = [];
  lines.push(`# Sprint status`);
  lines.push(``);
  lines.push(`- Sprint:   ${rep.state.sprintId}`);
  lines.push(`- Recipe:   ${rep.state.recipeName}`);
  lines.push(`- Phase:    ${rep.phase}`);
  lines.push(`- Started:  ${rep.state.startedAt}`);
  if (rep.phase === "completed" && rep.summary?.completedAt) {
    lines.push(`- Ended:    ${rep.summary.completedAt}`);
  } else {
    lines.push(`- Last ev:  ${rep.state.lastEventTs}`);
  }
  if (rep.phase === "completed" && rep.summary) {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const readinessLabel = cap(rep.summary.readiness ?? "unknown");
    const detail =
      rep.summary.readiness === "blocked"
        ? ` (${rep.summary.blockingCount} blocking carry-over${rep.summary.blockingCount === 1 ? "" : "s"})`
        : "";
    lines.push(`- Run:      Completed`);
    lines.push(`- Readiness: ${readinessLabel}${detail}`);
  }
  if (rep.currentStepName) {
    lines.push(`- Step:     #${rep.state.currentStepIdx} ${rep.currentStepName}`);
  } else if (rep.phase === "initialized") {
    lines.push(`- Step:     -  (not yet started)`);
  }
  if (rep.latestTag) lines.push(`- Tag:      ${rep.latestTag}`);
  lines.push(``);

  if (rep.summary && rep.summary.perStep.length > 0) {
    lines.push(`## Completed steps`);
    lines.push(``);
    lines.push(`| Step | Score | Att | Tokens |`);
    lines.push(`|---|---:|---:|---:|`);
    for (const row of rep.summary.perStep) {
      lines.push(
        `| ${row.step} | ${row.score} | ${row.attempts} | ${row.tokens.toLocaleString()} |`,
      );
    }
    lines.push(``);
  } else if (rep.state.completedSteps.length > 0) {
    lines.push(`## Completed steps`);
    lines.push(``);
    for (const s of rep.state.completedSteps) lines.push(`- ${s}`);
    lines.push(``);
  }

  if (rep.phase === "failed" && rep.state.failedAt) {
    const f = rep.state.failedAt;
    lines.push(`## Failure`);
    lines.push(``);
    lines.push(`- Step:    ${f.step}${f.iteration ? `/${f.iteration}` : ""}`);
    lines.push(`- Reason:  ${f.reason ?? "?"}`);
    lines.push(`- Score:   ${f.score} after ${f.attempts} attempt(s)`);
    lines.push(`- When:    ${f.ts}`);
    if (f.errorMessage) {
      const firstLine = f.errorMessage.split("\n")[0]!;
      lines.push(`- Error:   ${firstLine}`);
    }
    lines.push(``);
    lines.push(`Resume with: pnpm exec tsx ag.ts resume ${rep.sprintDir} --no-reset`);
    lines.push(``);
  }

  lines.push(`## Cost`);
  lines.push(``);
  lines.push(`- Tokens: ${rep.totalTokens.toLocaleString()}`);
  lines.push(`- Cost:   ${fmtCost(rep.totalCostUsd)}`);

  if (rep.summary?.byProvider) {
    lines.push(``);
    lines.push(`## By provider`);
    lines.push(``);
    for (const [name, m] of Object.entries(rep.summary.byProvider)) {
      lines.push(
        `- ${name}: ${m.tokens.toLocaleString()} tokens, ${fmtCost(m.costUsd)} over ${m.calls} call(s)`,
      );
    }
  }
  return lines.join("\n");
}

async function main() {
  const { sprintDir } = parseStatusArgs(process.argv);
  const rep = buildReport(sprintDir);
  console.log(render(rep));
}

const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /(?:^|[\\/])ag-status\.(?:ts|js)$/.test(process.argv[1]);
if (invokedAsScript) {
  main().catch((err) => {
    console.error("[ag-status] fatal:", (err as Error).message ?? err);
    process.exit(1);
  });
}
