import type { Provider } from "./errors.js";

export type ProviderCapability =
  | "streaming"
  | "tool-calls"
  | "json-response"
  | "smoke-test"
  | "token-limits"
  | "timeout"
  | "openai-compatible"
  | "reasoning-effort";

const providerCapabilitiesMap: Record<Provider, Record<ProviderCapability, boolean>> = {
  claude: {
    streaming: false,
    "tool-calls": true,
    "json-response": false,
    "smoke-test": false,
    "token-limits": true,
    timeout: true,
    "openai-compatible": false,
    "reasoning-effort": false,
  },
  codex: {
    streaming: false,
    "tool-calls": false,
    "json-response": false,
    "smoke-test": false,
    "token-limits": true,
    timeout: true,
    "openai-compatible": false,
    "reasoning-effort": true,
  },
  "openai-compatible": {
    streaming: true,
    "tool-calls": true,
    "json-response": true,
    "smoke-test": true,
    "token-limits": true,
    timeout: true,
    "openai-compatible": true,
    "reasoning-effort": false,
  },
  openrouter: {
    streaming: true,
    "tool-calls": true,
    "json-response": true,
    "smoke-test": false,
    "token-limits": true,
    timeout: true,
    "openai-compatible": true,
    "reasoning-effort": false,
  },
  gemini: {
    streaming: true,
    "tool-calls": true,
    "json-response": true,
    "smoke-test": false,
    "token-limits": true,
    timeout: true,
    "openai-compatible": false,
    "reasoning-effort": false,
  },
  "gemini-oauth": {
    streaming: false,
    "tool-calls": false,
    "json-response": false,
    "smoke-test": false,
    "token-limits": false,
    timeout: false,
    "openai-compatible": false,
    "reasoning-effort": false,
  },
  antigravity: {
    streaming: false,
    "tool-calls": false,
    "json-response": false,
    "smoke-test": false,
    "token-limits": false,
    timeout: false,
    "openai-compatible": false,
    "reasoning-effort": false,
  },
};

export function getProviderCapabilities(provider: Provider): Record<ProviderCapability, boolean> {
  return providerCapabilitiesMap[provider] ?? {
    streaming: false,
    "tool-calls": false,
    "json-response": false,
    "smoke-test": false,
    "token-limits": false,
    timeout: false,
    "openai-compatible": false,
    "reasoning-effort": false,
  };
}

export function providerSupports(provider: Provider, capability: ProviderCapability): boolean {
  return !!getProviderCapabilities(provider)[capability];
}

export function describeProviderCapabilities(provider: Provider): string {
  const caps = getProviderCapabilities(provider);
  const supported = Object.entries(caps)
    .filter(([_, value]) => value)
    .map(([key]) => key);
  if (supported.length === 0) {
    return `${provider} supports no special capabilities.`;
  }
  return `${provider} supports: ${supported.join(", ")}.`;
}
