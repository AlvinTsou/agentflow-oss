import { runStep } from "./claude.js";
import { runCodexStep } from "./codex.js";
import {
  runOpenAICompatibleRequest,
  runOpenAICompatibleStep,
  runOpenAICompatibleStream,
  smokeTestOpenAICompatible,
} from "./openai-compatible.js";
import { openRouterProvider } from "./openrouter.js";
import { geminiProvider } from "./gemini.js";
import type { Provider, StepProvider, ProviderRunOptions } from "./provider.js";

export const claudeProvider: StepProvider = {
  name: "claude",
  run(prompt: string, options: ProviderRunOptions = {}) {
    return runStep(prompt, {
      timeoutMs: options.timeoutMs,
      model: options.model,
      cwd: options.cwd,
      allowedTools: options.allowedTools,
      maxTurns: options.maxTurns,
    });
  },
};

export const codexProvider: StepProvider = {
  name: "codex",
  run(prompt: string, options: ProviderRunOptions = {}) {
    return runCodexStep(prompt, {
      timeoutMs: options.timeoutMs,
      model: options.model,
      cwd: options.cwd,
      reasoningEffort: options.reasoningEffort,
      reasoningEffortMaxFor80kInput: options.reasoningEffortMaxFor80kInput,
    });
  },
};

export const openAICompatibleProvider: StepProvider = {
  name: "openai-compatible",
  run(prompt: string, options: ProviderRunOptions = {}) {
    return runOpenAICompatibleStep(prompt, options);
  },
  runRequest(request, options: ProviderRunOptions = {}) {
    return runOpenAICompatibleRequest(request, options);
  },
  runStream(request, options: ProviderRunOptions = {}) {
    return runOpenAICompatibleStream(request, options);
  },
  smokeTest(options: ProviderRunOptions = {}) {
    return smokeTestOpenAICompatible(options);
  },
};

export { openRouterProvider, geminiProvider };

const PROVIDERS: Record<Provider, StepProvider> = {
  claude: claudeProvider,
  codex: codexProvider,
  "openai-compatible": openAICompatibleProvider,
  openrouter: openRouterProvider,
  gemini: geminiProvider,
  // gemini-oauth and antigravity are deferred in v1.
  // Users can register custom providers via MiddlemanConfig.providers.
  "gemini-oauth": claudeProvider, // placeholder — overridden via MiddlemanConfig
  antigravity: claudeProvider,    // placeholder — overridden via MiddlemanConfig
};

export function getProvider(name: Provider): StepProvider {
  return PROVIDERS[name];
}
