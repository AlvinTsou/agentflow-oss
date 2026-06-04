import {
  query,
  type Options,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { StepTimeoutError } from "./errors.js";

export const TOKEN_LIMIT = 80_000;
// 180s was too tight: SDD's tkt/dev/wrap steps inline several prior artifacts
// and routinely emit 4-6K-token completions which take 2-3 minutes wall-clock.
// 300s gives headroom without hiding actual hangs.
export const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Resolve the hard step timeout. Precedence: explicit `override` >
 * `AGENTFLOW_STEP_TIMEOUT_MS` env > {@link DEFAULT_TIMEOUT_MS}. The env is
 * read per call (not at module load) so a single process can pick up a value
 * exported just before launching a resume. Throws on a malformed env value
 * rather than silently falling back, so a typo surfaces immediately.
 */
export function resolveTimeoutMs(override?: number): number {
  if (override !== undefined) return override;

  const raw = process.env.AGENTFLOW_STEP_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid AGENTFLOW_STEP_TIMEOUT_MS: ${raw}`);
  }
  return n;
}

export interface StepResult {
  output: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  costUsd: number;
}

export interface RunStepOptions {
  /** Hard ms timeout. Default 300_000 (5 min). */
  timeoutMs?: number;
  model?: string;
  cwd?: string;
  /** Tools the Claude Agent SDK is allowed to use. Default = none. */
  allowedTools?: string[];
  /**
   * Per-step max-turns override. Default depends on whether tools are allowed:
   *   - allowedTools empty → 8 (text-only; covers Opus stray tool_use)
   *   - allowedTools non-empty → 25 (genuine agentic work: read + write + run)
   */
  maxTurns?: number;
  /** Override the abort controller (otherwise one is created internally). */
  abortController?: AbortController;
}

export async function runStep(
  prompt: string,
  override: RunStepOptions = {}
): Promise<StepResult> {
  const start = Date.now();
  const timeoutMs = resolveTimeoutMs(override.timeoutMs);
  const abortController = override.abortController ?? new AbortController();

  const allowedTools = override.allowedTools ?? [];
  // Opus 4.7 keeps emitting tool_use blocks on technically-flavoured prompts
  // (file paths, JSONL, CLI subcommands) even when allowedTools is empty.
  // Each rejected tool call burns a turn. For text-only steps (allowedTools
  // is empty) we additionally inject a hard system prompt to forbid tools
  // up front — this stops the loop at the model layer, not at the SDK.
  //
  // maxTurns default scales with tool access:
  //   - text-only (allowedTools=[])  → 8   (covers stray tool_use)
  //   - agentic (Read/Write/Bash)    → 25  (real agent loops: read prior art,
  //                                          write code, run tests, fix, retry)
  const defaultMaxTurns = allowedTools.length > 0 ? 25 : 8;
  const options: Options = {
    permissionMode: "bypassPermissions",
    settingSources: [],
    allowedTools,
    maxTurns: override.maxTurns ?? defaultMaxTurns,
    model: override.model,
    cwd: override.cwd,
    abortController,
    ...(allowedTools.length === 0
      ? {
          systemPrompt:
            "You have NO tool access in this session. Do NOT attempt any tool calls (Read, Write, Bash, Edit, Grep, etc.) — every such attempt is rejected by the harness and wastes turns. Treat the user's message as your sole input and respond with text only.",
        }
      : {}),
  };

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  let resultMsg: SDKResultMessage | null = null;

  try {
    for await (const msg of query({ prompt, options })) {
      if (msg.type === "result") {
        resultMsg = msg;
        break;
      }
    }
  } catch (err) {
    if (timedOut) throw new StepTimeoutError("claude", Date.now() - start);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) throw new StepTimeoutError("claude", Date.now() - start);
  if (!resultMsg) throw new Error("step produced no result message");
  if (resultMsg.subtype !== "success") {
    throw new Error(`step failed: subtype=${resultMsg.subtype}`);
  }

  const inputTokens = resultMsg.usage.input_tokens ?? 0;
  const outputTokens = resultMsg.usage.output_tokens ?? 0;
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens > TOKEN_LIMIT) {
    throw new Error(
      `Circuit breaker: step used ${totalTokens} tokens (> ${TOKEN_LIMIT}). Aborting.`
    );
  }

  return {
    output: resultMsg.result,
    inputTokens,
    outputTokens,
    totalTokens,
    durationMs: Date.now() - start,
    costUsd: resultMsg.total_cost_usd ?? 0,
  };
}
