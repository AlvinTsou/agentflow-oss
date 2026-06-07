# Week 3 Active Maintenance Plan

This plan covers the next maintenance cycle for `agentflow-oss`, from
2026-06-08 through 2026-06-14.

The goal is to keep the repository visibly active while improving engineering
quality. The priority is validation depth: release-readiness tests first,
custom redaction second, documentation and release hygiene last.

## Current Baseline

- Repository: https://github.com/AlvinTsou/agentflow-oss
- Default branch: `main`
- CI: GitHub Actions `CI`
- Local validation command: `pnpm run test`
- Current state:
  - Middleman capability registry is implemented.
  - Middleman route metadata and audit trail are implemented.
  - Security profiles are implemented.
  - Smoke-test CLI is implemented.
  - Release-readiness recipe is integrated into the engine.
  - Latest CI runs are green.

## Week Objective

By the end of the week, the project should have:

- Offline coverage for the release-readiness recipe.
- Fixture coverage for common release-readiness failures.
- Custom redaction patterns implemented, tested, and documented.
- Roadmap and maintenance log synchronized with shipped work.
- `v0.2.0` release candidate notes prepared.

## Priority Order

1. Harden release-readiness with tests.
2. Add custom redaction patterns.
3. Update docs and roadmap.
4. Prepare release candidate notes.
5. Keep GitHub Issues and CI clean.

Do not start another large feature until release-readiness and custom redaction
are tested.

## Daily Plan

### Day 1 - Release-Readiness Offline Tests

Purpose: verify the release-readiness recipe without provider calls.

Tasks:

- Add `tests/poc-release-readiness.ts`.
- Cover recipe initialization.
- Cover basic pass/fail result handling.
- Verify the recipe can be imported and constructed in offline CI.
- Add the test file to the `test:offline` script in `package.json`.

Validation:

```bash
pnpm run test
git diff --check
```

Suggested commit:

```text
test: verify release-readiness recipe execution offline
```

Expected public signal:

- The new recipe is not just present in docs; it has executable offline
  coverage.

### Day 2 - Release-Readiness Fixture Coverage

Purpose: cover realistic release-preparation failure modes.

Tasks:

- Add fixtures for:
  - missing `CHANGELOG.md`
  - package version mismatch
  - missing documentation for new CLI behavior
  - passing release-ready state
- Verify readiness output categories:
  - blocking
  - deferred
  - nit
- Keep fixtures neutral and public-safe.

Validation:

```bash
pnpm run test
pnpm run test:secret-scan
git diff --check
```

Suggested commit:

```text
test: add release-readiness fixtures
```

Expected public signal:

- The recipe can detect concrete maintainer problems.

### Day 3 - Custom Redaction Patterns

Purpose: let projects define their own non-standard secret or identifier
patterns.

Tasks:

- Extend `MiddlemanPolicy` in `src/middleman/policy.ts`.
- Add `customRedactions`.
- Suggested shape:

```ts
customRedactions?: Array<{
  kind: string;
  pattern: string;
  replacement?: string;
}>;
```

- Compile custom patterns safely.
- Apply custom redactions under the `default` profile.
- Block custom findings under the `strict` profile.
- Bypass custom scanning under the `off` profile.

Validation:

```bash
pnpm run test
git diff --check
```

Suggested commit:

```text
feat: support custom redaction patterns
```

Expected public signal:

- Security behavior becomes configurable without requiring private patches.

### Day 4 - Custom Redaction Tests And Docs

Purpose: make custom redaction behavior precise and documented.

Tasks:

- Extend `tests/poc-middleman.ts`.
- Cover:
  - custom pattern redacted under `default`
  - custom pattern blocks under `strict`
  - custom pattern bypasses under `off`
  - no false positives on ordinary code identifiers
- Update `docs/provider-routing.md`.
- Add a public-safe config example without real token patterns.

Validation:

```bash
pnpm run test
pnpm run test:secret-scan
git diff --check
```

Suggested commit:

```text
test: cover custom redaction policy behavior
```

Expected public signal:

- Security profile behavior is validated and usable from documentation.

### Day 5 - Roadmap And Maintenance Log Sync

Purpose: keep public project status aligned with actual implementation.

Tasks:

- Update `ROADMAP.md`.
- Add `docs/maintenance-log/2026-06-week-2.md`.
- Summarize:
  - release-readiness recipe integration
  - release-readiness tests and fixtures
  - custom redaction implementation
  - custom redaction tests
  - CI status
- Keep future work scoped and realistic.

Validation:

```bash
pnpm run test:secret-scan
git diff --check
```

Suggested commit:

```text
docs: finalize week 2 maintenance log
```

Expected public signal:

- The repo shows a consistent maintenance trail, not isolated feature commits.

### Day 6 - v0.2.0 Release Candidate Notes

Purpose: prepare release notes without rushing the tag.

Tasks:

- Add or update release notes draft under `docs/releases/`.
- Draft `v0.2.0` notes covering:
  - middleman capability registry
  - route audit metadata
  - security profiles
  - smoke-test CLI
  - release-readiness recipe
  - custom redaction patterns
- Confirm all tests pass locally.
- Confirm latest GitHub Actions run is green.

Validation:

```bash
pnpm run test
gh run list --repo AlvinTsou/agentflow-oss --limit 5
git diff --check
```

Suggested commit:

```text
chore: prepare v0.2.0 release notes
```

Expected public signal:

- The project is preparing a coherent release milestone.

### Day 7 - Issue Hygiene And Week 4 Planning

Purpose: close completed work and keep the next backlog actionable.

Tasks:

- Close issues completed during the week.
- Keep 3-5 scoped issues open.
- Create or update Week 4 planning notes.
- Suggested Week 4 candidates:
  - PR review recipe proposal
  - release-readiness hardening
  - route audit replay formatting
  - status CLI layout improvements
  - custom redaction config-loader integration

Validation:

```bash
pnpm run test:secret-scan
git status --short --branch
gh run list --repo AlvinTsou/agentflow-oss --limit 5
```

Suggested commit:

```text
docs: plan week 4 maintenance work
```

Expected public signal:

- The project has a visible, maintained backlog.

## Suggested Issue Backlog

Keep these issues open or create them if missing:

1. `test: verify release-readiness recipe execution offline`
2. `test: add release-readiness fixtures`
3. `enhancement: support custom redaction patterns`
4. `docs: document custom redaction policy`
5. `chore: prepare v0.2.0 release notes`
6. `good first issue: improve status CLI terminal layout`

Recommended labels:

- `test`
- `enhancement`
- `documentation`
- `good first issue`
- `release`
- `security`

## Weekly Success Criteria

The week is successful when:

- `pnpm run test` passes.
- GitHub Actions `CI` is green.
- Release-readiness has offline tests.
- Release-readiness has fixture coverage.
- Custom redaction is implemented.
- Custom redaction has tests.
- Public docs explain custom redaction behavior.
- `ROADMAP.md` reflects shipped work.
- `v0.2.0` release notes are drafted.

## Verification Checklist

Run before every push:

```bash
git status --short --branch
pnpm run test
pnpm run test:secret-scan
git diff --check
```

Run after every push:

```bash
gh run list --repo AlvinTsou/agentflow-oss --limit 5
```

If CI is in progress:

```bash
gh run watch --repo AlvinTsou/agentflow-oss --exit-status
```

## Constraints

- Keep examples neutral and public-safe.
- Do not commit raw sprint directories.
- Do not add provider-backed tests to default CI.
- Do not add large new features before the release-readiness and custom
  redaction work is tested.
- Do not force-push `main`.
