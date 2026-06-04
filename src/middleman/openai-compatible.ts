import { DEFAULT_TIMEOUT_MS, TOKEN_LIMIT, type StepResult } from "./claude.js";
import { StepTimeoutError } from "./errors.js";
import type { ProviderRunOptions } from "./provider.js";
import type {
  MiddlemanRequest,
  MiddlemanResponse,
  MiddlemanStreamEvent,
  MiddlemanToolCall,
} from "./protocol.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ChatToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

interface ChatToolCall {
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  error?: {
    message?: string;
  };
}

export async function runOpenAICompatibleStep(
  prompt: string,
  options: ProviderRunOptions = {}
): Promise<StepResult> {
  return runOpenAICompatibleRequest(
    { messages: [{ role: "user", content: prompt }], model: options.model },
    options
  );
}

function openAIHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(extra ?? {}),
  };
}

function resolveOpenAIConfig(request: MiddlemanRequest, options: ProviderRunOptions) {
  const baseUrl = (options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
    .replace(/\/$/, "");
  const apiKey = options.apiKey ?? (options.apiKeyEnv ? process.env[options.apiKeyEnv] : process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("openai-compatible provider requires apiKey, apiKeyEnv, or OPENAI_API_KEY.");
  }
  const model = options.model ?? request.model;
  if (!model) {
    throw new Error("openai-compatible provider requires options.model.");
  }
  return { baseUrl, apiKey, model };
}

function toOpenAITools(request: MiddlemanRequest) {
  if (!request.tools?.length) return undefined;
  return request.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object", additionalProperties: true },
    },
  }));
}

function toOpenAIToolChoice(request: MiddlemanRequest) {
  const choice = request.toolChoice;
  if (!choice) return undefined;
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  return { type: "function", function: { name: choice.name } };
}

function toChatCompletionBody(
  request: MiddlemanRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> {
  return {
    model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
      name: message.name,
      tool_call_id: message.toolCallId,
    })),
    tools: toOpenAITools(request),
    tool_choice: toOpenAIToolChoice(request),
    response_format: request.responseFormat,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  };
}

function convertToolCalls(calls: ChatToolCall[] | undefined): MiddlemanToolCall[] {
  return (calls ?? [])
    .map((call, index) => ({
      id: call.id ?? `tool-${index}`,
      name: call.function?.name ?? "",
      argumentsJson: call.function?.arguments ?? "{}",
    }))
    .filter((call) => call.name.length > 0);
}

function outputForToolCalls(toolCalls: MiddlemanToolCall[]): string {
  return JSON.stringify({ toolCalls });
}

export async function runOpenAICompatibleRequest(
  request: MiddlemanRequest,
  options: ProviderRunOptions = {}
): Promise<StepResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  const { baseUrl, apiKey, model } = resolveOpenAIConfig(request, options);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: openAIHeaders(apiKey, options.extraHeaders),
      body: JSON.stringify(toChatCompletionBody(request, model, false)),
      signal: abortController.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`openai-compatible request failed (${response.status}): ${rawText.slice(0, 800)}`);
    }

    const json = JSON.parse(rawText) as ChatCompletionResponse;
    if (json.error?.message) {
      throw new Error(`openai-compatible provider error: ${json.error.message}`);
    }

    const message = json.choices?.[0]?.message;
    const toolCalls = convertToolCalls(message?.tool_calls);
    const output = message?.content ?? (toolCalls.length > 0 ? outputForToolCalls(toolCalls) : "");
    if (!output) throw new Error("openai-compatible provider returned no assistant content.");

    const inputTokens = json.usage?.prompt_tokens ?? 0;
    const outputTokens = json.usage?.completion_tokens ?? 0;
    const totalTokens = json.usage?.total_tokens ?? inputTokens + outputTokens;
    if (totalTokens > TOKEN_LIMIT) {
      throw new Error(
        `Circuit breaker: openai-compatible step used ${totalTokens} tokens (> ${TOKEN_LIMIT}).`
      );
    }

    return {
      output,
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs: Date.now() - start,
      costUsd: 0,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new StepTimeoutError("openai-compatible", Date.now() - start);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function* runOpenAICompatibleStream(
  request: MiddlemanRequest,
  options: ProviderRunOptions = {}
): AsyncIterable<MiddlemanStreamEvent> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const { baseUrl, apiKey, model } = resolveOpenAIConfig(request, options);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: openAIHeaders(apiKey, options.extraHeaders),
      body: JSON.stringify(toChatCompletionBody(request, model, true)),
      signal: abortController.signal,
    });

    const rawError = response.ok ? "" : await response.text();
    if (!response.ok) {
      throw new Error(`openai-compatible stream failed (${response.status}): ${rawError.slice(0, 800)}`);
    }
    if (!response.body) {
      throw new Error("openai-compatible stream returned no response body.");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let output = "";
    const toolCalls = new Map<number, MiddlemanToolCall>();
    let usage: MiddlemanResponse["usage"] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    const processLine = (line: string): ChatCompletionChunk | "done" | null => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return null;
      const data = trimmed.slice("data:".length).trim();
      if (!data) return null;
      if (data === "[DONE]") return "done";
      return JSON.parse(data) as ChatCompletionChunk;
    };

    let finished = false;
    while (!finished) {
      const read = await reader.read();
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const chunk = processLine(line);
        if (!chunk) continue;
        if (chunk === "done") {
          finished = true;
          break;
        }
        if (chunk.error?.message) throw new Error(`openai-compatible provider error: ${chunk.error.message}`);
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
          yield { type: "usage", usage };
        }
        for (const choice of chunk.choices ?? []) {
          const content = choice.delta?.content ?? "";
          if (content) {
            output += content;
            yield { type: "text-delta", text: content };
          }
          for (const callDelta of choice.delta?.tool_calls ?? []) {
            const index = callDelta.index ?? 0;
            const current = toolCalls.get(index) ?? {
              id: callDelta.id ?? `tool-${index}`,
              name: "",
              argumentsJson: "",
            };
            toolCalls.set(index, {
              id: callDelta.id ?? current.id,
              name: callDelta.function?.name ?? current.name,
              argumentsJson: current.argumentsJson + (callDelta.function?.arguments ?? ""),
            });
          }
        }
      }
    }

    for (const call of toolCalls.values()) {
      if (call.name) yield { type: "tool-call", call };
    }
    const totalTokens = usage.totalTokens || usage.inputTokens + usage.outputTokens;
    if (totalTokens > TOKEN_LIMIT) {
      throw new Error(
        `Circuit breaker: openai-compatible stream used ${totalTokens} tokens (> ${TOKEN_LIMIT}).`
      );
    }
    const finalToolCalls = [...toolCalls.values()].filter((call) => call.name);
    const responseBody = output || (finalToolCalls.length > 0 ? outputForToolCalls(finalToolCalls) : "");
    yield {
      type: "done",
      response: {
        message: { role: "assistant", content: responseBody },
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
        usage: { ...usage, totalTokens },
        durationMs: Date.now() - start,
        costUsd: 0,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new StepTimeoutError("openai-compatible", Date.now() - start);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
