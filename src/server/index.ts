import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { getSprintSummary } from "../workflow/management-api.js";
import { readStreamingCheckpoints } from "../workflow/streaming-checkpoint.js";
import { SprintEvent } from "../workflow/state-store.js";

const app = new Hono();

// Enable CORS for frontend UI development server access
app.use("/*", cors());

const INDEX_PATH = join(os.homedir(), ".agentflow", "sprint-index.jsonl");

// Helper to load sprint index records from the home directory index
function getSprintRecords() {
  if (!existsSync(INDEX_PATH)) return [];
  try {
    return readFileSync(INDEX_PATH, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (err) {
    console.error("Failed to read sprint index:", err);
    return [];
  }
}

// 1. GET /api/sprints
app.get("/api/sprints", (c) => {
  const records = getSprintRecords();
  
  // Aggregate real-time summaries for active/accessible sprints
  const summaries = records.map((record: any) => {
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
  const match = records.find((r: any) => r.sprintId === sprintId);
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
    const { action, step, note } = body;

    if (!action) {
      return c.json({ error: "Action is required" }, 400);
    }

    const event: any = {
      type: "web-action" as any,
      ts: new Date().toISOString(),
      step: step || "",
      msg: `Web UI action: ${action}${note ? ` (Note: ${note})` : ""}`,
      action: {
        action,
        note,
      },
    };

    const eventsPath = join(sprintDir, "events.jsonl");
    appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf-8");

    return c.json({ success: true, event });
  } catch (err) {
    return c.json({ error: "Failed to process control action" }, 500);
  }
});

const port = Number(process.env.PORT || 3000);
console.log(`Starting AgentFlow Management Server on port ${port}...`);
serve({
  fetch: app.fetch,
  port,
});
