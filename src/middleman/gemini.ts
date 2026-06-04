/**
 * Gemini provider — Google Generative Language API adapter.
 *
 * Maps MiddlemanRequest onto Gemini's generateContent / streamGenerateContent
 * endpoints. Tool calling is supported via functionDeclarations + toolConfig.
 * Cost is reported as 0; recipes that care about per-call cost should account
 * for Gemini pricing externally.
 *
 * Free-tier default model: gemini-3.1-flash-lite.
 */
import { DEFAULT_TIMEOUT_MS, TOKEN_LIMIT, type StepResult } from "./claude.js";
import { StepTimeoutError } from "./errors.js";
import type { ProviderRunOptions, StepProvider } from "./provider.js";
import type {
  MiddlemanMessage,
  MiddlemanRequest,
  MiddlemanResponse,
  MiddlemanStreamEvent,
  MiddlemanToolCall,
} from "./protocol.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name?: string; response?: Record<string, unknown> };
}

interface GeminiContent {
  role?: "user" | "model" | "function";
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
}

function resolveConfig(options: ProviderRunOptions) {
  const baseUrl = (options.baseUrl ?? GEMINI_BASE_URL).replace(/\/$/, "");
  const apiKey = options.apiKey ?? (options.apiKeyEnv ? process.env[options.apiKeyEnv] : process.env[GEMINI_API_KEY_ENV]);
  if (!apiKey) {
    throw new Error(`gemini provider requires apiKey, apiKeyEnv, or ${GEMINI_API_KEY_ENV}.`);
  }
  const model = options.model ?? DEFAULT_MODEL;
  return { baseUrl, apiKey, model };
}

function toGeminiPart(message: MiddlemanMessage): GeminiPart {
  return { text: message.content };
}

function toGeminiContents(messages: MiddlemanMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      contents.push({
        role: "function",
        parts: [{ functionResponse: { name: message.name ?? "tool", response: { content: message.content } } }],
      });
      continue;
    }
    const role: GeminiContent["role"] = message.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [toGeminiPart(message)] });
  }
  return contents;
}

function toSystemInstruction(messages: MiddlemanMessage[]): GeminiContent | undefined {
  const systemMessages = messages.filter((m) => m.role === "system");
  if (systemMessages.length === 0) return undefined;
  return { parts: systemMessages.map((m) => ({ text: m.content })) };
}

function toFunctionDeclarations(request: MiddlemanRequest) {
  if (!request.tools?.length) return undefined;
  return [
    {
      functionDeclarations: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
      })),
    },
  ];
}

function toToolConfig(request: MiddlemanRequest) {
  const choice = request.toolChoice;
  if (!choice) return undefined;
  if (choice === "auto") return { functionCallingConfig: { mode: "AUTO" } };
  if (choice === "none") return { functionCallingConfig: { mode: "NONE" } };
  if (choice === "required") return { functionCallingConfig: { mode: "ANY" } };
  return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] } };
}

function toGenerationConfig(request: MiddlemanRequest) {
  if (request.responseFormat?.type === "json_object") {
    return { responseMimeType: "application/json" };
  }
  return undefined;
}

function buildBody(request: MiddlemanRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: toGeminiContents(request.messages),
  };
  const system = toSystemInstruction(request.messages);
  if (system) body.systemInstruction = system;
  const tools = toFunctionDeclarations(request);
  if (tools) body.tools = tools;
  const toolConfig = toToolConfig(request);
  if (toolConfig) body.toolConfig = toolConfig;
  const generationConfig = toGenerationConfig(request);
  if (generationConfig) body.generationConfig = generationConfig;
  return body;
}

function extractToolCalls(parts: GeminiPart[]): MiddlemanToolCall[] {
  const calls: MiddlemanToolCall[] = [];
  parts.forEach((part, index) => {
    if (part.functionCall?.name) {
      calls.push({
        id: `gemini-tool-${index}`,
        name: part.functionCall.name,
        argumentsJson: JSON.stringify(part.functionCall.args ?? {}),
      });
    }
  });
  return calls;
}

function extractText(parts: GeminiPart[]): string {
  return parts
    .map((part) => part.text ?? "")
    .filter((text) => text.length > 0)
    .join("");
}

function outputForToolCalls(toolCalls: MiddlemanToolCall[]): string {
  return JSON.stringify({ toolCalls });
}

function geminiUrl(baseUrl: string, model: string, apiKey: string, stream: boolean): string {
  const endpoint = stream ? "streamGenerateContent" : "generateContent";
  const query = stream ? `?alt=sse&key=${apiKey}` : `?key=${apiKey}`;
  return `${baseUrl}/models/${model}:${endpoint}${query}`;
}

export async function runGeminiStep(prompt: string, options: ProviderRunOptions = {}): Promise<StepResult> {
  return runGeminiRequest({ messages: [{ role: "user", content: prompt }], model: options.model }, options);
}

export async function runGeminiRequest(
  request: MiddlemanRequest,
  options: ProviderRunOptions = {},
): Promise<StepResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const { baseUrl, apiKey, model } = resolveConfig(options);

  try {
    const response = await fetch(geminiUrl(baseUrl, model, apiKey, false), {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.extraHeaders ?? {}) },
      body: JSON.stringify(buildBody(request)),
      signal: abortController.signal,
    });
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`gemini request failed (${response.status}): ${rawText.slice(0, 800)}`);
    }
    const json = JSON.parse(rawText) as GeminiResponse;
    if (json.error?.message) {
      throw new Error(`gemini provider error: ${json.error.message}`);
    }

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = extractText(parts);
    const toolCalls = extractToolCalls(parts);
    const output = text || (toolCalls.length > 0 ? outputForToolCalls(toolCalls) : "");
    if (!output) throw new Error("gemini provider returned no candidate content.");

    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
    const totalTokens = json.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens;
    if (totalTokens > TOKEN_LIMIT) {
      throw new Error(`Circuit breaker: gemini step used ${totalTokens} tokens (> ${TOKEN_LIMIT}).`);
    }

    return { output, inputTokens, outputTokens, totalTokens, durationMs: Date.now() - start, costUsd: 0 };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new StepTimeoutError("gemini", Date.now() - start);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function* runGeminiStream(
  request: MiddlemanRequest,
  options: ProviderRunOptions = {},
): AsyncIterable<MiddlemanStreamEvent> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const { baseUrl, apiKey, model } = resolveConfig(options);

  try {
    const response = await fetch(geminiUrl(baseUrl, model, apiKey, true), {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.extraHeaders ?? {}) },
      body: JSON.stringify(buildBody(request)),
      signal: abortController.signal,
    });
    if (!response.ok) {
      const rawError = await response.text();
      throw new Error(`gemini stream failed (${response.status}): ${rawError.slice(0, 800)}`);
    }
    if (!response.body) {
      throw new Error("gemini stream returned no response body.");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let output = "";
    const toolCalls: MiddlemanToolCall[] = [];
    let usage: MiddlemanResponse["usage"] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    while (true) {
      const read = await reader.read();
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice("data:".length).trim();
        if (!data) continue;
        const chunk = JSON.parse(data) as GeminiResponse;
        if (chunk.error?.message) throw new Error(`gemini provider error: ${chunk.error.message}`);
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          };
          yield { type: "usage", usage };
        }
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        const deltaText = extractText(parts);
        if (deltaText) {
          output += deltaText;
          yield { type: "text-delta", text: deltaText };
        }
        const deltaCalls = extractToolCalls(parts);
        if (deltaCalls.length) toolCalls.push(...deltaCalls);
      }
    }

    for (const call of toolCalls) yield { type: "tool-call", call };

    const totalTokens = usage.totalTokens || usage.inputTokens + usage.outputTokens;
    if (totalTokens > TOKEN_LIMIT) {
      throw new Error(`Circuit breaker: gemini stream used ${totalTokens} tokens (> ${TOKEN_LIMIT}).`);
    }
    const responseBody = output || (toolCalls.length > 0 ? outputForToolCalls(toolCalls) : "");
    yield {
      type: "done",
      response: {
        message: { role: "assistant", content: responseBody },
        toolCalls: toolCalls.length ? toolCalls : undefined,
        usage: { ...usage, totalTokens },
        durationMs: Date.now() - start,
        costUsd: 0,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new StepTimeoutError("gemini", Date.now() - start);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const geminiProvider: StepProvider = {
  name: "gemini",
  run(prompt, options = {}) {
    return runGeminiStep(prompt, options);
  },
  runRequest(request, options = {}) {
    return runGeminiRequest(request, options);
  },
  runStream(request, options = {}) {
    return runGeminiStream(request, options);
  },
};
