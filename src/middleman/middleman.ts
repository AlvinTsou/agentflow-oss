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
import { providerSupports, type ProviderCapability } from "./capabilities.js";

export interface RouteDecision {
  provider: Provider;
  reason: string;
  matchedRule?: string;
  requiredCapabilities?: ProviderCapability[];
  warnings?: string[];
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
    const route = this.chooseRoute(rawRequest, options, false);
    const request = applyMiddlemanPolicy(rawRequest, {
      ...this.defaultPolicy,
      ...options.policy,
    });
    const provider = this.providers[route.provider] ?? getProvider(route.provider);
    const result = provider.runRequest
      ? await provider.runRequest(request, options)
      : await provider.run(requestToPrompt(request), options);

    const effectiveProfile = options.policy?.profile ?? this.defaultPolicy?.profile ?? "default";
    const resultWithRoute = {
      ...result,
      route: {
        provider: route.provider,
        model: options.model ?? request.model,
        reason: route.reason,
        matchedRule: route.matchedRule,
        warnings: route.warnings,
        policyProfile: effectiveProfile,
      },
    };

    return { route, request, result: resultWithRoute };
  }

  async *stream(prompt: string, options: MiddlemanRunOptions = {}): AsyncIterable<MiddlemanStreamEvent> {
    yield* this.streamRequest(promptToRequest(prompt, options.systemPrompt), options);
  }

  async *streamRequest(
    rawRequest: MiddlemanRequest,
    options: MiddlemanRunOptions = {},
  ): AsyncIterable<MiddlemanStreamEvent> {
    const route = this.chooseRoute(rawRequest, options, true);
    const request = applyMiddlemanPolicy(rawRequest, {
      ...this.defaultPolicy,
      ...options.policy,
    });
    yield { type: "route", provider: route.provider, reason: route.reason };

    const effectiveProfile = options.policy?.profile ?? this.defaultPolicy?.profile ?? "default";
    const routeMeta = {
      provider: route.provider,
      model: options.model ?? request.model,
      reason: route.reason,
      matchedRule: route.matchedRule,
      warnings: route.warnings,
      policyProfile: effectiveProfile,
    };

    const provider = this.providers[route.provider] ?? getProvider(route.provider);
    if (provider.runStream && this.hasCapability(route.provider, "streaming")) {
      for await (const ev of provider.runStream(request, options)) {
        if (ev.type === "done") {
          yield {
            ...ev,
            response: {
              ...ev.response,
              route: routeMeta,
            },
          };
        } else {
          yield ev;
        }
      }
      return;
    }

    const result = provider.runRequest
      ? await provider.runRequest(request, options)
      : await provider.run(requestToPrompt(request), options);
    if (result.output) yield { type: "text-delta", text: result.output };
    yield {
      type: "done",
      response: {
        ...stepResultToResponse(result),
        route: routeMeta,
      },
    };
  }

  private hasCapability(provider: Provider, capability: ProviderCapability): boolean {
    const instance = this.providers[provider] ?? getProvider(provider);
    if (instance) {
      if (instance.capabilities && instance.capabilities[capability] !== undefined) {
        return !!instance.capabilities[capability];
      }
      if (capability === "streaming" && typeof instance.runStream === "function") {
        return true;
      }
      if (capability === "smoke-test" && typeof instance.smokeTest === "function") {
        return true;
      }
    }
    return providerSupports(provider, capability);
  }

  private chooseRoute(
    rawRequest: MiddlemanRequest,
    options: MiddlemanRunOptions,
    isStream: boolean,
  ): RouteDecision {
    let provider = this.defaultProvider;
    let reason = "default-provider";

    if (options.provider) {
      provider = options.provider;
      reason = "explicit-provider";
    } else if (options.baseUrl || options.apiKey || options.apiKeyEnv) {
      provider = "openai-compatible";
      reason = "openai-compatible-options";
    } else if (options.reasoningEffort || options.reasoningEffortMaxFor80kInput) {
      provider = "codex";
      reason = "codex-reasoning-effort";
    }

    const requiredCapabilities: ProviderCapability[] = [];
    if (rawRequest.tools && rawRequest.tools.length > 0) {
      requiredCapabilities.push("tool-calls");
    }
    if (rawRequest.responseFormat?.type === "json_object") {
      requiredCapabilities.push("json-response");
    }
    if (isStream) {
      requiredCapabilities.push("streaming");
    }
    if (provider === "codex" && (options.reasoningEffort || options.reasoningEffortMaxFor80kInput)) {
      requiredCapabilities.push("reasoning-effort");
    }

    const warnings: string[] = [];
    const missingCapabilities = requiredCapabilities.filter(
      (cap) => !this.hasCapability(provider, cap)
    );

    if (missingCapabilities.length > 0) {
      if (missingCapabilities.length === 1 && missingCapabilities[0] === "streaming") {
        warnings.push(`Provider "${provider}" does not support streaming natively, falling back to non-streaming query.`);
      } else {
        throw new Error(
          `Provider "${provider}" does not support required capabilities: ${missingCapabilities.join(", ")}`
        );
      }
    }

    return {
      provider,
      reason,
      requiredCapabilities,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
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
