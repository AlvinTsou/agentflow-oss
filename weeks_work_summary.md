# Weekly Work Summary

Date: 2026-06-18
Repository: `agentflow-oss`

## Current Repo State

- Branch: `main`
- Baseline before this documentation refresh: clean working tree.
- HEAD: `64cea4c` (`feat(workflow): implement loop engineering phase a features and add tests`).
- Public Pages: `https://alvintsou.github.io/agentflow-oss/` returns `HTTP/2 200`.
- Latest remote CI runs on `main`: green.

## Verification Completed

Commands run successfully:

```bash
pnpm run test
git diff --check
```

Validation details:

- TypeScript build passed through `pnpm run build` (tsc --noEmit).
- All offline test suites passed: 13 test files, 13 passing test runs, 0 failures.
- Secret and privacy scan passed with no findings.
- Whitespace validation (`git diff --check`) passed.

## Work Completed This Week

### Day 3 - Security Review Hardening

- Added mixed security review fixtures under `tests/fixtures/security-review/`:
  - `auth-plus-logging`: modified `server.ts` to log password unsafely and miss authorization checks.
  - `dependency-plus-config`: added dependency in `package.json` and changed retry limits in `config.json`.
  - `clean-sensitive-name`: clean helper function inside an `auth-service.ts` file.
- Resolved TypeScript compiler issue (unused `req` parameter) inside the `auth-plus-logging` fixture to ensure clean compilation.
- Hardened the `tests/poc-security-review.ts` offline test suite to run these new scenarios, verifying verdict outcomes (`PASS`, `PASS WITH FOLLOW-UP`, and `BLOCK`).

### Day 4 - CLI And Docs Polish

- Aligned `docs/recipes/security-review.md` and CLI initialization.
- Modified `ag-init.ts` to relax the `--input`/`--problem` requirement for recipes that do not require a user-provided text brief (specifically `security-review`, `pr-review`, and `release-readiness`), as they operate purely on the git diff/repository state.
- Aligned `ag.ts` by separating `INIT_RECIPES` and `RUN_RECIPES` to match the exact list of supported recipes in `ag-init.ts`, correcting the CLI `--help` text.

### Day 5/6 - Next Recipe Proposal (API Design Review)

- Drafted the proposal in `docs/proposals/api-design-review-recipe.md`, detailing scope, non-goals, and proposed steps (`map-api-changes`, `audit-api-standards`, `generate-api-verdict`).
- Created offline validation fixtures under `tests/fixtures/api-design-review/`:
  - `clean-rest-api`
  - `breaking-change`
  - `non-standard-naming`
- Held off wiring the recipe into the engine/registry to strictly follow the schedule: "proposal first, do not rush implementation".

### Day 7 - Weekly Closeout

- Aligned `ROADMAP.md` (v1.4 Security Review completed, Future Additional Recipes including API design review).
- Synchronized `docs/cli-reference.md` command documentation.
- Confirmed code compilation and full offline/secret test suite pass.

## Loop Engineering Integration Plan

Based on the [loop-engineering-analysis.md](resource/loop-engineering-analysis.md) gap
analysis, the following improvements are prioritized to absorb Loop Engineering's
autonomy concepts while preserving AgentFlow's engineering rigor.

### Phase A — High-Value, Low-Risk (Target: next 2 weeks)

| ID | Feature | Gap Size | Effort | Key Files |
|----|---------|----------|--------|-----------|
| A-1 | Event-Driven Trigger Layer | **Large** | ~3 days | `src/workflow/trigger-registry.ts` [NEW], `ag-daemon.ts` [NEW], `ag.ts` |
| A-2 | Sprint Outcome Index | **Moderate** | ~2 days | `src/workflow/sprint-index.ts` [NEW], `sprint-engine.ts`, `readiness.ts` |
| A-3 | Conditional Step Activation | **Moderate** | ~0.5 day | `src/recipe/types.ts`, `sprint-engine.ts`, `ag-replay.ts` |
| A-4 | Parallel forEach Execution | **Moderate** | ~3 days | `src/recipe/types.ts`, `sprint-engine.ts`, `src/util/semaphore.ts` [NEW] |

### Phase B — Medium-Value, Medium-Risk (Target: week 3-4)

| ID | Feature | Gap Size | Effort | Key Files |
|----|---------|----------|--------|-----------|
| B-5 | Streaming Checkpoint | **Moderate** | ~2 days | `src/workflow/streaming-checkpoint.ts` [NEW], `quality-loop.ts`, `resume.ts` |
| B-6 | Self-Feeding Loops | **Large** | ~3 days | `src/workflow/replan.ts` [NEW], `sprint-engine.ts`, `src/recipe/types.ts` |

### Phase C — Low-Priority (Backlog)

| ID | Feature | Gap Size | Effort | Key Files |
|----|---------|----------|--------|-----------|
| C-7 | Eval Regression Suite | **Small** | ~2 days | `tests/eval/` [NEW], `package.json` |
| C-8 | Multi-Model Consensus Voting | **Small** | ~1 day | `quality-loop.ts`, `src/recipe/types.ts` |

### Open Decisions

1. **Trigger scope (A-1):** Start with cron-only or support all three (cron, fs-watch, git-hook) in v1?
2. **Knowledge backend (A-2):** Flat JSONL (consistent with `state.json`) or SQLite for query flexibility?
3. **Concurrency limit (A-4):** Default `maxConcurrent` value — 4 suggested, depends on API rate limits.
4. **Self-feeding budget (B-6):** Hard cap on auto-generated follow-up sprints (e.g., max 3)?

---

## Loop Engineering Phase A Implementation Summary (Completed)

We have successfully designed, implemented, and verified all Phase A items from the Loop Engineering integration plan.

### Day 1 - Publish And Verify
- Verified repository status and checked recent CI runs.

### Day 2 - Maintenance Log + Conditional Steps (A-3)
- Implemented optional step condition check added to `StepDef` in `src/recipe/types.ts`.
- Engine skips step if `condition(ctx)` returns `false`, emitting `"step-condition-skipped"` via `state-store.ts`, and rendering it in `ag-replay.ts` as `"cond-skipped"`.
- Verified in `tests/poc-conditional-step.ts`.

### Day 3 - Sprint Outcome Index (A-2)
- Implemented append-only JSONL outcome indexing in `src/workflow/sprint-index.ts`.
- Integrated into `sprint-engine.ts` finalization block to write to `~/.agentflow/sprint-index.jsonl`.
- Verified in `tests/poc-sprint-index.ts`.

### Day 4/5 - Event-Driven Trigger Layer (A-1) + API Review Wiring
- Implemented background worker daemon runner `ag-daemon.ts` and `src/workflow/trigger-registry.ts`.
- Added support for `"cron"`, `"fs-watch"`, and `"git-hook"` triggers.
- Wired `daemon` subcommand to `ag.ts`.
- Integrated `api-design-review` recipe into `recipes/api-design-review.json` and registered it in `ag-init.ts` and `ag.ts`.
- Verified in `tests/poc-trigger-registry.ts` and `tests/poc-api-design-review.ts`.

### Day 6/7 - Parallel forEach Execution (A-4) + Weekly Closeout
- Created counting `Semaphore` in `src/util/semaphore.ts`.
- Added `maxConcurrent` to `ForEachConfig` in `src/recipe/types.ts`.
- Refactored `forEach` block in `sprint-engine.ts` to support concurrent executions up to `maxConcurrent`, using a state mutex to serialized commits and state updates, preventing Git locking race conditions.
- Created `tests/poc-parallel-foreach.ts` to verify parallel execution and concurrency limit, and integrated it into `package.json` offline test suite.
- Updated `ROADMAP.md` and CLI documentation reference for `daemon` command.
- Verified all 13 test files and secret scan pass.

Validation:

```bash
pnpm run test
git diff --check
```
