/**
 * ag-gate — Phase 7.6 CLI verbs: approve / request-changes / force-pass.
 *
 * Writes a `WebFeedbackEvent` to `<sprintDir>/.agentflow-feedback/feedback.jsonl`
 * in exactly the same shape the web UI produces, so CLI + web operators
 * share one audit trail. Author identity resolves from
 * `$AGENTFLOW_AUTHOR` -> `git config user.email` -> "unknown".
 *
 * Usage:
 *   ag approve         <sprintDir> --step <name> [--note <msg>]
 *   ag request-changes <sprintDir> --step <name> --message <msg>
 *   ag force-pass      <sprintDir> --step <name> [--note <msg>]
 *
 * The verb name is read from process.argv[2] (forwarded by ag.ts).
 * --iter is intentionally deferred: WebFeedbackEvent has no iteration
 * field and per-iter gating is a forEach concern out of 7.6 scope.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { FeedbackType, WebFeedbackEvent } from "./src/feedback/types.js";
import { FEEDBACK_DIR } from "./src/feedback/paths.js";

type Verb = "approve" | "request-changes" | "force-pass" | "resolve";

const VERBS = new Set<Verb>(["approve", "request-changes", "force-pass", "resolve"]);

/**
 * Write-verb → WebFeedbackEvent.type. The CLI verb is "approve" for
 * ergonomics (matches GitHub PR language); the persisted type stays
 * "approval" because the web UI + ingest helper already use that
 * string. Resolve is excluded — it mutates an existing record's
 * resolvedAt and writes no new record.
 */
type WriteVerb = Exclude<Verb, "resolve">;
const VERB_TO_TYPE: Record<WriteVerb, FeedbackType> = {
  approve: "approval",
  "request-changes": "request-changes",
  "force-pass": "force-pass",
};

export interface ParsedGateArgs {
  verb: Verb;
  sprintDir: string;
  /** Required for approve / request-changes / force-pass; absent for resolve. */
  step?: string;
  /** Phase 7.4.y — when set, the record targets one iteration of a
   *  forEach step. Engine block + ingest filters per-iter. */
  iteration?: string;
  body: string;
  /** Required for resolve; absent for the other verbs. */
  id?: string;
}

function usage(): never {
  console.error(
    `Usage:\n` +
      `  ag approve         <sprintDir> --step <name> [--iter <id>] [--note <msg>]\n` +
      `  ag request-changes <sprintDir> --step <name> [--iter <id>] --message <msg>\n` +
      `  ag force-pass      <sprintDir> --step <name> [--iter <id>] [--note <msg>]\n` +
      `  ag resolve         <sprintDir> --id <feedback-id>\n` +
      `\n` +
      `--iter <id> targets one iteration of a forEach step (e.g. T3 / Q5).\n` +
      `Omit --iter to file a step-wide record (applies to the aggregate / single-pass step).\n` +
      `\n` +
      `Author identity (approve / request-changes / force-pass):\n` +
      `  $AGENTFLOW_AUTHOR -> git config user.email -> "unknown".\n` +
      `Resolve stamps resolvedAt on the matching feedback.jsonl row in place.\n`,
  );
  process.exit(2);
}

export function parseGateArgs(argv: string[]): ParsedGateArgs {
  const args = argv.slice(2);
  const verbRaw = args[0];
  if (!verbRaw || !VERBS.has(verbRaw as Verb)) {
    console.error(`ag-gate: unknown verb "${verbRaw}".`);
    usage();
  }
  const verb = verbRaw as Verb;
  const rest = args.slice(1);
  if (rest.length === 0 || rest[0]!.startsWith("-")) {
    console.error(`ag ${verb}: missing <sprintDir>.`);
    usage();
  }
  const sprintDirRaw = rest[0]!;
  const sprintDir = isAbsolute(sprintDirRaw)
    ? sprintDirRaw
    : resolve(process.cwd(), sprintDirRaw);

  let step: string | undefined;
  let iteration: string | undefined;
  let body: string | undefined;
  let id: string | undefined;
  for (let i = 1; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--step") {
      const v = rest[++i];
      if (!v || v.startsWith("-")) {
        console.error(`ag ${verb}: --step requires a value.`);
        usage();
      }
      step = v;
    } else if (flag === "--iter") {
      const v = rest[++i];
      if (!v || v.startsWith("-")) {
        console.error(`ag ${verb}: --iter requires a value.`);
        usage();
      }
      iteration = v;
    } else if (flag === "--note" || flag === "--message") {
      const v = rest[++i];
      if (v === undefined) {
        console.error(`ag ${verb}: ${flag} requires a value.`);
        usage();
      }
      body = v;
    } else if (flag === "--id") {
      const v = rest[++i];
      if (!v || v.startsWith("-")) {
        console.error(`ag ${verb}: --id requires a value.`);
        usage();
      }
      id = v;
    } else {
      console.error(`ag ${verb}: unknown flag "${flag}".`);
      usage();
    }
  }
  if (verb === "resolve") {
    if (!id) {
      console.error(`ag resolve: --id <feedback-id> is required.`);
      usage();
    }
    if (iteration) {
      console.error(`ag resolve: --iter is not applicable (id targets one specific record).`);
      usage();
    }
    return { verb, sprintDir, body: "", id };
  }
  if (!step) {
    console.error(`ag ${verb}: --step <name> is required.`);
    usage();
  }
  if (verb === "request-changes" && !body) {
    console.error(`ag request-changes: --message <msg> is required.`);
    usage();
  }
  return { verb, sprintDir, step, ...(iteration ? { iteration } : {}), body: body ?? "" };
}

export function resolveAuthor(): string {
  const fromEnv = process.env.AGENTFLOW_AUTHOR;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  try {
    const out = execFileSync("git", ["config", "user.email"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (out.length > 0) return out;
  } catch {
    // fall through
  }
  return "unknown";
}

function readSprintId(sprintDir: string): string {
  const statePath = join(sprintDir, "state.json");
  if (!existsSync(statePath)) {
    throw new Error(
      `state.json not found at ${statePath} — is "${sprintDir}" an AgentFlow sprint dir?`,
    );
  }
  const state = JSON.parse(readFileSync(statePath, "utf-8")) as { sprintId?: string };
  if (typeof state.sprintId !== "string") {
    throw new Error(`state.json at ${statePath} has no sprintId.`);
  }
  return state.sprintId;
}

/**
 * Write the gate record. Pure side-effect on `.agentflow-feedback/feedback.jsonl`;
 * exported so tests can drive it without spawning the CLI process.
 */
export function writeGateRecord(args: {
  sprintDir: string;
  verb: WriteVerb;
  step: string;
  iteration?: string;
  body: string;
  author?: string;
}): WebFeedbackEvent {
  const sprintId = readSprintId(args.sprintDir);
  const webDir = join(args.sprintDir, FEEDBACK_DIR);
  mkdirSync(webDir, { recursive: true });
  const rec: WebFeedbackEvent = {
    id: randomUUID(),
    type: VERB_TO_TYPE[args.verb],
    sprintId,
    step: args.step,
    ...(args.iteration ? { iteration: args.iteration } : {}),
    author: args.author ?? resolveAuthor(),
    body: args.body,
    createdAt: new Date().toISOString(),
  };
  appendFileSync(join(webDir, "feedback.jsonl"), JSON.stringify(rec) + "\n", "utf-8");
  return rec;
}

/**
 * Stamp resolvedAt on the matching row of `.agentflow-feedback/feedback.jsonl`
 * in place. Append-only is the wrong model for resolution (we're mutating
 * an existing record's state, not adding a new event), so we rewrite the
 * file. Exported for tests; sync because the file is small per sprint.
 */
export function resolveFeedback(args: {
  sprintDir: string;
  id: string;
  resolvedAt?: string;
}): WebFeedbackEvent {
  const fbPath = join(args.sprintDir, FEEDBACK_DIR, "feedback.jsonl");
  if (!existsSync(fbPath)) {
    throw new Error(`feedback.jsonl not found at ${fbPath}.`);
  }
  const lines = readFileSync(fbPath, "utf-8").split("\n");
  const rows = lines
    .map((l, idx) => ({ raw: l, idx, rec: l.trim().length > 0 ? (JSON.parse(l) as WebFeedbackEvent) : null }))
    .filter((r) => r.rec !== null);
  const hit = rows.find((r) => r.rec!.id === args.id);
  if (!hit) {
    throw new Error(`feedback id "${args.id}" not found in ${fbPath}.`);
  }
  const ts = args.resolvedAt ?? new Date().toISOString();
  hit.rec!.resolvedAt = ts;
  // Rewrite preserving original order (sorted by idx).
  const sorted = rows.slice().sort((a, b) => a.idx - b.idx);
  writeFileSync(fbPath, sorted.map((r) => JSON.stringify(r.rec)).join("\n") + "\n", "utf-8");
  return hit.rec!;
}

async function main(): Promise<void> {
  const parsed = parseGateArgs(process.argv);
  if (parsed.verb === "resolve") {
    const rec = resolveFeedback({ sprintDir: parsed.sprintDir, id: parsed.id! });
    console.log(
      `[ag-resolve] stamped ${rec.id} (type=${rec.type} step=${rec.step ?? "?"}) resolvedAt=${rec.resolvedAt}`,
    );
    return;
  }
  const rec = writeGateRecord({
    sprintDir: parsed.sprintDir,
    verb: parsed.verb,
    step: parsed.step!,
    ...(parsed.iteration ? { iteration: parsed.iteration } : {}),
    body: parsed.body,
  });
  const target = rec.iteration ? `${rec.step}/${rec.iteration}` : rec.step;
  console.log(
    `[ag-${parsed.verb}] wrote ${rec.id} for ${target} author=${rec.author}`,
  );
}

const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /(?:^|[\\/])ag-gate\.(?:ts|js)$/.test(process.argv[1]);
if (invokedAsScript) {
  main().catch((err) => {
    console.error("[ag-gate] fatal:", (err as Error).message ?? err);
    process.exit(1);
  });
}
