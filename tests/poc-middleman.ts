import { Middleman } from "../src/middleman/middleman.js";
import { MiddlemanPolicyError, applyMiddlemanPolicy, scanSecrets } from "../src/middleman/policy.js";
import { requestToPrompt, type MiddlemanRequest } from "../src/middleman/protocol.js";
import type { StepProvider, StepResult } from "../src/middleman/provider.js";

function fakeResult(output: string): StepResult {
  return {
    output,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    durationMs: 1,
    costUsd: 0,
  };
}

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failures++;
  } else {
    console.log(`  PASS: ${message}`);
  }
}

function assertPolicyRedacts() {
  console.log("[test A] middleman policy redacts secret-looking values");
  const request: MiddlemanRequest = {
    messages: [{ role: "user", content: "token sk-abcdefghijklmnopqrstuvwxyz123456" }],
  };
  const findings = scanSecrets(request);
  const redacted = applyMiddlemanPolicy(request, { redactSecrets: true });

  assert(findings.length === 1, "secret scanner found one key");
  assert(redacted.messages[0]?.content.includes("[REDACTED:openai-api-key]") ?? false, "secret was redacted");
}

function assertPolicyBlocks() {
  console.log("[test B] middleman policy can block instead of redact");
  const request: MiddlemanRequest = {
    messages: [{ role: "user", content: "token sk-abcdefghijklmnopqrstuvwxyz123456" }],
  };

  try {
    applyMiddlemanPolicy(request, { blockSecrets: true });
    console.error("  FAIL: policy did not block");
    failures++;
  } catch (err) {
    assert(err instanceof MiddlemanPolicyError, "blocked with MiddlemanPolicyError");
  }
}

function assertProtocolFormatsRoles() {
  console.log("[test C] provider-neutral request serializes roles predictably");
  const prompt = requestToPrompt({
    messages: [
      { role: "system", content: "You route safely." },
      { role: "user", content: "Do the work." },
    ],
  });

  assert(prompt.includes("# SYSTEM\nYou route safely."), "system role preserved");
  assert(prompt.includes("# USER\nDo the work."), "user role preserved");
}

async function assertMiddlemanRoutesAndAppliesPolicy() {
  console.log("[test D] middleman facade routes to provider after applying policy");
  let capturedPrompt = "";
  const fakeClaude: StepProvider = {
    name: "claude",
    run: async (prompt) => {
      capturedPrompt = prompt;
      return fakeResult("ok");
    },
  };
  const middleman = new Middleman({
    providers: { claude: fakeClaude },
    defaultProvider: "claude",
  });

  const run = await middleman.run("secret sk-abcdefghijklmnopqrstuvwxyz123456", {
    provider: "claude",
  });

  assert(run.route.provider === "claude", "explicit provider selected");
  assert(run.route.reason === "explicit-provider", "route reason captured");
  assert(capturedPrompt.includes("[REDACTED:openai-api-key]"), "provider saw redacted prompt");
  assert(run.result.output === "ok", "provider result returned");
}

async function assertRequestNativeProviderPath() {
  console.log("[test E] providers can receive the neutral request natively");
  let sawSystemMessage = false;
  const fakeOpenAICompatible: StepProvider = {
    name: "openai-compatible",
    run: async () => fakeResult("fallback"),
    runRequest: async (request) => {
      sawSystemMessage = request.messages.some((message) => message.role === "system");
      return fakeResult("native");
    },
  };
  const middleman = new Middleman({
    providers: { "openai-compatible": fakeOpenAICompatible },
  });

  const run = await middleman.run("Do the work.", {
    provider: "openai-compatible",
    systemPrompt: "You route safely.",
    model: "test-model",
  });

  assert(sawSystemMessage, "native request preserved system message");
  assert(run.result.output === "native", "native request path was used");
}

async function assertMiddlemanStreamsNativeEvents() {
  console.log("[test F] middleman exposes provider-native stream events");
  const fakeOpenAICompatible: StepProvider = {
    name: "openai-compatible",
    run: async () => fakeResult("fallback"),
    async *runStream(request) {
      const sawSystem = request.messages.some((message) => message.role === "system");
      yield { type: "text-delta", text: sawSystem ? "hello " : "missing " };
      yield {
        type: "tool-call",
        call: { id: "call-1", name: "record_feedback", argumentsJson: "{\"ok\":true}" },
      };
      yield {
        type: "done",
        response: {
          message: { role: "assistant", content: "hello world" },
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          durationMs: 1,
          costUsd: 0,
        },
      };
    },
  };
  const middleman = new Middleman({
    providers: { "openai-compatible": fakeOpenAICompatible },
  });

  const events = [];
  for await (const event of middleman.stream("Do the work.", {
    provider: "openai-compatible",
    systemPrompt: "You route safely.",
    model: "test-model",
  })) {
    events.push(event);
  }

  assert(events[0]?.type === "route", "stream starts with route event");
  assert(events.some((event) => event.type === "text-delta" && event.text === "hello "), "stream includes text delta");
  assert(events.some((event) => event.type === "tool-call" && event.call.name === "record_feedback"), "stream includes tool-call event");
  assert(events.at(-1)?.type === "done", "stream ends with done event");
}

async function main() {
  assertPolicyRedacts();
  assertPolicyBlocks();
  assertProtocolFormatsRoles();
  await assertMiddlemanRoutesAndAppliesPolicy();
  await assertRequestNativeProviderPath();
  await assertMiddlemanStreamsNativeEvents();

  console.log(`\n[result] failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[poc-middleman] fatal:", err);
  process.exit(2);
});
