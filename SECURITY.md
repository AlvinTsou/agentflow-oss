# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes (current development) |

Once v1.0 is released, this table will be updated to reflect long-term support
commitments.

## Reporting a Vulnerability

If you discover a security vulnerability in agentflow-oss, please report it
responsibly. **Do not open a public GitHub issue.**

1. **Email:** Send a description of the vulnerability to the maintainers at
   the email address listed in the repository's `CODEOWNERS` or primary
   maintainer profile. If no email is listed, open a
   [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories)
   on this repository.

2. **Include:**
   - A description of the vulnerability and its potential impact.
   - Steps to reproduce the issue.
   - Affected versions.
   - Any suggested fix or mitigation, if you have one.

3. **Response timeline:**
   - **Acknowledgment:** Within 3 business days of receipt.
   - **Initial assessment:** Within 7 business days.
   - **Fix or mitigation:** Target within 30 days for critical issues.

## Secret And Credential Handling

agentflow-oss is designed to keep provider credentials out of sprint artifacts,
state files, and logs during normal operation:

- **API keys** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
  `GEMINI_API_KEY`) are read from environment variables or explicit provider
  options and used only as authentication material for outbound model API calls.
  They are not written to state files, artifacts, or logs by agentflow-oss.

- **Policy layer redaction.** Before any prompt is sent to a model provider,
  the Middleman policy layer scans for patterns that match known secret
  formats (API keys, bearer tokens, connection strings, private keys, suspicious
  password/token assignments, and configured custom redaction patterns) and
  redacts them. This is a defense-in-depth measure -- prompts should not contain
  secrets in the first place, but the policy layer acts as a safety net.

- **State files** (`state.json`, `events.jsonl`) contain sprint metadata,
  step results, and quality scores. They do not contain API keys or raw
  model responses that might include reflected secrets.

- **Artifacts and checkpoints** contain model-produced content and short output
  previews. Treat sprint directories as sensitive project data, especially when
  prompts or model responses may reference proprietary code or internal details.

- **Git checkpoints** are local repositories. They are not pushed to any
  remote unless you explicitly configure a remote and push.

- **The secret-scan test** (`pnpm test:secret-scan`) runs as part of the
  test suite and checks committed files for patterns matching API keys,
  tokens, and other sensitive values. This test should be included in CI.

## Security Design Principles

1. **Local-first.** All state, artifacts, and configuration remain on the
   local filesystem unless a configured provider call or webhook explicitly
   sends data out. No telemetry, no cloud sync, no external data stores.

2. **Policy-gated model calls.** Every model call passes through the
   Middleman policy layer, which enforces secret redaction and token
   estimation before the request leaves the machine.

3. **Review gates.** AI-generated output is never automatically accepted.
   Every step goes through the quality loop (produce/review/fix), and
   maintainers can require explicit approval via `ag approve` before
   a step advances.

4. **Readiness checks.** Sprint outputs are subject to readiness analysis
   that flags blocking carry-overs before the work is considered complete.

## Local Management Server

The optional management server is a local dashboard API, not a hosted control
plane.

- It binds to `127.0.0.1` by default. Set `AGENTFLOW_HOST` only when you
  intentionally want a different bind address.
- CORS is restricted to local development origins by default:
  `http://localhost:3000`, `http://127.0.0.1:3000`,
  `http://localhost:5173`, and `http://127.0.0.1:5173`. Override with
  `AGENTFLOW_ALLOWED_ORIGINS` only for trusted origins.
- The server has no built-in authentication. Do not expose it on a public
  network without an external access-control layer.
- Web actions are limited to the supported action names and are appended as
  typed web-originated events in `events.jsonl`.

## Webhook Delivery

Webhook notifications are user-configured outbound HTTP requests. Only configure
trusted webhook URLs, because event payloads may include sprint metadata, route
metadata, token/cost counters, and step status. Webhook failures are logged but
do not block the main sprint runner.

## Disclosure Timeline

When a vulnerability is confirmed:

1. **Day 0:** Vulnerability confirmed internally.
2. **Day 1-7:** Develop and test a fix.
3. **Day 7-14:** Release a patched version.
4. **Day 14-30:** Public disclosure with details of the vulnerability and
   the fix, after affected users have had time to update.

For critical vulnerabilities (remote code execution, secret exfiltration),
we will accelerate this timeline.

## Scope

The following are in scope for security reports:

- Secret leakage through logs, state files, artifacts, or model prompts.
- Unauthorized access to the local management server when it is intentionally
  exposed beyond loopback.
- Unsafe webhook disclosure of sprint metadata to untrusted destinations.
- Arbitrary code execution through crafted recipes or INPUT.md files.
- Path traversal or file-write vulnerabilities in artifact IO.
- Authentication bypass in provider routing.
- Dependency vulnerabilities in direct dependencies.

The following are out of scope:

- Vulnerabilities in upstream model providers (Claude, OpenAI, etc.).
- Social engineering attacks against maintainers.
- Issues requiring physical access to the machine running agentflow-oss.
