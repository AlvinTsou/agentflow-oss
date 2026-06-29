import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { getSprintSummary } from "../workflow/management-api.js";
import { readStreamingCheckpoints } from "../workflow/streaming-checkpoint.js";
import { SprintEvent } from "../workflow/state-store.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const ACTION_EVENT_TYPES = {
  approve: "web-gate-decision",
  "request-changes": "web-gate-decision",
  "force-pass": "web-gate-decision",
  resume: "web-resume",
  "pin-iter": "web-pin-iter",
} as const;

type WebActionName = keyof typeof ACTION_EVENT_TYPES;

interface SprintIndexRecord {
  sprintId: string;
  recipeName?: string;
  sprintDir?: string;
  passed?: boolean;
  completedAt?: string;
  totalTokens?: number;
  totalCostUsd?: number;
  readiness?: string;
}

interface ManagementAppOptions {
  indexPath?: string;
  allowedOrigins?: string[];
}

function configuredAllowedOrigins(): string[] {
  const raw = process.env.AGENTFLOW_ALLOWED_ORIGINS;
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseWebActionBody(body: unknown):
  | { ok: true; action: WebActionName; step?: string; note?: string }
  | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const raw = body as Record<string, unknown>;
  if (typeof raw.action !== "string" || !(raw.action in ACTION_EVENT_TYPES)) {
    return { ok: false, error: "Action must be one of approve, request-changes, force-pass, resume, pin-iter" };
  }
  const action = raw.action as WebActionName;

  let step: string | undefined;
  if ("step" in raw) {
    if (typeof raw.step !== "string") return { ok: false, error: "Step must be a string" };
    step = raw.step.trim();
  }

  if (action !== "resume" && !step) {
    return { ok: false, error: "Step is required for this action" };
  }

  let note: string | undefined;
  if ("note" in raw) {
    if (typeof raw.note !== "string") return { ok: false, error: "Note must be a string" };
    note = raw.note.trim();
    if (note.length > 2000) return { ok: false, error: "Note must be 2000 characters or fewer" };
  }

  return { ok: true, action, step, note };
}

export function createManagementApp(options: ManagementAppOptions = {}) {
  const app = new Hono();
  const indexPath = options.indexPath ?? join(os.homedir(), ".agentflow", "sprint-index.jsonl");
  const allowedOrigins = new Set(options.allowedOrigins ?? configuredAllowedOrigins());

  app.use(
    "/*",
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type"],
    }),
  );

  // Helper to load sprint index records from the home directory index
  function getSprintRecords(): SprintIndexRecord[] {
    if (!existsSync(indexPath)) return [];
    try {
      return readFileSync(indexPath, "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as SprintIndexRecord);
    } catch (err) {
      console.error("Failed to read sprint index:", err);
      return [];
    }
  }

  // 1. GET /api/sprints
  app.get("/api/sprints", (c) => {
    const records = getSprintRecords();

    // Aggregate real-time summaries for active/accessible sprints
    const summaries = records.map((record) => {
      if (record.sprintDir && existsSync(record.sprintDir)) {
        const summary = getSprintSummary(record.sprintDir);
        if (summary) return summary;
      }
      // Fallback if directory is inaccessible
      return {
        sprintId: record.sprintId,
        recipeName: record.recipeName,
        sprintDir: record.sprintDir,
        phase: record.passed ? "completed" : "failed",
        currentStepIdx: 0,
        completedSteps: [],
        startedAt: record.completedAt || new Date().toISOString(),
        lastEventTs: record.completedAt || new Date().toISOString(),
        totalTokens: record.totalTokens || 0,
        totalCostUsd: record.totalCostUsd || 0,
        readiness: record.readiness || "unknown",
      };
    });

    return c.json(summaries);
  });

  // Helper to find a sprint by ID
  function findSprintDirById(sprintId: string): string | null {
    const records = getSprintRecords();
    const match = records.find((r) => r.sprintId === sprintId);
    if (match && match.sprintDir && existsSync(match.sprintDir)) {
      return match.sprintDir;
    }
    return null;
  }

  // 2. GET /api/sprints/:id/events
  app.get("/api/sprints/:id/events", (c) => {
    const sprintId = c.req.param("id");
    const sprintDir = findSprintDirById(sprintId);

    if (!sprintDir) {
      return c.json({ error: "Sprint not found or directory inaccessible" }, 404);
    }

    const eventsPath = join(sprintDir, "events.jsonl");
    if (!existsSync(eventsPath)) {
      return c.json([], 200);
    }

    try {
      const events = readFileSync(eventsPath, "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as SprintEvent);
      return c.json(events);
    } catch (err) {
      return c.json({ error: "Failed to read sprint events" }, 500);
    }
  });

  // 3. GET /api/sprints/:id/checkpoints
  app.get("/api/sprints/:id/checkpoints", (c) => {
    const sprintId = c.req.param("id");
    const sprintDir = findSprintDirById(sprintId);

    if (!sprintDir) {
      return c.json({ error: "Sprint not found or directory inaccessible" }, 404);
    }

    try {
      const checkpoints = readStreamingCheckpoints(sprintDir);
      return c.json(checkpoints);
    } catch (err) {
      return c.json({ error: "Failed to read checkpoints" }, 500);
    }
  });

  // 4. POST /api/sprints/:id/actions
  app.post("/api/sprints/:id/actions", async (c) => {
    const sprintId = c.req.param("id");
    const sprintDir = findSprintDirById(sprintId);

    if (!sprintDir) {
      return c.json({ error: "Sprint not found or directory inaccessible" }, 404);
    }

    try {
      const body = await c.req.json();
      const parsed = parseWebActionBody(body);

      if (!parsed.ok) {
        return c.json({ error: parsed.error }, 400);
      }

      const event: Omit<SprintEvent, "ts"> = {
        type: ACTION_EVENT_TYPES[parsed.action],
        step: parsed.step || "",
        msg: `Web UI action: ${parsed.action}${parsed.note ? ` (Note: ${parsed.note})` : ""}`,
        webAction: {
          action: parsed.action,
          ...(parsed.note ? { note: parsed.note } : {}),
        },
      };

      const eventWithTs: SprintEvent = { ts: new Date().toISOString(), ...event };
      const eventsPath = join(sprintDir, "events.jsonl");
      appendFileSync(eventsPath, `${JSON.stringify(eventWithTs)}\n`, "utf-8");

      return c.json({ success: true, event: eventWithTs });
    } catch (err) {
      return c.json({ error: "Failed to process control action" }, 500);
    }
  });

  return app;
}

const port = Number(process.env.PORT || 3000);
const hostname = process.env.AGENTFLOW_HOST || "127.0.0.1";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Starting AgentFlow Management Server on http://${hostname}:${port}...`);
  serve({
    fetch: createManagementApp().fetch,
    port,
    hostname,
  });
}
