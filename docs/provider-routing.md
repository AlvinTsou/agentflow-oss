# Provider Routing

This document explains how agentflow-oss routes model requests to providers,
what policy checks are applied, and how to configure provider selection at
different levels.

## Supported Providers

### Claude

- **Identifier:** `claude`
- **Requirement:** `ANTHROPIC_API_KEY` environment variable
- **API:** Anthropic Messages API
- **Notes:** Default provider for most recipes. Supports long context and
  structured output.

### Codex

- **Identifier:** `codex`
- **Requirement:** `OPENAI_API_KEY` environment variable; Codex CLI installed
- **API:** OpenAI Completions API via Codex CLI
- **Notes:** Used when reasoning-heavy code generation is needed. The
  Middleman detects when Codex reasoning is appropriate based on step
  metadata.

### OpenAI-Compatible

- **Identifier:** `openai-compatible`
- **Requirement:** `OPENAI_API_KEY` and `OPENAI_BASE_URL` environment variables
- **API:** Any endpoint implementing the OpenAI Chat Completions API
- **Notes:** Use this for self-hosted models (vLLM, Ollama with OpenAI
  compatibility, etc.) or third-party services that expose an
  OpenAI-compatible interface. The `OPENAI_BASE_URL` must point to the
  base URL of the API (e.g., `http://localhost:8080/v1`).

### OpenRouter

- **Identifier:** `openrouter`
- **Requirement:** `OPENROUTER_API_KEY` environment variable
- **API:** OpenRouter unified API
- **Notes:** Routes through OpenRouter's model marketplace. Model selection
  is specified in the provider configuration (e.g.,
  `anthropic/claude-sonnet-4-20250514`).

### Gemini

- **Identifier:** `gemini`
- **Requirement:** `GEMINI_API_KEY` environment variable
- **API:** Google Gemini API
- **Notes:** Supports Gemini model family. The `gemini-oauth` and
  `antigravity` variants are deferred to a future release.

## Routing Logic

When the workflow engine needs to make a model call, the Middleman resolves
the provider using the following priority chain:

```
1. Explicit provider on the step definition
   |
   v  (not set?)
2. Per-iteration provider override (forEach steps)
   |
   v  (not set?)
3. INPUT.md frontmatter provider field
   |
   v  (not set?)
4. agentflow.config.json defaultProvider
   |
   v  (not set?)
5. openai-compatible (if OPENAI_BASE_URL is set)
   |
   v  (not set?)
6. codex (if step metadata suggests reasoning-heavy work)
   |
   v  (not set?)
7. Built-in default (claude)
```

### Step-Level Override

In a recipe step definition, you can explicitly set the provider:

```json
{
  "name": "03-design",
  "role": "produce",
  "provider": "claude",
  "prompt": "Design the system architecture..."
}
```

This overrides all other provider settings for this step.

### Per-Iteration Override

For `forEach` steps that fan out over a list of items, each iteration can
specify its own provider:

```json
{
  "name": "04-implement",
  "role": "produce",
  "forEach": {
    "items": "{{design.components}}",
    "provider": "codex"
  }
}
```

### Review Provider

Review steps use a separate provider resolution chain. The review provider
is determined by:

1. Explicit `reviewProvider` on the step definition.
2. `reviewProvider` in INPUT.md frontmatter.
3. `reviewProvider` in `agentflow.config.json`.
4. Falls back to the produce provider.

Using a different model for review than for production helps avoid
self-review bias.

## Policy Layer

Every model call passes through the Middleman policy layer before reaching
the provider. The policy layer applies two checks:

### Secret Redaction

Before a prompt is sent to any provider, the policy layer scans the prompt
text for patterns matching known secret formats:

| Pattern | Example |
|---------|---------|
| API key prefixes | `sk-...`, `key-...`, `AKIA...` |
| Bearer tokens | `Bearer eyJ...` |
| Connection strings | `postgres://user:pass@...` |
| Private keys | `-----BEGIN RSA PRIVATE KEY-----` |
| Generic secrets | Values matching `[A-Za-z0-9+/]{40,}` in suspicious contexts |

Detected secrets are replaced with `[REDACTED]` before the prompt is sent.
A warning is logged when redaction occurs.

This is a defense-in-depth measure. Prompts should not contain secrets, but
the policy layer ensures that accidental inclusion does not result in secret
leakage to model providers.

### Token Estimation

Before dispatching a request, the policy layer estimates the token count of
the prompt to:

- **Warn** if the prompt is approaching the model's context window limit.
- **Reject** if the prompt exceeds the model's maximum context length,
  preventing wasted API calls and unclear error messages.

Token estimation uses a fast heuristic (character-based approximation) rather
than a full tokenizer, so estimates are conservative.

## Per-Step and Per-Iteration Provider Overrides

### Per-Step Override

Set the `provider` field on any step in the recipe definition:

```json
{
  "steps": [
    {
      "name": "01-research",
      "role": "produce",
      "provider": "gemini",
      "prompt": "Research the following topic..."
    },
    {
      "name": "02-analyze",
      "role": "produce",
      "provider": "claude",
      "prompt": "Analyze the research findings..."
    }
  ]
}
```

This is useful when different steps benefit from different model strengths
(e.g., Gemini for broad research, Claude for detailed analysis).

### Per-Iteration Override

For `forEach` steps, the iteration-level provider lets you route individual
items to different models:

```json
{
  "name": "04-implement",
  "role": "produce",
  "forEach": {
    "items": "{{design.components}}",
    "iterationOverrides": {
      "auth-module": { "provider": "codex" },
      "api-gateway": { "provider": "claude" }
    }
  }
}
```

Items not listed in `iterationOverrides` use the step-level or default
provider.

## Review Fallback Chain

When a review step fails to produce a valid score (due to provider error,
malformed response, or timeout), the engine applies a fallback chain before
giving up:

```
1. Retry with the configured review provider (up to 2 retries)
   |
   v  (still failing?)
2. Fall back to the default provider
   |
   v  (still failing?)
3. Fall back to a different available provider
   |
   v  (still failing?)
4. Mark the step as needing human review (ag approve / ag force-pass)
```

The fallback chain ensures that a single provider outage does not
permanently block a sprint. The engine logs each fallback attempt in
`events.jsonl` for transparency.

## Provider Configuration

Provider-specific settings are configured in `agentflow.config.json`:

```jsonc
{
  "providers": {
    "claude": {
      "model": "claude-sonnet-4-20250514",
      "maxTokens": 8192
    },
    "gemini": {
      "model": "gemini-2.5-pro",
      "maxTokens": 8192
    },
    "openai-compatible": {
      "baseUrl": "http://localhost:8080/v1",
      "model": "llama-3-70b",
      "maxTokens": 4096
    },
    "openrouter": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "maxTokens": 8192
    },
    "codex": {
      "model": "codex-mini-latest",
      "maxTokens": 16384
    }
  }
}
```

### Common Settings

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Model identifier for the provider |
| `maxTokens` | number | Maximum tokens in the completion response |
| `baseUrl` | string | API base URL (openai-compatible only) |

## Troubleshooting

### Provider Not Available

```
Error: Provider "claude" is not available. ANTHROPIC_API_KEY is not set.
```

Ensure the required environment variable is set. See the table in
[Supported Providers](#supported-providers).

### Token Limit Exceeded

```
Warning: Prompt exceeds estimated token limit for model "gemini-2.5-pro".
```

The prompt is too long for the selected model. Consider:

- Using a model with a larger context window.
- Reducing the amount of prior-step context included in the prompt.
- Splitting the step into smaller sub-steps.

### Review Score Parsing Failed

```
Warning: Could not parse review score from provider response. Retrying...
```

The review provider returned a response that the score parser could not
interpret. This triggers the review fallback chain. If it persists, check
that the review provider is returning structured output.
