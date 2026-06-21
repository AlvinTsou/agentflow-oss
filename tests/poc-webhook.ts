/**
 * Offline check: Webhook Notifications (Long-term Backlog).
 * Verifies that the engine triggers HTTP POST requests to configured URLs
 * when sprint events occur, filtering correctly by event type.
 *
 * Run: pnpm exec tsx tests/poc-webhook.ts
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { runSprint } from "../src/workflow/sprint-engine.js";
import { initSprintRepo } from "../src/workflow/sprint-repo.js";
import { Middleman } from "../src/middleman/middleman.js";
import type { MiddlemanRequest } from "../src/middleman/protocol.js";
import type { MiddlemanRunOptions } from "../src/middleman/middleman.js";
import type { Recipe } from "../src/recipe/types.js";

const testTmpDir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
mkdirSync(testTmpDir, { recursive: true });

async function main() {
  const receivedPayloads: any[] = [];
  
  // Start a local mock HTTP server to receive webhook posts
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    receivedPayloads.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  // Listen on a random available port
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address() as any;
  const port = address.port;
  const webhookUrl = `http://127.0.0.1:${port}/webhook`;

  const recipe: Recipe = {
    name: "test-webhook-recipe",
    description: "Recipe to test webhook notification pipeline",
    steps: [
      {
        name: "webhook-step",
        provider: "claude",
        intent: "synthetic",
        producePrompt: "hello",
        rubric: `Output ONLY a single-line JSON object with keys: "score": 10, "passed": [], "failed": [], "notes": ""`,
      },
    ],
  };

  mock.method(Middleman.prototype, "runRequest", async (rawRequest: MiddlemanRequest, _options?: MiddlemanRunOptions) => {
    const userMessage = rawRequest.messages.find((m: any) => m.role === "user")?.content ?? "";

    if (userMessage.includes("Score") || userMessage.includes("JSON")) {
      return {
        route: { provider: "claude" as const, reason: "mock" },
        request: rawRequest,
        result: {
          output: `{"score": 10, "passed": ["C1"], "failed": [], "notes": "ok"}`,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          durationMs: 2,
          costUsd: 0.00015,
          route: { provider: "claude", reason: "mock" },
        },
      };
    }

    return {
      route: { provider: "claude" as const, reason: "mock" },
      request: rawRequest,
      result: {
        output: "webhook product body",
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        durationMs: 3,
        costUsd: 0.0003,
        route: { provider: "claude", reason: "mock" },
      },
    };
  });

  const tmp = mkdtempSync(join(testTmpDir, "webhook-test-"));
  initSprintRepo(tmp);

  writeFileSync(join(tmp, "INPUT.md"), "# Test Brief\n\nWebhook integration test", "utf-8");
  // Set up agentflow.config.json with webhook url and filter only sprint events to keep it small
  writeFileSync(
    join(tmp, "agentflow.config.json"),
    `{
      "recipe": "test-webhook-recipe",
      "gate": { "defaultMode": "auto" },
      "webhooks": [
        {
          "url": "${webhookUrl}",
          "events": ["sprint-started", "sprint-completed"]
        }
      ]
    }`,
    "utf-8",
  );

  try {
    const result = await runSprint({
      recipe,
      sprintDir: tmp,
      sprintId: "test-webhook-sprint-1",
    });
    assert.equal(result.passed, true);

    // Wait slightly to ensure asynchronous fetches complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify webhook signals received
    assert.ok(receivedPayloads.length > 0, "Webhook server should receive payloads");
    
    // Check sprint-started event
    const startEvent = receivedPayloads.find(p => p.event.type === "sprint-started");
    assert.ok(startEvent, "sprint-started event should be sent");
    assert.equal(startEvent.sprintId, "test-webhook-sprint-1");
    assert.equal(startEvent.recipeName, "test-webhook-recipe");

    // Check sprint-completed event
    const completeEvent = receivedPayloads.find(p => p.event.type === "sprint-completed");
    assert.ok(completeEvent, "sprint-completed event should be sent");
    assert.equal(completeEvent.sprintId, "test-webhook-sprint-1");

    // Verify filter works: other events (like step-started/passed) should NOT be sent
    const stepStartedEvent = receivedPayloads.find(p => p.event.type === "step-started");
    assert.equal(stepStartedEvent, undefined, "Filtered events (step-started) should not be sent");

    console.log("ok  webhook notifications verified successfully");
  } finally {
    mock.reset();
    server.close();
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
