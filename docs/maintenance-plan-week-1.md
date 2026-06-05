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

## Middleman Expansion Guardrails

This week should bring the `AgentFlowDev` middleman concept into
`agentflow-oss` carefully. The OSS scope is the internal provider orchestration
layer used by the workflow engine, not a full external packet-inspecting proxy.

In scope:

- Provider capability registry
- Rule-based provider routing
- Provider-neutral request validation
- Security and redaction profiles
- Route decision metadata
- Sprint-event route audit trail
- Public docs explaining the middleman mental model

Out of scope for this week:

- External HTTP proxy for arbitrary coding clients
- Browser or web control plane
- Multi-user auth or team dashboard
- Private examples copied from non-public projects
- Claims that every harness can already route to every LLM

Public positioning:

```text
agentflow-oss middleman is an internal workflow routing layer. It gives the
sprint engine a provider-neutral request shape, policy checks, routing reasons,
provider capability validation, and audit-friendly route metadata.
```

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
  - `enhancement: add provider capability registry`
  - `enhancement: add middleman route decision metadata`
  - `docs: document middleman expansion boundaries`

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

### Day 4 - Add Provider Capability Registry

Purpose: make middleman routing explicit about what each provider can support.

Tasks:

- Add `src/middleman/capabilities.ts`.
- Define provider capabilities:
  - streaming
  - tool calls
  - JSON response format
  - smoke-test support
  - token limits
  - timeout behavior
  - OpenAI-compatible endpoint support
  - reasoning-effort support
- Export helpers:
  - `getProviderCapabilities(provider)`
  - `providerSupports(provider, capability)`
  - `describeProviderCapabilities(provider)`
- Add offline tests in `tests/poc-middleman.ts`.
- Update `docs/provider-routing.md` with a capability matrix.

Validation:

```bash
pnpm run test
git diff --check
```

Suggested commit:

```text
feat: add provider capability registry
```

Expected public signal:

- The middleman is becoming a verifiable routing layer, not just a provider
  switch statement.

### Day 5 - Add Capability Validation And Route Metadata

Purpose: make routing decisions auditable and safer before provider dispatch.

Tasks:

- Extend `RouteDecision` in `src/middleman/middleman.ts`.
- Add fields:
  - `provider`
  - `reason`
  - `matchedRule`
  - `requiredCapabilities`
  - `warnings`
- Validate requests before dispatch:
  - request has tools but provider lacks tool calls -> clear error
  - streaming requested but provider lacks streaming -> clear error or fallback
  - smoke-test unsupported provider -> actionable error
- Add tests for:
  - explicit provider route metadata
  - OpenAI-compatible route metadata
  - unsupported capability failure
  - route warning preservation

Validation:

```bash
pnpm run test
git diff --check
```

Suggested commit:

```text
feat: add middleman route capability validation
```

Expected public signal:

- The middleman records why a provider was chosen and why a request was safe to
  send.

### Day 6 - Add Security Profiles And Route Audit

Purpose: turn the middleman into an audit-friendly safety boundary.

Tasks:

- Extend `MiddlemanPolicy` with named security profiles:
  - `default`
  - `strict`
  - `off`
- Keep the implementation regex/profile based; do not add local model
  anonymization this week.
- Record route decisions in sprint events or artifact metadata:
  - provider
  - model
  - route reason
  - matched rule
  - capability warnings
  - policy profile
- Update `docs/provider-routing.md` with examples.

Validation:

```bash
pnpm run test
pnpm run test:secret-scan
git diff --check
```

Suggested commit:

```text
feat: record middleman route audit metadata
```

Expected public signal:

- The repo addresses the "black box" problem with route-level auditability.

### Day 7 - Sync Docs, Roadmap, And Release Notes

Purpose: close the middleman expansion loop with public documentation and a
clean next milestone.

Tasks:

- Add `docs/design/middleman-expansion.md`.
- Document:
  - shipped middleman behavior
  - this week's capability registry and route audit work
  - deferred external proxy / web control plane work
- Update `ROADMAP.md`:
  - mark smoke-test as completed/current
  - mark capability registry as current if implemented
  - keep external proxy/web UI as future/deferred
- Update `docs/cli-reference.md` and `docs/provider-routing.md`.
- Add `docs/maintenance-log/2026-06-week-1.md`.
- Summarize completed work:
  - roadmap sync
  - concept docs
  - smoke-test coverage
  - provider capability registry
  - route metadata
  - route audit
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
docs: document middleman expansion milestone
```

Expected public signal:

- The repo shows a coherent feature evolution from smoke test to provider
  routing governance.
- Future contributors can understand what middleman means in the OSS scope.

## Suggested Issue Backlog

Create or keep these issues open during the week:

1. `docs: explain the state-machine mental model`
2. `docs: add quality-loop and clean-context explainer`
3. `enhancement: add provider capability registry`
4. `enhancement: add middleman route decision metadata`
5. `docs: document middleman expansion boundaries`
6. `good first issue: add one more sanitized CLI example`

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
- One middleman expansion milestone or release candidate
- Public docs explaining the core workflow model
- Public docs explaining the OSS middleman boundary
- Route decisions include provider and reason metadata
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
