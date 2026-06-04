# Week 1 Active Maintenance Plan

This plan keeps `agentflow-oss` visibly active and genuinely maintained during
the first week after publication.

The goal is not to create empty activity. Each day should produce a small,
reviewable improvement with a clear maintenance purpose, a passing CI run, and
an understandable commit.

## Current Baseline

- Repository: https://github.com/AlvinTsou/agentflow-oss
- Default branch: `main`
- License: `Apache-2.0`
- CI: GitHub Actions `CI`
- Validation command: `pnpm run test`
- Recent completed work:
  - OpenAI-compatible gateway smoke test
  - `pnpm ag smoke-test` CLI subcommand
  - CLI command reference
  - Basic SDD sprint walkthrough
  - Feedback command examples
  - Release checklist
  - CI badge and public repository metadata

## Week Objective

Move the project from "newly published" to "actively maintained" by showing:

- Meaningful commits every 1-2 days
- Passing CI on `main`
- Public issues with scoped work
- Roadmap alignment with completed features
- Docs that explain the maintainer workflow model, not only commands
- A first release candidate or release milestone

## Daily Plan

### Day 1 - Sync Roadmap And Open Issues

Purpose: make the public roadmap match the current implementation.

Tasks:

- Update `ROADMAP.md`.
- Move `OpenAI-compatible gateway smoke test` from planned work into current or
  completed work.
- Create scoped GitHub issues:
  - `docs: explain the state-machine mental model`
  - `docs: add quality-loop and clean-context explainer`
  - `enhancement: provider capability registry`
  - `docs: add release readiness recipe proposal`

Validation:

```bash
pnpm run test:secret-scan
git diff --check
```

Suggested commit:

```text
docs: sync roadmap after smoke-test release
```

Expected public signal:

- Roadmap reflects actual implementation.
- GitHub Issues show visible next work.
- CI runs after the roadmap commit.

### Day 2 - Publish State Machine Concept Doc

Purpose: turn the core AgentFlow workflow model into public documentation.

Tasks:

- Add `docs/concepts/state-machine.md`.
- Explain that workflow state is owned by the engine, not by the model.
- Explain clean context per step.
- Explain resume, replay, and git checkpoints.
- Keep the doc CLI-first and public-safe.

Do not include:

- Private project names
- Local file paths
- Internal web UI claims
- Private sprint artifacts

Validation:

```bash
pnpm run test:secret-scan
git diff --check
```

Suggested commit:

```text
docs: explain state-machine workflow model
```

Expected public signal:

- The repo explains why it exists, not only how to run it.

### Day 3 - Strengthen Smoke Test Coverage

Purpose: make the new smoke-test feature more credible.

Tasks:

- Extend `docs/cli-reference.md` with failure examples:
  - timeout
  - 401 unauthorized
  - missing model
  - gateway error response
- Add or refine offline tests in `tests/poc-middleman.ts`.
- Confirm `ag.ts --help` and docs use the same command shape.

Validation:

```bash
pnpm run test
git diff --check
```

Suggested commit:

```text
test: cover smoke-test gateway failures
```

Expected public signal:

- Feature is tested, not only documented.
- CI shows the feature remains safe in offline mode.

### Day 4 - Draft Provider Capability Registry Design

Purpose: convert a roadmap item into an actionable design proposal.

Tasks:

- Add `docs/design/provider-capability-registry.md`.
- Define provider capabilities:
  - streaming
  - tool calls
  - JSON response format
  - smoke-test support
  - token limits
  - timeout behavior
- Document how the router should validate requests before dispatch.
- Link the design doc from the related GitHub issue.

Validation:

```bash
pnpm run test:secret-scan
git diff --check
```

Suggested commit:

```text
docs: propose provider capability registry
```

Expected public signal:

- The roadmap has design depth and a realistic next implementation path.

### Day 5 - Draft Release Readiness Recipe Proposal

Purpose: show a credible future recipe that fits maintainer workflows.

Tasks:

- Add `docs/proposals/release-readiness-recipe.md`.
- Define the recipe inputs:
  - repository path
  - changelog
  - package metadata
  - release notes draft
  - CI status
- Define expected outputs:
  - blocking findings
  - deferred findings
  - nit findings
  - release readiness summary
- Define acceptance criteria before implementation.

Validation:

```bash
pnpm run test:secret-scan
git diff --check
```

Suggested commit:

```text
docs: propose release readiness recipe
```

Expected public signal:

- The project has a maintainer-focused roadmap beyond the initial CLI.

### Day 6 - Prepare First Release

Purpose: create a milestone that makes the public repo easier to evaluate.

Tasks:

- Confirm `README.md`, `ROADMAP.md`, and `docs/cli-reference.md` match current
  behavior.
- Run the full validation suite.
- Cut `v0.1.0` if there are no blockers.

Validation:

```bash
pnpm run test
git status --short
gh run list --repo AlvinTsou/agentflow-oss --limit 3
```

Release command:

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 \
  --repo AlvinTsou/agentflow-oss \
  --title "v0.1.0 - Public core release" \
  --notes "Initial public release of AgentFlow OSS: maintainer workflow engine with sprint state, provider routing, quality gates, readiness reports, feedback records, smoke tests, offline tests, secret/privacy scan, and CI."
```

Suggested commit before tagging:

```text
chore: prepare v0.1.0 release
```

Expected public signal:

- The repo has a visible release milestone.
- GitHub visitors can see a stable starting point.

### Day 7 - Publish Maintenance Log And Next Week Plan

Purpose: close the first maintenance cycle with a public record.

Tasks:

- Add `docs/maintenance-log/2026-06-week-1.md`.
- Summarize completed work:
  - roadmap sync
  - concept docs
  - smoke-test coverage
  - design proposal
  - release readiness proposal
  - release status
- Close completed issues.
- Keep 3-5 scoped issues open for continued work.
- Draft next week goals.

Validation:

```bash
pnpm run test:secret-scan
git diff --check
gh run list --repo AlvinTsou/agentflow-oss --limit 3
```

Suggested commit:

```text
docs: add first maintenance log
```

Expected public signal:

- The repo shows a real maintenance rhythm.
- Future contributors can understand what happened and what is next.

## Suggested Issue Backlog

Create or keep these issues open during the week:

1. `docs: explain the state-machine mental model`
2. `docs: add quality-loop and clean-context explainer`
3. `enhancement: provider capability registry`
4. `docs: add release readiness recipe proposal`
5. `good first issue: add one more sanitized CLI example`

Recommended labels:

- `documentation`
- `enhancement`
- `good first issue`
- `roadmap`
- `ci`

## Weekly Success Criteria

By the end of the week, the project should have:

- 5-7 meaningful commits
- At least 3 successful CI runs
- 3-5 scoped GitHub issues
- Roadmap aligned with implemented work
- One first release or release candidate
- Public docs explaining the core workflow model
- No private artifacts, local paths, secrets, or internal task traces

## Maintenance Commands

Use this sequence before pushing changes:

```bash
git status --short --branch
pnpm run test
pnpm run test:secret-scan
git diff --check
```

Use this sequence after pushing changes:

```bash
gh run list --repo AlvinTsou/agentflow-oss --limit 3
gh run watch --repo AlvinTsou/agentflow-oss --exit-status
```

## Public Safety Checklist

Before committing docs, examples, or fixtures, confirm:

- No `.env` files are included.
- No local absolute paths are included.
- No private project names are included.
- No raw sprint output directories are included.
- No API keys or token-like strings are included.
- Any examples use neutral workflow names.
- Public docs match real CLI behavior.

## Notes For OpenAI Codex For Open Source Review

During the application review period:

- Keep `main` green.
- Avoid force-pushing `main`.
- Avoid large unrelated rewrites.
- Prefer small, visible docs and test improvements.
- Keep issues and roadmap tidy.
- Keep the project clearly scoped around OSS maintainer workflows.

The strongest signal is not high commit volume by itself. The strongest signal
is a repo that repeatedly shows: clear plan, small improvement, passing CI,
updated docs, and scoped next work.
