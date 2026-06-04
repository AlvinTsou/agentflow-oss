# Maintainer Workflows

This guide shows the supported CLI-first workflow for creating sprints,
running recipes, reviewing output, and carrying feedback into follow-up runs.

## Create a Sprint

For `sdd` and `research`, start with a Markdown brief. The CLI copies it into
the sprint directory as `INPUT.md`.

```bash
cat > INPUT.md << 'EOF'
Design a tiny rate limiter middleware for a TypeScript HTTP API.

Requirements:
- Limit requests per client key.
- Return 429 with a retry hint.
- Keep the implementation testable.
EOF
```

Initialize a sprint without invoking any model provider:

```bash
pnpm ag init sdd --input INPUT.md --prefix rate-limit
```

The command prints the created sprint directory, usually under `sprints/`.
Review or edit the generated `agentflow.config.json`, then start execution:

```bash
pnpm ag run sprints/<sprint-id>
```

You can also create and run in one command when credentials are configured:

```bash
pnpm ag run sdd --input INPUT.md --prefix rate-limit
```

## Monitor Progress

```bash
pnpm ag status sprints/<sprint-id>
pnpm ag replay sprints/<sprint-id>
cat sprints/<sprint-id>/events.jsonl | jq .
```

The status and event log expose current step, completed steps, scores, token
usage, readiness state, and latest git checkpoint tags.

## Review Output

Feedback records live in `sprints/<sprint-id>/.agentflow-feedback/`.
The engine injects open feedback into the relevant step's next prompt and
rubric, then blocks passing while unresolved `request-changes` records remain.

Approve a step:

```bash
pnpm ag approve sprints/<sprint-id> --step <step-name> --note "Looks good"
```

Request changes:

```bash
pnpm ag request-changes sprints/<sprint-id> \
  --step <step-name> \
  --message "Tighten the error-handling section before this advances."
```

Target one `forEach` iteration:

```bash
pnpm ag request-changes sprints/<sprint-id> \
  --step investigate \
  --iter Q2 \
  --message "This sub-question needs a stronger source trail."
```

Supersede an open request-changes record after human review:

```bash
pnpm ag force-pass sprints/<sprint-id> \
  --step <step-name> \
  --note "Accepted by maintainer after manual review"
```

Resolve a feedback record:

```bash
pnpm ag resolve sprints/<sprint-id> --id <feedback-id>
```

## Resume After Failure

If a run fails due to a provider error, timeout, open request-changes record, or
max-repeat decision, resume from the sprint directory:

```bash
pnpm ag resume sprints/<sprint-id>
```

If the engine code changed between failure and resume, preserve the local
sprint checkpoint by skipping reset:

```bash
pnpm ag resume sprints/<sprint-id> --no-reset
```

For a failed `forEach` iteration:

```bash
pnpm ag resume sprints/<sprint-id> --step <step-index> --iter <iter-id> --no-reset
```

## Readiness

After all recipe steps complete, the readiness pipeline parses review and wrap
artifacts for carry-overs:

- `blocking`: sprint is not ready.
- `deferred`: accepted follow-up.
- `nit`: informational.

Use `pnpm ag status sprints/<sprint-id>` to inspect readiness, review verdict,
blocking count, and carry-over summary.

## Configuration

Each sprint owns its `agentflow.config.json`. The generated file documents the
supported keys and can be edited before `pnpm ag run sprints/<sprint-id>`.

Minimal example:

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
  },
  "forEach": {
    "investigate": {
      "pinIters": {
        "Q2": "gemini:gemini-3.1-flash-lite"
      }
    }
  }
}
```

Configuration precedence:

1. Explicit per-step config in `agentflow.config.json`.
2. Recipe defaults.
3. Built-in engine defaults.

## Environment Variables

Provider credentials are read from environment variables and are not written
into state files or artifacts.

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | claude |
| `OPENAI_API_KEY` | codex, openai-compatible |
| `OPENAI_BASE_URL` | openai-compatible |
| `OPENROUTER_API_KEY` | openrouter |
| `GEMINI_API_KEY` | gemini |

Set them in your shell or in a local `.env` file. `.env` files are ignored by
git and should never be committed.
