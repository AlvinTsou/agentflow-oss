# Weekly Work Summary

Date: 2026-06-21
Repository: `agentflow-oss`

## Current Repo State

- Branch: `main`
- Baseline before this documentation refresh: clean working tree.
- Latest synchronized commit: `6eb865a` (`feat(workflow): implement loop engineering phase c features and update summary`).
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
- All offline test suites passed: 16 test files, 16 passing test runs, 0 failures.
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

### Day 7 - Weekly Closeout And Correction

- Aligned `ROADMAP.md` with the then-current state: v1.4 Security Review completed and API design review still listed as a future additional recipe.
- Subsequent correction: `api-design-review` is now implemented as an init-supported recipe and recorded as `v1.6 -- API Design Review Workflow (Completed)` in `ROADMAP.md`.
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

### Phase B — Medium-Value, Medium-Risk (Completed)

| ID | Feature | Gap Size | Effort | Key Files |
|----|---------|----------|--------|-----------|
| B-5 | Streaming Checkpoint | **Moderate** | ~2 days | `src/workflow/streaming-checkpoint.ts` [NEW], `quality-loop.ts`, `resume.ts` |
| B-6 | Self-Feeding Loops | **Large** | ~3 days | `src/workflow/replan.ts` [NEW], `sprint-engine.ts`, `src/recipe/types.ts` |

### Phase C — Low-Priority (Completed)

| ID | Feature | Gap Size | Effort | Key Files |
|----|---------|----------|--------|-----------|
| C-7 | Eval Regression Suite | **Small** | ~2 days | `tests/eval/` [NEW], `package.json` |
| C-8 | Multi-Model Consensus Voting | **Small** | ~1 day | `quality-loop.ts`, `src/recipe/types.ts` |

### Resolved Decisions

1. **Trigger scope (A-1):** Support all three (cron, fs-watch, git-hook) in v1.
2. **Knowledge backend (A-2):** Flat JSONL (consistent with `state.json`).
3. **Concurrency limit (A-4):** Default `maxConcurrent` value set to 3.
4. **Self-feeding budget (B-6):** Hard cap on auto-generated follow-up sprints set to 3 (default 3, configurable in `agentflow.config.json` via `selfFeeding.maxFollowUps`).

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

---

## Loop Engineering Phase B Implementation Summary (Completed)

We have successfully designed, implemented, and verified all Phase B items from the Loop Engineering integration plan.

### Streaming Checkpoint (B-5)
- Implemented checkpoint pruning (`truncateStreamingCheckpoints`) and loop history reconstruction (`reconstructHistoryFromCheckpoints`) in `src/workflow/streaming-checkpoint.ts`.
- Integrated checkpoint pruning into `src/workflow/resume.ts` on `resumeSprint` entry.
- Updated `src/workflow/quality-loop.ts` to accept a `seedCheckpoint` option, allowing `qualityLoop` to reconstruct history, best output/score, and resume directly from a checkpointed attempt/phase.
- Wired `sprint-engine.ts` to query and pass `seedCheckpoint` to `qualityLoop` for all step types (parallel forEach, serial forEach, and single-pass steps).
- Verified in `tests/poc-streaming-checkpoint.ts`.

### Self-Feeding Loops (B-6)
- Created new `src/workflow/replan.ts` with `handleReplan` function to generate follow-up sprints with carry-overs injected and stripping old carry-overs.
- Added type definitions for `selfFeeding` options in `src/recipe/types.ts` (`Recipe` interface) and validated/resolved it in `src/workflow/config-loader.ts`.
- Wired `runSprint` in `src/workflow/sprint-engine.ts` to automatically trigger `handleReplan` and recursively call `runSprint` when a sprint is blocked and self-feeding is enabled.
- Created `tests/poc-replan.ts` to verify end-to-end self-feeding loops, and registered it in `package.json`.
- Verified all 14 test files and secret scan pass.

Validation:

```bash
pnpm run test
git diff --check
```

---

## Loop Engineering Phase C Implementation Summary (Completed)

We have successfully designed, implemented, and verified all Phase C items from the Loop Engineering integration plan.

### Eval Regression Suite (C-7)
- Implemented a formal regression evaluation engine in [regression.ts](tests/eval/regression.ts) under the `tests/eval/` directory.
- Defined three key evaluation scenarios: Maker-Checker mini flow, Security review unsafe logging block, and Consensus voting passing validation.
- Integrated the evaluation suite into `package.json` with a dedicated `"test:eval"` script and appended it to the standard `"test"` pipeline execution.

### Multi-Model Consensus Voting (C-8)
- Added `ConsensusVotingConfig` type definitions in [types.ts](src/recipe/types.ts) to define multiple voter configurations and minimum passing threshold `minVotesToPass`.
- Wired `buildConsensusVoters` in [sprint-engine.ts](src/workflow/sprint-engine.ts) to resolve voter providers, run options, and policies.
- Refactored `qualityLoop` in [quality-loop.ts](src/workflow/quality-loop.ts) to execute voter reviews in parallel, compile aggregated vote verdicts, calculate average scores, and format a combined Markdown report.
- Verified the functionality end-to-end with unit test [poc-consensus-voting.ts](tests/poc-consensus-voting.ts) and registered it under `package.json`.

Validation:

```bash
pnpm run test
git diff --check
```

---

## Loop Engineering Long-term Backlog: Webhook Notifications (Completed)

We have successfully implemented, verified, and integrated webhook notifications for engine-level event triggering.

### Webhook Configuration & Types
- Defined `WebhookConfig` interface under [config-loader.ts](src/workflow/config-loader.ts) supporting target `url` and optional `events` filter list.
- Updated `validateConfig` and `resolveEffectiveConfig` to properly parse, typecheck, and forward webhook configurations from `agentflow.config.json`.

### StateStore Event Subscription (Pub/Sub)
- Refactored `StateStore` in [state-store.ts](src/workflow/state-store.ts) to support subscription mechanism (`subscribe`).
- Dispatched all emitted sprint events asynchronously to subscribers within `emit()`, keeping logging logic decoupled from network transports.

### Asynchronous HTTP Webhook Dispatch
- Subscribed webhook callers inside `runSprint` in [sprint-engine.ts](src/workflow/sprint-engine.ts) right after state store hydration.
- Dispatched non-blocking event notifications via Node.js native `globalThis.fetch` to prevent network latency from blocking the sprint loop.
- Added comprehensive integration test suite [poc-webhook.ts](tests/poc-webhook.ts) utilizing a dynamic local mock HTTP server, and registered it in `package.json` and [regression.ts](tests/eval/regression.ts) regression testing suite.

Validation:

```bash
pnpm run test
git diff --check
```
