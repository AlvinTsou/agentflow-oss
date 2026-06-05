import type { Provider } from "./errors.js";
import type { StepResult } from "./claude.js";
import type { MiddlemanPolicy } from "./policy.js";
import type { MiddlemanRequest, MiddlemanStreamEvent } from "./protocol.js";

export type { Provider, StepResult };

export interface ProviderRunOptions {
  timeoutMs?: number;
  model?: string;
  cwd?: string;
  /** Claude only — ignored by Codex provider. */
  allowedTools?: string[];
  /** Claude only — override SDK maxTurns. Default scales with allowedTools. */
  maxTurns?: number;
  /** Codex only — ignored by Claude provider. */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  /**
   * Codex only. When the estimated input prompt exceeds an internal threshold
   * (currently 60K tokens, well below the 80K circuit breaker), Codex clamps
   * `reasoningEffort` so it never exceeds this cap. Below the threshold, the
   * original `reasoningEffort` setting is used.
   *
   * Use to declare "this step should auto-degrade reasoning when input is
   * large" without recipe code estimating tokens itself.
   */
  reasoningEffortMaxFor80kInput?: "low" | "medium" | "high";
  /** OpenAI-compatible only. Use for OpenAI, OpenRouter, or local compatible gateways. */
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  /** Extra request headers (e.g. OpenRouter's HTTP-Referer / X-Title). Merged with adapter defaults. */
  extraHeaders?: Record<string, string>;
  /** Middleman policy applied before the request reaches a provider. */
  policy?: MiddlemanPolicy;
}

export interface StepProvider {
  readonly name: Provider;
  run(prompt: string, options?: ProviderRunOptions): Promise<StepResult>;
  runRequest?(request: MiddlemanRequest, options?: ProviderRunOptions): Promise<StepResult>;
  runStream?(request: MiddlemanRequest, options?: ProviderRunOptions): AsyncIterable<MiddlemanStreamEvent>;
  smokeTest?(options?: ProviderRunOptions): Promise<{ success: boolean; message: string }>;
  capabilities?: Partial<Record<string, boolean>>;
}

export interface ProviderUsage {
  tokens: number;
  costUsd: number;
  calls: number;
}

export interface UsageMeter {
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Partial<Record<Provider, ProviderUsage>>;
}

export function newMeter(): UsageMeter {
  return { totalTokens: 0, totalCostUsd: 0, byProvider: {} };
}

export function recordCall(meter: UsageMeter, provider: Provider, result: StepResult): void {
  meter.totalTokens += result.totalTokens;
  meter.totalCostUsd += result.costUsd;
  const existing: ProviderUsage = meter.byProvider[provider] ?? { tokens: 0, costUsd: 0, calls: 0 };
  existing.tokens += result.totalTokens;
  existing.costUsd += result.costUsd;
  existing.calls += 1;
  meter.byProvider[provider] = existing;
}
