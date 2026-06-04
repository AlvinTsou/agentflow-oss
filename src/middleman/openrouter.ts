/**
 * OpenRouter provider — thin wrapper over the OpenAI-compatible adapter.
 *
 * OpenRouter ships an OpenAI Chat Completions API at openrouter.ai/api/v1,
 * so we delegate the request/stream paths and just pre-bake the baseUrl,
 * the API-key env name, and the recommended attribution headers.
 */
import {
  runOpenAICompatibleRequest,
  runOpenAICompatibleStep,
  runOpenAICompatibleStream,
} from "./openai-compatible.js";
import type { ProviderRunOptions, StepProvider } from "./provider.js";
import type { MiddlemanRequest, MiddlemanStreamEvent } from "./protocol.js";
import type { StepResult } from "./claude.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";
const DEFAULT_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://github.com/agentflow-oss/agentflow-oss",
  "X-Title": "agentflow-oss",
};

function withOpenRouterDefaults(options: ProviderRunOptions): ProviderRunOptions {
  return {
    ...options,
    baseUrl: options.baseUrl ?? OPENROUTER_BASE_URL,
    apiKeyEnv: options.apiKey ? undefined : (options.apiKeyEnv ?? OPENROUTER_API_KEY_ENV),
    extraHeaders: { ...DEFAULT_HEADERS, ...(options.extraHeaders ?? {}) },
  };
}

export function runOpenRouterStep(prompt: string, options: ProviderRunOptions = {}): Promise<StepResult> {
  return runOpenAICompatibleStep(prompt, withOpenRouterDefaults(options));
}

export function runOpenRouterRequest(
  request: MiddlemanRequest,
  options: ProviderRunOptions = {},
): Promise<StepResult> {
  return runOpenAICompatibleRequest(request, withOpenRouterDefaults(options));
}

export function runOpenRouterStream(
  request: MiddlemanRequest,
  options: ProviderRunOptions = {},
): AsyncIterable<MiddlemanStreamEvent> {
  return runOpenAICompatibleStream(request, withOpenRouterDefaults(options));
}

export const openRouterProvider: StepProvider = {
  name: "openrouter",
  run(prompt, options = {}) {
    return runOpenRouterStep(prompt, options);
  },
  runRequest(request, options = {}) {
    return runOpenRouterRequest(request, options);
  },
  runStream(request, options = {}) {
    return runOpenRouterStream(request, options);
  },
};
