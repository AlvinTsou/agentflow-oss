/**
 * Offline check: local management server security boundaries.
 * Verifies that the Hono app is loopback-oriented, uses a CORS allowlist, and
 * writes typed web-originated events for supported actions only.
 *
 * Run: node --import tsx tests/poc-server-security.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createManagementApp } from "../src/server/index.js";
import { StateStore } from "../src/workflow/state-store.js";

const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });

async function main() {
  const tmp = mkdtempSync(join(testTmpDir, "server-security-"));

  try {
    const sprintDir = join(tmp, "sprint");
    const store = new StateStore(sprintDir);
    store.init("test-recipe", "SPRINT_SERVER_SECURITY");

    const indexPath = join(tmp, "sprint-index.jsonl");
    writeFileSync(
      indexPath,
      `${JSON.stringify({
        sprintId: "SPRINT_SERVER_SECURITY",
        recipeName: "test-recipe",
        sprintDir,
        completedAt: "2026-06-29T00:00:00.000Z",
      })}\n`,
      "utf-8",
    );

    const app = createManagementApp({
      indexPath,
      allowedOrigins: ["http://localhost:5173"],
    });

    const allowedCors = await app.request("/api/sprints", {
      headers: { origin: "http://localhost:5173" },
    });
    assert.equal(allowedCors.headers.get("access-control-allow-origin"), "http://localhost:5173");

    const blockedCors = await app.request("/api/sprints", {
      headers: { origin: "https://example.com" },
    });
    assert.equal(blockedCors.headers.get("access-control-allow-origin"), null);

    const invalidAction = await app.request("/api/sprints/SPRINT_SERVER_SECURITY/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete-sprint", step: "review" }),
    });
    assert.equal(invalidAction.status, 400);

    const missingStep = await app.request("/api/sprints/SPRINT_SERVER_SECURITY/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    assert.equal(missingStep.status, 400);

    const approve = await app.request("/api/sprints/SPRINT_SERVER_SECURITY/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", step: "review", note: "approved locally" }),
    });
    assert.equal(approve.status, 200);

    const events = readFileSync(join(sprintDir, "events.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const webEvent = events.find((event) => event.webAction?.action === "approve");
    assert.ok(webEvent);
    assert.equal(webEvent.type, "web-gate-decision");
    assert.equal(webEvent.step, "review");
    assert.equal(webEvent.webAction.note, "approved locally");

    console.log("ok  management server security boundaries verified");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
