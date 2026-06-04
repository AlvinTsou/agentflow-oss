import type { StepResult } from "./claude.js";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface MiddlemanMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface MiddlemanTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export type MiddlemanToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; name: string };

export interface MiddlemanToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface MiddlemanResponseFormat {
  type: "text" | "json_object";
}

export interface MiddlemanRequest {
  messages: MiddlemanMessage[];
  model?: string;
  tools?: MiddlemanTool[];
  toolChoice?: MiddlemanToolChoice;
  responseFormat?: MiddlemanResponseFormat;
  metadata?: Record<string, unknown>;
}

export interface MiddlemanResponse {
  message: MiddlemanMessage;
  toolCalls?: MiddlemanToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  durationMs: number;
  costUsd: number;
  raw?: unknown;
}

export type MiddlemanStreamEvent =
  | { type: "route"; provider: string; reason: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; call: MiddlemanToolCall }
  | { type: "usage"; usage: MiddlemanResponse["usage"] }
  | { type: "done"; response: MiddlemanResponse };

export function promptToRequest(prompt: string, systemPrompt?: string): MiddlemanRequest {
  const messages: MiddlemanMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  return { messages };
}

export function requestToPrompt(request: MiddlemanRequest): string {
  return request.messages
    .map((message) => {
      const name = message.name ? ` ${message.name}` : "";
      return `# ${message.role.toUpperCase()}${name}\n${message.content}`;
    })
    .join("\n\n");
}

export function stepResultToResponse(result: StepResult): MiddlemanResponse {
  return {
    message: { role: "assistant", content: result.output },
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
    },
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  };
}

export function responseToStepResult(response: MiddlemanResponse): StepResult {
  return {
    output: response.message.content,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    durationMs: response.durationMs,
    costUsd: response.costUsd,
  };
}
