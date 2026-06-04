import type { MiddlemanMessage, MiddlemanRequest } from "./protocol.js";

export interface SecretFinding {
  kind: string;
  match: string;
  messageIndex: number;
}

export type PromptTransform = (message: MiddlemanMessage) => MiddlemanMessage;

export interface MiddlemanPolicy {
  /** Replace known secret-looking substrings before the request leaves AgentFlow. */
  redactSecrets?: boolean;
  /** Throw when a secret-looking substring is found. Takes precedence over redaction. */
  blockSecrets?: boolean;
  /** Rough heuristic: 1 token ~= 4 characters. */
  maxEstimatedTokens?: number;
  transforms?: PromptTransform[];
}

export class MiddlemanPolicyError extends Error {
  readonly findings: SecretFinding[];

  constructor(message: string, findings: SecretFinding[]) {
    super(message);
    this.name = "MiddlemanPolicyError";
    this.findings = findings;
  }
}

const SECRET_PATTERNS: Array<{ kind: string; regex: RegExp }> = [
  { kind: "anthropic-api-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "openai-api-key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    kind: "private-key-block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
];

export function estimateTokens(request: MiddlemanRequest): number {
  const chars = request.messages.reduce((sum, message) => sum + message.content.length, 0);
  return Math.ceil(chars / 4);
}

export function scanSecrets(request: MiddlemanRequest): SecretFinding[] {
  const findings: SecretFinding[] = [];
  request.messages.forEach((message, messageIndex) => {
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      for (const match of message.content.matchAll(pattern.regex)) {
        findings.push({
          kind: pattern.kind,
          match: match[0],
          messageIndex,
        });
      }
    }
  });
  return findings;
}

export function redactSecretText(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    redacted = redacted.replace(pattern.regex, `[REDACTED:${pattern.kind}]`);
  }
  return redacted;
}

export function applyMiddlemanPolicy(
  request: MiddlemanRequest,
  policy: MiddlemanPolicy = {}
): MiddlemanRequest {
  const findings = scanSecrets(request);
  if (findings.length > 0 && policy.blockSecrets) {
    throw new MiddlemanPolicyError("Middleman policy blocked a request containing secrets.", findings);
  }

  const maxEstimatedTokens = policy.maxEstimatedTokens;
  if (maxEstimatedTokens !== undefined) {
    const estimate = estimateTokens(request);
    if (estimate > maxEstimatedTokens) {
      throw new MiddlemanPolicyError(
        `Middleman policy blocked a request estimated at ${estimate} tokens (> ${maxEstimatedTokens}).`,
        findings
      );
    }
  }

  const transforms = policy.transforms ?? [];
  const messages = request.messages.map((message) => {
    const initial = policy.redactSecrets ? { ...message, content: redactSecretText(message.content) } : message;
    return transforms.reduce((current, transform) => transform(current), initial);
  });

  return { ...request, messages };
}
