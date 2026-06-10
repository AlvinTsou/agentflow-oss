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

async function assertSmokeTestWorks() {
  console.log("[test G] smokeTestOpenAICompatible works under mock");
  const originalFetch = globalThis.fetch;

  // Mock fetch for success
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [{ message: { content: "pong" } }]
        });
      }
    } as Response;
  };

  const { smokeTestOpenAICompatible } = await import("../src/middleman/openai-compatible.js");
  const res1 = await smokeTestOpenAICompatible({
    apiKey: "test-key",
    model: "test-model"
  });
  assert(res1.success === true, "smoke test succeeds with ok gateway");
  assert(res1.message.includes("Successfully connected"), "success message matches");

  // Mock fetch for failure (401 Unauthorized)
  globalThis.fetch = async () => {
    return {
      ok: false,
      status: 401,
      async text() {
        return "Unauthorized";
      }
    } as Response;
  };

  const res2 = await smokeTestOpenAICompatible({
    apiKey: "test-key",
    model: "test-model"
  });
  assert(res2.success === false, "smoke test fails with 401");
  assert(res2.message.includes("Gateway returned status 401"), "failure message captures 401");

  globalThis.fetch = originalFetch; // restore
}

function assertSecurityProfiles() {
  console.log("[test H] middleman policy supports security profiles");
  const request: MiddlemanRequest = {
    messages: [{ role: "user", content: "my key is sk-abcdefghijklmnopqrstuvwxyz123456" }],
  };

  // 1. Strict profile should block
  try {
    applyMiddlemanPolicy(request, { profile: "strict" });
    console.error("  FAIL: strict profile did not block secrets");
    failures++;
  } catch (err) {
    assert(err instanceof MiddlemanPolicyError, "strict profile blocked with MiddlemanPolicyError");
  }

  // 2. Off profile should pass raw
  const raw = applyMiddlemanPolicy(request, { profile: "off" });
  assert(raw.messages[0].content.includes("sk-"), "off profile did not redact secrets");

  // 3. Default profile should redact
  const redacted = applyMiddlemanPolicy(request, { profile: "default" });
  assert(redacted.messages[0].content.includes("[REDACTED:openai-api-key]"), "default profile redacted secrets");
}

async function assertUnsupportedCapabilityFailure() {
  console.log("[test I] middleman rejects unsupported capabilities");
  const fakeCodex: StepProvider = {
    name: "codex",
    run: async () => fakeResult("codex-run"),
  };
  const middleman = new Middleman({
    providers: { codex: fakeCodex },
    defaultProvider: "codex",
  });

  const requestWithTools: MiddlemanRequest = {
    messages: [{ role: "user", content: "do it" }],
    tools: [{ name: "my_tool", description: "a test tool" }],
  };

  try {
    await middleman.runRequest(requestWithTools, { provider: "codex" });
    console.error("  FAIL: unsupported capability did not throw");
    failures++;
  } catch (err) {
    if (err instanceof Error) {
      assert(err.message.includes("does not support required capabilities: tool-calls"), "unsupported capability throw message matches");
    } else {
      console.error("  FAIL: unsupported capability threw non-Error object");
      failures++;
    }
  }
}

async function assertRouteWarningPreservation() {
  console.log("[test J] middleman streaming fallback preserves warning");
  const fakeCodex: StepProvider = {
    name: "codex",
    run: async () => fakeResult("codex-run"),
  };
  const middleman = new Middleman({
    providers: { codex: fakeCodex },
    defaultProvider: "codex",
  });

  const events = [];
  for await (const event of middleman.stream("do it", { provider: "codex" })) {
    events.push(event);
  }

  const doneEvent = events.find((ev) => ev.type === "done");
  assert(doneEvent !== undefined, "done event found");
  if (doneEvent && doneEvent.type === "done") {
    assert(doneEvent.response.route !== undefined, "route metadata exists in response");
    assert(doneEvent.response.route?.warnings !== undefined, "route warnings exist");
    assert(doneEvent.response.route?.warnings?.[0]?.includes("does not support streaming") ?? false, "route warning message matches");
  }
}

async function assertExplicitProviderRouteMetadata() {
  console.log("[test K] middleman runRequest returns route metadata");
  const fakeClaude: StepProvider = {
    name: "claude",
    run: async () => fakeResult("claude-run"),
  };
  const middleman = new Middleman({
    providers: { claude: fakeClaude },
    defaultProvider: "claude",
  });

  const run = await middleman.runRequest(
    { messages: [{ role: "user", content: "hello" }] },
    { provider: "claude", policy: { profile: "strict" } }
  );

  const route = run.result.route;
  assert(route !== undefined, "route exists on StepResult");
  assert(route?.provider === "claude", "provider in route metadata is correct");
  assert(route?.policyProfile === "strict", "policy profile in route metadata is correct");
}

async function assertReasoningEffortOptionBehavior() {
  console.log("[test L] reasoningEffortMaxFor80kInput option behavior");
  const fakeClaude: StepProvider = {
    name: "claude",
    run: async () => fakeResult("claude-run"),
  };
  const fakeCodex: StepProvider = {
    name: "codex",
    run: async () => fakeResult("codex-run"),
  };
  const middleman = new Middleman({
    providers: { claude: fakeClaude, codex: fakeCodex },
    defaultProvider: "claude",
  });

  // 1. reasoningEffortMaxFor80kInput alone should route to codex
  const run1 = await middleman.run("hello", { reasoningEffortMaxFor80kInput: "medium" });
  assert(run1.route.provider === "codex", "reasoningEffortMaxFor80kInput alone routes to codex");

  // 2. explicit provider: "claude" with reasoningEffortMaxFor80kInput should be ignored and not throw
  try {
    const run2 = await middleman.run("hello", { provider: "claude", reasoningEffortMaxFor80kInput: "medium" });
    assert(run2.route.provider === "claude", "explicit provider claude wins and ignores reasoning options");
  } catch (err) {
    console.error("  FAIL: explicit claude with reasoning option threw error");
    failures++;
  }
}

async function assertCustomProviderCapabilities() {
  console.log("[test M] custom provider overrides capabilities");
  const customProvider: StepProvider = {
    name: "gemini-oauth",
    run: async () => fakeResult("custom-run"),
    async *runStream() {
      yield { type: "text-delta", text: "custom-stream" };
      yield {
        type: "done",
        response: {
          message: { role: "assistant", content: "custom-stream" },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          durationMs: 1,
          costUsd: 0,
        },
      };
    },
    capabilities: {
      "tool-calls": true,
    },
  };

  const middleman = new Middleman({
    providers: { "gemini-oauth": customProvider },
  });

  // 1. gemini-oauth has runStream, so streaming should be supported dynamically
  const events = [];
  for await (const ev of middleman.stream("hello", { provider: "gemini-oauth" })) {
    events.push(ev);
  }
  const done = events.find((e) => e.type === "done");
  assert(done !== undefined, "custom provider streamed successfully");
  if (done && done.type === "done") {
    assert(done.response.route?.warnings === undefined, "no streaming fallback warnings for custom provider");
  }

  // 2. gemini-oauth lists tool-calls in capabilities, so tool calls should not throw
  try {
    await middleman.runRequest(
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [{ name: "custom-tool", description: "custom tool description" }],
      },
      { provider: "gemini-oauth" }
    );
    assert(true, "custom provider with declared tool-calls capability did not throw");
  } catch (err) {
    console.error("  FAIL: custom provider threw on declared capability:", err);
    failures++;
  }
}

function assertCustomRedactions() {
  console.log("[test N] custom secret redaction policy behavior");

  const policy = {
    customRedactions: [
      { kind: "custom-token", pattern: "MY_SECRET_TOKEN_[0-9]{4}" }
    ]
  };

  // 1. default profile (should redact custom patterns)
  {
    const req: MiddlemanRequest = {
      messages: [{ role: "user", content: "My token is MY_SECRET_TOKEN_1234" }]
    };
    const redacted = applyMiddlemanPolicy(req, { ...policy, profile: "default" });
    assert(
      redacted.messages[0]?.content.includes("My token is [REDACTED:custom-token]") ?? false,
      "custom pattern redacted under default profile"
    );
  }

  // 2. strict profile (should block custom patterns)
  {
    const req: MiddlemanRequest = {
      messages: [{ role: "user", content: "My token is MY_SECRET_TOKEN_1234" }]
    };
    try {
      applyMiddlemanPolicy(req, { ...policy, profile: "strict" });
      console.error("  FAIL: strict profile did not block custom pattern");
      failures++;
    } catch (err) {
      assert(err instanceof MiddlemanPolicyError, "custom pattern blocks under strict profile");
    }
  }

  // 3. off profile (should bypass custom scanning and redaction)
  {
    const req: MiddlemanRequest = {
      messages: [{ role: "user", content: "My token is MY_SECRET_TOKEN_1234" }]
    };
    const normal = applyMiddlemanPolicy(req, { ...policy, profile: "off" });
    assert(
      normal.messages[0]?.content.includes("My token is MY_SECRET_TOKEN_1234") ?? false,
      "custom pattern bypasses under off profile"
    );
  }

  // 4. no false positives on ordinary code identifiers
  {
    const req: MiddlemanRequest = {
      messages: [{ role: "user", content: "My token is MY_SECRET_TOKEN_ABCD" }]
    };
    const redacted = applyMiddlemanPolicy(req, { ...policy, profile: "default" });
    assert(
      redacted.messages[0]?.content.includes("My token is MY_SECRET_TOKEN_ABCD") ?? false,
      "no false positives on ordinary code identifiers"
    );
  }
}

async function main() {
  assertPolicyRedacts();
  assertPolicyBlocks();
  assertProtocolFormatsRoles();
  await assertMiddlemanRoutesAndAppliesPolicy();
  await assertRequestNativeProviderPath();
  await assertMiddlemanStreamsNativeEvents();
  await assertSmokeTestWorks();
  assertSecurityProfiles();
  await assertUnsupportedCapabilityFailure();
  await assertRouteWarningPreservation();
  await assertExplicitProviderRouteMetadata();
  await assertReasoningEffortOptionBehavior();
  await assertCustomProviderCapabilities();
  assertCustomRedactions();

  console.log(`\n[result] failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[poc-middleman] fatal:", err);
  process.exit(2);
});
