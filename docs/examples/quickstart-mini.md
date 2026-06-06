# Mini Recipe Quickstart Guide

This guide provides a walk-through of initializing and running the built-in `mini` (MoneyFormatter) self-test recipe. The `mini` recipe is a lightweight 4-step workflow designed to validate the AgentFlow engine end-to-end while consuming minimal tokens.

---

## 1. Quickstart Run

To initialize and run a new `mini` sprint in a single command, run:

```bash
pnpm ag run mini --prefix mini-formatter
```

This creates a new sprint directory under `sprints/mini-formatter-<timestamp>` and begins execution immediately.

### Alternative: Initialize, Review, and Run

If you want to review the configuration before launching the LLM providers:

```bash
# 1. Initialize the sprint
pnpm ag init mini --prefix mini-formatter

# 2. (Optional) Inspect or modify the config file
cat sprints/mini-formatter-<timestamp>/agentflow.config.json

# 3. Start execution
pnpm ag run sprints/mini-formatter-<timestamp>
```

---

## 2. Walkthrough of the 4 Steps

The recipe designs and implements the `MoneyFormatter` TypeScript module.

### Step 1: `spec`
*   **Goal:** Generate a Markdown specification for `MoneyFormatter`, containing signatures, examples, and edge cases (NaN, Infinity) for four functions: `formatMoney`, `parseMoney`, `roundMoney`, and `abbreviateMoney`.
*   **Outputs:** `sprints/<sprint-id>/artifacts/spec.md`
*   **Quality Gate:** Reviewer evaluates C1-C4 (all 4 functions present, valid TS signatures, edge cases). Target score: `9/10`.

### Step 2: `usage`
*   **Goal:** Provide concrete usage scenarios and expected exact outputs for each of the four functions.
*   **Outputs:** `sprints/<sprint-id>/artifacts/usage.md`
*   **Quality Gate:** Reviewer checks if scenarios are concrete and outputs are exact. Target score: `9/10`.

### Step 3: `tkt`
*   **Goal:** Decompose the spec and usage requirements into exactly four atomic developer tickets (`T1` to `T4`), one per function.
*   **Outputs:** `sprints/<sprint-id>/artifacts/tkt.md`
*   **Quality Gate:** Reviewer ensures lossless decomposition referencing spec and usage. Target score: `9/10`.

### Step 4: `dev`
*   **Goal:** Implement the code for ticket `T1` (`formatMoney` function).
*   **Outputs:** Creates `sprints/<sprint-id>/artifacts/dev.md` (or inline file).
*   **Quality Gate:** Reviewer checks signature match, ticket requirement satisfaction, and code quality. Target score: `9/10`.

---

## 3. Monitoring Sprint State

While the sprint executes, the engine tracks progress in two local state files inside the sprint directory.

### Active State: `state.json`
Keeps a JSON snapshot of the current run index, completed steps, and any failure indicators.
```json
{
  "recipeName": "mini-money-formatter",
  "sprintId": "mini-formatter-20260606-120000",
  "currentStepIdx": 4,
  "completedSteps": ["spec", "usage", "tkt", "dev"],
  "startedAt": "2026-06-06T12:00:00.000Z",
  "lastEventTs": "2026-06-06T12:01:30.000Z"
}
```

### Event Log: `events.jsonl`
Appends JSON lines auditing every transition, attempt, token usage, cost, and route decisions:
```json
{"ts":"2026-06-06T12:00:01.000Z","type":"sprint-started","msg":"Starting sprint mini-formatter-20260606-120000"}
{"ts":"2026-06-06T12:00:05.000Z","type":"step-started","step":"spec"}
{"ts":"2026-06-06T12:00:15.000Z","type":"step-passed","step":"spec","attempt":1,"score":9,"tokens":1250,"costUsd":0.00375}
```

Use these CLI tools to query state:
```bash
# Print general status and token costs
pnpm ag status sprints/<sprint-id>

# Replay all events logged in events.jsonl
pnpm ag replay sprints/<sprint-id>
```

---

## 4. Git Checkpoints

AgentFlow initializes the sprint directory as a local Git repository and records checkpoints as git tags for rollback support:

```bash
$ git log --oneline
* 7d3e2b1 (tag: sprint-done-mini-formatter-20260606-120000) docs: finalize sprint wrap-up
* a4f2c10 (tag: step-passed/3-dev-mini-formatter-20260606-120000) feat: implement formatMoney
* b8e7d2f (tag: step-passed/2-tkt-mini-formatter-20260606-120000) docs: split money formatter tickets
* c6d5e4a (tag: step-passed/1-usage-mini-formatter-20260606-120000) docs: define money formatter usage
* f1e2d3c (tag: step-passed/0-spec-mini-formatter-20260606-120000) docs: specify money formatter functions
* 9c8b7a6 (tag: sprint-init-mini-formatter-20260606-120000) init: prepare sprint directory
```

If a step fails or is manually rejected, the engine runs `git reset --hard` to rollback to the last tag before retrying, ensuring context hygiene.
