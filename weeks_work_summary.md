# Weekly Work Summary

Date: 2026-06-18
Repository: `agentflow-oss`

## Current Repo State

- Branch: `main`
- Working tree: contains modified scripts, test fixtures, proposals, and this updated summary.
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
- All offline test suites passed: 8 test files, 8 passing test runs, 0 failures.
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

## Next Week Schedule

### Day 1 - Publish And Verify

- Commit all local changes and push to `origin/main`.
- Watch the latest CI and Pages deployment runs.
- Confirm Pages still returns `HTTP/2 200` after deployment.

Validation:

```bash
git status --short --branch
git push
gh run list --repo AlvinTsou/agentflow-oss --limit 5
curl -I https://alvintsou.github.io/agentflow-oss/
```

### Day 2 - Maintenance Log + Conditional Steps (A-3)

- Update the next dated maintenance log under `docs/maintenance-log/`.
- Record the security review hardening and API design review proposal.
- **Implement A-3:** Add `condition?: (ctx: StepContext) => boolean` to `StepDef` in `src/recipe/types.ts`.
- Wire condition check into `sprint-engine.ts` (after `skipStep`, before `step-started`).
- Handle `step-condition-skipped` event in `ag-replay.ts`.

Validation:

```bash
pnpm run build
pnpm run test
git diff --check
```

### Day 3 - Sprint Outcome Index (A-2)

- Create `src/workflow/sprint-index.ts` with `SprintOutcomeRecord` type and `SprintIndex` class.
- Storage: append-only JSONL at `~/.agentflow/sprint-index.jsonl`.
- Wire `sprintIndex.record()` into sprint-engine finalization block (~10 lines).
- Create `tests/poc-sprint-index.ts` offline test.

Validation:

```bash
pnpm run build
node --import tsx --test tests/poc-sprint-index.ts
pnpm run test
```

### Day 4 - Event-Driven Trigger Layer, Part 1 (A-1)

- Create `src/workflow/trigger-registry.ts` with `TriggerDef` interface and `TriggerRunner` class.
- Implement cron trigger via `setTimeout` scheduling (simplest first).
- Create `triggers.schema.json` for config validation.
- Create `ag-daemon.ts` with `--config` and `--dry-run` flags.

Validation:

```bash
pnpm run build
node --import tsx --test tests/poc-trigger-registry.ts
```

### Day 5 - Event-Driven Trigger Layer, Part 2 (A-1) + API Review Wiring

- Add fs-watch and git-hook trigger types to `trigger-registry.ts`.
- Wire `daemon` subcommand into `ag.ts`.
- Wire `api-design-review` into `KNOWN_RECIPES` in `ag-init.ts` and `ag.ts`.
- Implement `recipes/api-design-review.json` with proposed steps and rubrics.

Validation:

```bash
pnpm run build
pnpm run test:offline
```

### Day 6 - Parallel forEach Groundwork (A-4)

- Create `src/util/semaphore.ts` with counting semaphore implementation.
- Add `maxConcurrent?: number` to `ForEachConfig` in `src/recipe/types.ts`.
- Begin refactoring the forEach block in `sprint-engine.ts` to support `Promise.all` + semaphore.
- Create `tests/poc-parallel-foreach.ts` offline test with mock providers.

Validation:

```bash
pnpm run build
node --import tsx --test tests/poc-parallel-foreach.ts
pnpm run test
```

### Day 7 - Weekly Closeout

- Complete parallel forEach if in progress; ensure all paths fall back to sequential when `maxConcurrent` is 1 or unset.
- Create `tests/poc-api-design-review.ts` and integrate into `package.json` test script.
- Update `ROADMAP.md` to reflect Phase A items under a new `v1.5 -- Loop Engineering` section.
- Update work summary and align CLI reference.
- Verify everything runs green.

Validation:

```bash
pnpm run test
git diff --check
```
