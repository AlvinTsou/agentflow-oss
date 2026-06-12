/**
 * ag-replay — read-only events.jsonl renderer.
 *
 * Reads a sprint dir's events.jsonl and prints:
 *   - Sprint header (recipe, start/end, terminal status)
 *   - Per-step + per-iteration rows (score · attempts · tokens · cost · elapsed)
 *   - Aggregate totals + provider breakdown
 *   - Convergence path (steps/iters that needed more than 1 attempt)
 *
 * No new state, no API calls. events.jsonl is the truth.
 */
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

interface SprintEvent {
  ts: string;
  type: string;
  step?: string;
  iteration?: string;
  attempt?: number;
  score?: number;
  tokens?: number;
  costUsd?: number;
  msg?: string;
}

interface RowAgg {
  step: string;
  iteration?: string;
  attempts: number;
  finalScore: number;
  tokens: number;
  costUsd: number;
  startedAt?: string;
  endedAt?: string;
  passed: boolean;
  forced: boolean;
  routeDetails: Array<{
    phase: string;
    attempt: number;
    provider: string;
    model?: string;
    reason: string;
    matchedRule?: string;
    warnings?: string[];
    policyProfile?: string;
  }>;
}

function parseArgs(argv: string[]): { sprintDir: string } {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.error(
      `Usage: pnpm exec tsx ag-replay.ts <sprintDir>\n` +
        `Reads events.jsonl and prints a sprint timeline + cost summary. No API calls.`,
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const raw = args[0]!;
  return { sprintDir: isAbsolute(raw) ? raw : resolve(process.cwd(), raw) };
}

function readEvents(sprintDir: string): SprintEvent[] {
  const path = join(sprintDir, "events.jsonl");
  if (!existsSync(path)) {
    throw new Error(`events.jsonl not found at ${path}`);
  }
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SprintEvent);
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtElapsed(startISO?: string, endISO?: string): string {
  if (!startISO || !endISO) return "—";
  const ms = Date.parse(endISO) - Date.parse(startISO);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

function aggregate(events: SprintEvent[]): {
  rows: RowAgg[];
  totalTokens: number;
  totalCost: number;
  startedAt?: string;
  endedAt?: string;
  recipeName?: string;
  sprintId?: string;
  terminal: "completed" | "failed" | "in-progress";
  failedAt?: { step?: string; iteration?: string; msg?: string };
} {
  const rows: RowAgg[] = [];
  const rowKey = (step: string, iter?: string) => (iter ? `${step}/${iter}` : step);
  const byKey: Record<string, RowAgg> = {};

  let totalTokens = 0;
  let totalCost = 0;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let recipeName: string | undefined;
  let sprintId: string | undefined;
  let terminal: "completed" | "failed" | "in-progress" = "in-progress";
  let failedAt: { step?: string; iteration?: string; msg?: string } | undefined;

  for (const ev of events) {
    if (ev.type === "sprint-started" || ev.type === "sprint-resumed") {
      if (!startedAt) startedAt = ev.ts;
      const m = ev.msg?.match(/recipe=(\S+)\s+sprint=(\S+)/);
      if (m) {
        recipeName = m[1];
        sprintId = m[2];
      }
    }
    if (ev.type === "sprint-resumed") {
      // Clear prior failure once a resume kicks off — the sprint is alive again.
      failedAt = undefined;
      terminal = "in-progress";
    }
    if (ev.type === "sprint-completed") {
      endedAt = ev.ts;
      terminal = "completed";
      failedAt = undefined;
    }
    if (ev.type === "sprint-failed") {
      endedAt = ev.ts;
      terminal = "failed";
      failedAt = { step: ev.step, iteration: ev.iteration, msg: ev.msg };
    }
    if (ev.type === "step-started" || ev.type === "iteration-started") {
      const key = rowKey(ev.step!, ev.iteration);
      const row: RowAgg = byKey[key] ?? {
        step: ev.step!,
        iteration: ev.iteration,
        attempts: 0,
        finalScore: 0,
        tokens: 0,
        costUsd: 0,
        startedAt: ev.ts,
        endedAt: undefined,
        passed: false,
        forced: false,
        routeDetails: [],
      };
      row.startedAt = row.startedAt ?? ev.ts;
      byKey[key] = row;
      if (!rows.includes(row)) rows.push(row);
    }
    if (ev.type === "phase") {
      const key = rowKey(ev.step!, ev.iteration);
      const row = byKey[key];
      if (!row) continue;
      row.attempts = Math.max(row.attempts, ev.attempt ?? row.attempts);
      if (ev.score !== undefined) row.finalScore = ev.score;
      row.tokens += ev.tokens ?? 0;
      row.costUsd += ev.costUsd ?? 0;
      totalTokens += ev.tokens ?? 0;
      totalCost += ev.costUsd ?? 0;

      if (ev.route) {
        row.routeDetails.push({
          phase: ev.msg ?? "unknown",
          attempt: ev.attempt ?? 1,
          provider: ev.route.provider,
          model: ev.route.model,
          reason: ev.route.reason,
          matchedRule: ev.route.matchedRule,
          warnings: ev.route.warnings,
          policyProfile: ev.route.policyProfile,
        });
      }
    }
    if (ev.type === "step-passed" || ev.type === "iteration-passed") {
      const key = rowKey(ev.step!, ev.iteration);
      const row = byKey[key];
      if (row) {
        row.passed = true;
        row.endedAt = ev.ts;
        if (ev.score !== undefined) row.finalScore = ev.score;
      }
    }
    if (ev.type === "step-force-passed" || ev.type === "iteration-force-passed") {
      const key = rowKey(ev.step!, ev.iteration);
      const row = byKey[key];
      if (row) {
        row.passed = true;
        row.forced = true;
        row.endedAt = ev.ts;
        if (ev.score !== undefined) row.finalScore = ev.score;
      }
    }
    if (ev.type === "step-failed" || ev.type === "iteration-failed") {
      const key = rowKey(ev.step!, ev.iteration);
      const row = byKey[key];
      if (row) {
        row.endedAt = ev.ts;
        if (ev.score !== undefined) row.finalScore = ev.score;
      }
    }
  }

  return { rows, totalTokens, totalCost, startedAt, endedAt, recipeName, sprintId, terminal, failedAt };
}

function render(agg: ReturnType<typeof aggregate>): string {
  const lines: string[] = [];
  lines.push(`# Sprint replay`);
  lines.push(``);
  lines.push(`- Recipe:   ${agg.recipeName ?? "?"}`);
  lines.push(`- Sprint:   ${agg.sprintId ?? "?"}`);
  lines.push(`- Started:  ${agg.startedAt ?? "?"}`);
  lines.push(`- Ended:    ${agg.endedAt ?? "(still running)"}`);
  lines.push(`- Duration: ${fmtElapsed(agg.startedAt, agg.endedAt)}`);
  lines.push(`- Terminal: ${agg.terminal}${agg.failedAt ? ` at ${agg.failedAt.step}${agg.failedAt.iteration ? `/${agg.failedAt.iteration}` : ""} — ${agg.failedAt.msg ?? ""}` : ""}`);
  lines.push(``);
  lines.push(`## Steps`);
  lines.push(``);
  lines.push(`| Step / Iter | Status | Score | Att | Tokens | Cost | Provider(s) | Elapsed |`);
  lines.push(`|---|---|---:|---:|---:|---:|---|---:|`);
  for (const row of agg.rows) {
    const name = row.iteration ? `${row.step}/${row.iteration}` : row.step;
    const status = row.passed ? (row.forced ? "force-pass" : "passed") : (row.endedAt ? "FAILED" : "running");
    const uniqProviders = Array.from(new Set(row.routeDetails.map((rd) => rd.provider)));
    const providersStr = uniqProviders.length > 0 ? uniqProviders.join(", ") : "—";
    lines.push(
      `| ${name} | ${status} | ${row.finalScore} | ${row.attempts} | ${row.tokens.toLocaleString()} | ${fmtCost(row.costUsd)} | ${providersStr} | ${fmtElapsed(row.startedAt, row.endedAt)} |`,
    );
  }
  lines.push(``);

  const hasRoutes = agg.rows.some((r) => r.routeDetails && r.routeDetails.length > 0);
  if (hasRoutes) {
    lines.push(`## Route Audit`);
    lines.push(``);
    lines.push(`| Step / Iter | Phase | Attempt | Provider | Model | Reason | Profile |`);
    lines.push(`|---|---|---:|---|---|---|---|`);
    for (const row of agg.rows) {
      const name = row.iteration ? `${row.step}/${row.iteration}` : row.step;
      for (const rd of row.routeDetails) {
        const modelStr = rd.model ?? "—";
        const ruleStr = rd.matchedRule ? `${rd.reason} (${rd.matchedRule})` : rd.reason;
        const profileStr = rd.policyProfile ?? "—";
        const warnSuffix = rd.warnings && rd.warnings.length > 0 ? " ⚠️" : "";
        lines.push(
          `| ${name} | ${rd.phase} | ${rd.attempt} | ${rd.provider} | ${modelStr} | ${ruleStr}${warnSuffix} | ${profileStr} |`,
        );
      }
    }
    lines.push(``);

    const allWarnings: string[] = [];
    for (const row of agg.rows) {
      const name = row.iteration ? `${row.step}/${row.iteration}` : row.step;
      for (const rd of row.routeDetails) {
        if (rd.warnings) {
          for (const w of rd.warnings) {
            allWarnings.push(`- **${name}** (${rd.phase}): ${w}`);
          }
        }
      }
    }
    if (allWarnings.length > 0) {
      lines.push(`### Route Warnings`);
      lines.push(``);
      for (const w of allWarnings) {
        lines.push(w);
      }
      lines.push(``);
    }
  }
  lines.push(`## Totals`);
  lines.push(``);
  lines.push(`- Tokens: ${agg.totalTokens.toLocaleString()}`);
  lines.push(`- Cost:   ${fmtCost(agg.totalCost)}`);
  lines.push(``);

  const convergence = agg.rows.filter((r) => r.attempts > 1);
  if (convergence.length > 0) {
    lines.push(`## Convergence path (>1 attempt)`);
    lines.push(``);
    for (const row of convergence) {
      const name = row.iteration ? `${row.step}/${row.iteration}` : row.step;
      lines.push(`- **${name}** — needed ${row.attempts} attempts to reach score ${row.finalScore}${row.forced ? " (force-passed)" : ""}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

function main() {
  const { sprintDir } = parseArgs(process.argv);
  const events = readEvents(sprintDir);
  const agg = aggregate(events);
  console.log(render(agg));
}

main();
