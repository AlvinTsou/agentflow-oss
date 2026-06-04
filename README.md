# agentflow-oss

[![CI](https://github.com/AlvinTsou/agentflow-oss/actions/workflows/ci.yml/badge.svg)](https://github.com/AlvinTsou/agentflow-oss/actions/workflows/ci.yml)

**Maintainer workflow engine for repeatable AI-assisted coding.**

agentflow-oss gives maintainers a structured sprint engine that orchestrates
AI model calls through review gates, readiness checks, and carry-over controls.
Every sprint follows a recipe -- a sequence of produce/review/fix steps -- and
every AI output is gated before it advances. Secrets stay local, model calls go
through a policy layer, and nothing ships without passing the readiness
pipeline.

This is not a universal AI proxy or chat wrapper. It is a workflow engine
designed for maintainers who need repeatable, auditable, policy-controlled
AI-assisted development.

## Key Properties

- **Secrets stay local.** API keys and tokens never leave your machine.
  The policy layer redacts sensitive content before model calls.
- **Review gates.** Every step output goes through a quality loop
  (produce, review, fix) with configurable score thresholds.
- **Readiness checks.** After a sprint completes, review and wrap artifacts
  are parsed for carry-overs (blocking, deferred, nit), producing a
  readiness report that determines whether the sprint output is shippable.
- **Provider routing.** Route model calls to Claude, Codex, OpenAI-compatible
  endpoints, OpenRouter, or Gemini -- per-step or per-iteration.
- **Sprint state.** Full state persistence via `state.json` and `events.jsonl`,
  with git-checkpoint support for per-step tagged commits.

## Quick Start

```bash
# Install dependencies
pnpm install

# Verify the core engine without model API keys
pnpm test

# Create a problem brief for a no-model sprint skeleton
cat > INPUT.md << 'EOF'
Design a tiny rate limiter middleware for a TypeScript HTTP API.
EOF

# Initialize an SDD sprint without invoking any provider
pnpm ag init sdd --input INPUT.md --prefix hello

# Start it later when your provider credentials are configured
pnpm ag run sprints/<printed-sprint-id>
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `pnpm ag init <recipe> --input <file>` | Create a sprint skeleton without model calls |
| `pnpm ag run <recipe> --input <file>` | Create and immediately run a new sprint |
| `pnpm ag run <sprintDir>` | Start an initialized sprint |
| `pnpm ag resume <sprintDir>` | Resume a paused or failed sprint |
| `pnpm ag status <sprintDir>` | Show sprint status and progress |
| `pnpm ag replay <sprintDir>` | Replay a sprint event log for inspection |
| `pnpm ag approve <sprintDir> --step <name>` | Record maintainer approval |
| `pnpm ag request-changes <sprintDir> --step <name> --message <msg>` | Record blocking feedback |
| `pnpm ag force-pass <sprintDir> --step <name>` | Supersede an open request-changes gate |
| `pnpm ag resolve <sprintDir> --id <feedback-id>` | Mark a feedback record resolved |

## Recipes

agentflow-oss ships with three built-in recipes:

| Recipe | Steps | Purpose |
|--------|-------|---------|
| **mini** | 4 | Self-test recipe for verifying installation and provider connectivity |
| **research** | 6 | Structured research report with source gathering, analysis, and synthesis |
| **sdd** | 9 | Spec-driven development: from problem brief through design, implementation, review, and wrap-up |

Recipes are defined as directories under `recipes/`. Each recipe specifies its
steps, quality thresholds, provider preferences, and artifact contracts.

## Provider Support

| Provider | Requirement |
|----------|-------------|
| **claude** | `ANTHROPIC_API_KEY` environment variable |
| **codex** | `OPENAI_API_KEY` environment variable; Codex CLI installed |
| **openai-compatible** | `OPENAI_API_KEY` and `OPENAI_BASE_URL` environment variables |
| **openrouter** | `OPENROUTER_API_KEY` environment variable |
| **gemini** | `GEMINI_API_KEY` environment variable |

The Middleman abstraction routes requests to the configured provider, applies
policy checks (secret redaction, token estimation), and returns structured
responses. See [docs/provider-routing.md](docs/provider-routing.md) for details.

## Configuration

Sprint behavior is controlled by `agentflow.config.json` inside each sprint
directory:

```jsonc
{
  "recipe": "sdd",
  "language": "TypeScript",
  "gate": { "defaultMode": "auto" },
  "steps": {
    "review": {
      "provider": "codex",
      "targetScore": 7
    }
  }
}
```

See [docs/maintainer-workflows.md](docs/maintainer-workflows.md) for the full
configuration reference.

## Documentation

- [Architecture Overview](docs/architecture.md)
- [Maintainer Workflows](docs/maintainer-workflows.md)
- [Provider Routing](docs/provider-routing.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Roadmap](ROADMAP.md)

## License

Apache-2.0. See [LICENSE](LICENSE) for the full text.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
before submitting a pull request.
