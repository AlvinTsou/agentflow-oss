import type { MiddlemanMessage, MiddlemanRequest } from "./protocol.js";

export interface SecretFinding {
  kind: string;
  match: string;
  messageIndex: number;
}

export type PromptTransform = (message: MiddlemanMessage) => MiddlemanMessage;

export type SecurityProfile = "default" | "strict" | "off";

export interface MiddlemanPolicy {
  profile?: SecurityProfile;
  /** Replace known secret-looking substrings before the request leaves AgentFlow. */
  redactSecrets?: boolean;
  /** Throw when a secret-looking substring is found. Takes precedence over redaction. */
  blockSecrets?: boolean;
  /** Rough heuristic: 1 token ~= 4 characters. */
  maxEstimatedTokens?: number;
  transforms?: PromptTransform[];
  customRedactions?: Array<{
    kind: string;
    pattern: string;
    replacement?: string;
  }>;
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

export function scanSecrets(request: MiddlemanRequest, policy?: MiddlemanPolicy): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const patterns = [...SECRET_PATTERNS];

  if (policy?.profile !== "off" && policy?.customRedactions) {
    for (const custom of policy.customRedactions) {
      try {
        const regex = new RegExp(custom.pattern, "g");
        patterns.push({ kind: custom.kind, regex });
      } catch {
        // Compile custom patterns safely: ignore malformed patterns
      }
    }
  }

  request.messages.forEach((message, messageIndex) => {
    for (const pattern of patterns) {
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

export function redactSecretText(text: string, policy?: MiddlemanPolicy): string {
  let redacted = text;

  // Apply standard redactions
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    redacted = redacted.replace(pattern.regex, `[REDACTED:${pattern.kind}]`);
  }

  // Apply custom redactions
  if (policy?.profile !== "off" && policy?.customRedactions) {
    for (const custom of policy.customRedactions) {
      try {
        const regex = new RegExp(custom.pattern, "g");
        const replacement = custom.replacement ?? `[REDACTED:${custom.kind}]`;
        regex.lastIndex = 0;
        redacted = redacted.replace(regex, replacement);
      } catch {
        // Compile custom patterns safely: ignore malformed patterns
      }
    }
  }

  return redacted;
}

export function applyMiddlemanPolicy(
  request: MiddlemanRequest,
  policy: MiddlemanPolicy = {}
): MiddlemanRequest {
  let redact = policy.redactSecrets;
  let block = policy.blockSecrets;

  const profile = policy.profile ?? "default";
  if (profile === "strict") {
    block = block ?? true;
    redact = redact ?? false;
  } else if (profile === "off") {
    block = block ?? false;
    redact = redact ?? false;
  } else { // default
    block = block ?? false;
    redact = redact ?? true;
  }

  const findings = scanSecrets(request, policy);
  if (findings.length > 0 && block) {
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
    const initial = redact ? { ...message, content: redactSecretText(message.content, policy) } : message;
    return transforms.reduce((current, transform) => transform(current), initial);
  });

  return { ...request, messages };
}
