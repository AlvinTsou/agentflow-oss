# Middleman Expansion Design

This document details the design and implementation of the expanded Middleman routing and policy layer in `agentflow-oss`.

## Mental Model

The Middleman is the provider-neutral routing and policy execution layer within `agentflow-oss`. It ensures that workflow steps can route requests to different LLM providers using standard formats, while enforcing local capability constraints and safety policies before any network dispatch.

## Features Shipped

### 1. Provider Capability Registry

To ensure robust routing and early failure feedback, we introduced a declarative capability registry in `src/middleman/capabilities.ts`.

It tracks the following capabilities across providers:
- `streaming`
- `tool-calls`
- `json-response`
- `smoke-test`
- `token-limits`
- `timeout`
- `openai-compatible`
- `reasoning-effort`

#### Capability Matrix

| Provider | streaming | tool-calls | json-response | smoke-test | token-limits | timeout | openai-compatible | reasoning-effort |
|---|---|---|---|---|---|---|---|---|
| `claude` | Yes | Yes | No | No | Yes | Yes | No | No |
| `codex` | No | No | No | No | Yes | Yes | No | Yes |
| `openai-compatible` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No |
| `openrouter` | Yes | Yes | Yes | No | Yes | Yes | Yes | No |
| `gemini` | Yes | Yes | Yes | No | Yes | Yes | No | No |

### 2. Capability Validation and Route Metadata

Before dispatching a request to a provider, the Middleman computes the required capabilities (e.g., if tools are present, it requires `tool-calls`).
- If a required capability is missing, the Middleman throws an error immediately, preventing wasteful network calls.
- If `streaming` is requested but unsupported by the provider, the Middleman automatically falls back to a non-streaming query and attaches a warning in the route decision.

Each execution step returns a `StepResult` populated with `route` decision metadata:
- `provider`: The selected provider.
- `model`: The model used.
- `reason`: Why the route was selected (e.g., `explicit-provider`, `default-provider`).
- `warnings`: Any warning messages (e.g., fallback warnings).
- `policyProfile`: The active security profile.

### 3. Security Profiles & Route Audit

We introduced named security profiles to `src/middleman/policy.ts` to govern prompt scanner behavior:
- `default`: Redacts API keys, private keys, and bearer tokens.
- `strict`: Rejects and blocks requests if any secret-looking patterns are detected.
- `off`: Disables scanning entirely.

Decisions, model options, and warnings are logged to the sprint event log (`events.jsonl`) under the `phase` event, providing a clear audit trail for compliance and debugging.

## Deferred Work (Out of Scope for Week 1)

- **External Proxy Layer**: Serving Middleman as a standalone HTTP proxy server for arbitrary external coding clients is deferred.
- **Web Control Plane**: Integrating the Middleman routing rules with a browser-based dashboard is deferred.
