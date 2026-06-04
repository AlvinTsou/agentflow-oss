# CLI Command Reference

This document provides a detailed reference for all commands and options available in the `agentflow-oss` CLI.

## Usage Overview

```bash
pnpm ag <command> [...options]
```

---

## Commands

### `init`
Initialize a new sprint skeleton without invoking any provider.

- **Usage**: `pnpm ag init <recipe> [...options]`
- **Supported Recipes**: `mini`, `sdd`, `research`
- **Options**:
  - `--input <file>`: Path to the input markdown file containing the problem brief or task description.
  - `--prefix <prefix>`: Prefix name for the generated sprint directory.
  - `--gate <mode>`: Quality gate mode (e.g., `auto`, `manual`).
  - `--language <name>`: Programming language context (e.g., `TypeScript`).
  - `--lite-preset`: Use a lightweight configuration for testing or quick execution.

### `run`
Create and immediately execute a new sprint, or start an initialized sprint from step 0.

- **Usage**:
  - Run a recipe: `pnpm ag run <recipe> [...options]`
  - Run an initialized sprint: `pnpm ag run <sprintDir>`
- **Options**:
  - Same as `init` options when running a new recipe.

### `resume`
Resume a paused or failed sprint from where it left off.

- **Usage**: `pnpm ag resume <sprintDir> [...options]`
- **Options**:
  - `--step <idx>`: Resume specifically from a 0-indexed step index.
  - `--iter <id>`: Resume from a specific iteration.
  - `--recipe <name>`: Override the recipe for the sprint.
  - `--no-reset`: Do not reset the current step's attempts.
  - `--language <name>`: Override the target language context.

### `status`
Display a read-only snapshot of the sprint's progress.

- **Usage**: `pnpm ag status <sprintDir>`
- **Output Includes**:
  - Run phase
  - Current executing step
  - Step scores
  - Accumulated API costs
  - Latest git checkpoint tag

### `replay`
Render the event log (`events.jsonl`) for inspection without making any API calls.

- **Usage**: `pnpm ag replay <sprintDir>`

### `approve`
Record maintainer approval for a specific step.

- **Usage**: `pnpm ag approve <sprintDir> --step <name> [--note <msg>]`
- **Example**:
  ```bash
  pnpm ag approve sprints/rate-limit-sprint --step implementation --note "Looks solid"
  ```
- **Behavior**: Writes an approval record to `.agentflow-feedback/feedback.jsonl`.

### `request-changes`
Record blocking feedback for a step.

- **Usage**: `pnpm ag request-changes <sprintDir> --step <name> --message <msg>`
- **Example**:
  ```bash
  pnpm ag request-changes sprints/rate-limit-sprint --step implementation --message "Add unit tests for the limiter reset interval."
  ```
- **Behavior**: Writes a `request-changes` record to `.agentflow-feedback/feedback.jsonl` that halts the readiness pipeline.

### `force-pass`
Supersede an open `request-changes` gate and record approval.

- **Usage**: `pnpm ag force-pass <sprintDir> --step <name> [--note <msg>]`
- **Example**:
  ```bash
  pnpm ag force-pass sprints/rate-limit-sprint --step implementation --note "Bypass for hotfix testing"
  ```
- **Behavior**: Overrides previous blocking feedback.

### `resolve`
Mark a feedback record as resolved to close open `request-changes` blocks.

- **Usage**: `pnpm ag resolve <sprintDir> --id <feedback-id>`
- **Example**:
  ```bash
  pnpm ag resolve sprints/rate-limit-sprint --id fb_a1b2c3d4
  ```
- **Behavior**: Stamps `resolvedAt` on the matching feedback row in `feedback.jsonl`.

### `smoke-test`
Run a pre-flight gateway smoke test to verify connectivity and credential validity before launching a full sprint.

- **Usage**: `pnpm ag smoke-test <provider> [...options]`
- **Supported Providers**: `openai-compatible`, `claude`, `gemini`, `openrouter`, `codex`
- **Options**:
  - `--baseUrl <url>`: Base URL for the gateway endpoint (e.g. `https://api.openai.com/v1`).
  - `--apiKey <key>`: The API credential key string.
  - `--apiKeyEnv <name>`: Environment variable name holding the API key (e.g. `MY_OPENAI_KEY`).
  - `--model <name>`: The model identifier to test (required for `openai-compatible`).
  - `--timeoutMs <ms>`: Connect and request timeout threshold in milliseconds (default: `5000`).
- **Examples**:
  ```bash
  # Test an OpenAI-compatible endpoint with explicit API key and model
  pnpm ag smoke-test openai-compatible \
    --baseUrl http://127.0.0.1:8080/v1 \
    --apiKey my-secret-token \
    --model gpt-4o-mini
  ```

For a full walkthrough of how these commands interact in a real sprint, see [Feedback Commands Guide](examples/feedback-commands.md).
