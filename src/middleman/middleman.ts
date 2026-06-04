import { getProvider } from "./router.js";
import type { Provider, ProviderRunOptions, StepProvider } from "./provider.js";
import { applyMiddlemanPolicy, type MiddlemanPolicy } from "./policy.js";
import {
  promptToRequest,
  requestToPrompt,
  stepResultToResponse,
  type MiddlemanRequest,
  type MiddlemanStreamEvent,
} from "./protocol.js";

export interface RouteDecision {
  provider: Provider;
  reason: string;
}

export interface MiddlemanRunOptions extends ProviderRunOptions {
  provider?: Provider;
  systemPrompt?: string;
  policy?: MiddlemanPolicy;
}

export interface MiddlemanRunResult {
  route: RouteDecision;
  request: MiddlemanRequest;
  result: Awaited<ReturnType<StepProvider["run"]>>;
}

export interface MiddlemanConfig {
  providers?: Partial<Record<Provider, StepProvider>>;
  defaultProvider?: Provider;
  defaultPolicy?: MiddlemanPolicy;
}

export class Middleman {
  private readonly providers: Partial<Record<Provider, StepProvider>>;
  private readonly defaultProvider: Provider;
  private readonly defaultPolicy: MiddlemanPolicy;

  constructor(config: MiddlemanConfig = {}) {
    this.providers = config.providers ?? {};
    this.defaultProvider = config.defaultProvider ?? "claude";
    this.defaultPolicy = config.defaultPolicy ?? { redactSecrets: true };
  }

  async run(prompt: string, options: MiddlemanRunOptions = {}): Promise<MiddlemanRunResult> {
    return this.runRequest(promptToRequest(prompt, options.systemPrompt), options);
  }

  async runRequest(
    rawRequest: MiddlemanRequest,
    options: MiddlemanRunOptions = {},
  ): Promise<MiddlemanRunResult> {
    const route = this.chooseRoute(options);
    const request = applyMiddlemanPolicy(rawRequest, {
      ...this.defaultPolicy,
      ...options.policy,
    });
    const provider = this.providers[route.provider] ?? getProvider(route.provider);
    const result = provider.runRequest
      ? await provider.runRequest(request, options)
      : await provider.run(requestToPrompt(request), options);
    return { route, request, result };
  }

  async *stream(prompt: string, options: MiddlemanRunOptions = {}): AsyncIterable<MiddlemanStreamEvent> {
    yield* this.streamRequest(promptToRequest(prompt, options.systemPrompt), options);
  }

  async *streamRequest(
    rawRequest: MiddlemanRequest,
    options: MiddlemanRunOptions = {},
  ): AsyncIterable<MiddlemanStreamEvent> {
    const route = this.chooseRoute(options);
    const request = applyMiddlemanPolicy(rawRequest, {
      ...this.defaultPolicy,
      ...options.policy,
    });
    yield { type: "route", provider: route.provider, reason: route.reason };

    const provider = this.providers[route.provider] ?? getProvider(route.provider);
    if (provider.runStream) {
      yield* provider.runStream(request, options);
      return;
    }

    const result = provider.runRequest
      ? await provider.runRequest(request, options)
      : await provider.run(requestToPrompt(request), options);
    if (result.output) yield { type: "text-delta", text: result.output };
    yield { type: "done", response: stepResultToResponse(result) };
  }

  private chooseRoute(options: MiddlemanRunOptions): RouteDecision {
    if (options.provider) {
      return { provider: options.provider, reason: "explicit-provider" };
    }
    if (options.baseUrl || options.apiKey || options.apiKeyEnv) {
      return { provider: "openai-compatible", reason: "openai-compatible-options" };
    }
    if (options.reasoningEffort) {
      return { provider: "codex", reason: "codex-reasoning-effort" };
    }
    return { provider: this.defaultProvider, reason: "default-provider" };
  }
}

const defaultMiddleman = new Middleman();

export async function runMiddlemanStep(prompt: string, options: MiddlemanRunOptions = {}) {
  const run = await defaultMiddleman.run(prompt, options);
  return run.result;
}

export async function runMiddlemanRequest(request: MiddlemanRequest, options: MiddlemanRunOptions = {}) {
  const run = await defaultMiddleman.runRequest(request, options);
  return run.result;
}
