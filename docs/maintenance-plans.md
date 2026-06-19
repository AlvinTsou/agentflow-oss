# Active Maintenance Plans

This document consolidates the weekly active maintenance plans for `agentflow-oss` and tracks the current implementation status.

## Current Verification Status (As of 2026-06-19)

- **GitHub Pages**: **Live**. Repository Pages is enabled, the configured source is `main:/docs`, the Pages API reports `built`, HTTPS is enforced, and `https://alvintsou.github.io/agentflow-oss/` returns `HTTP/2 200`.
- **Latest GitHub Actions Check**: **Green**. Recent `CI` and `pages-build-deployment` runs on `main` completed successfully.
- **Week 1 Plan**: **Completed**. OpenAI-compatible gateway smoke test CLI, SDD walkthrough documentation, provider capability registry, capability validation, route metadata, security profiles, and route audit logging are implemented and covered by tests.
- **Week 2 / Week 3 Work**: **Completed**. Release-readiness recipe integration, offline fixtures, custom redaction policy behavior, documentation, and roadmap synchronization are represented in the repo maintenance logs.
- **Week 4 Plan**: **Completed**. PR review recipe proposal, release-readiness hardening, route audit replay formatting, status CLI layout improvements, and custom redaction config-loader integration are complete.
- **Week 5 Plan**: **Completed**. The `pr-review` recipe is defined, exposed through init, covered by offline tests and fixtures, and wired to git diff context ingestion.
- **Week 6 Plan**: **Completed**. Pages accuracy, PR review documentation, route audit examples, security review scoping, and weekly verification are recorded in the Week 6 maintenance log.
- **Week 7 Work**: **Completed**. Security review hardening, `api-design-review` recipe initialization, conditional step execution, trigger registry support, sprint outcome indexing, and parallel `forEach` execution are recorded in the Week 7 maintenance log and covered by offline tests.
- **Week 8 Work**: **Started**. The first Phase B slice adds a phase-level streaming checkpoint foundation and management API data contract, without introducing a web server yet.
- **Next Maintenance Focus**: **Week 8 / Phase B Continuation**. Extend checkpoint consumers and decide whether to continue into `Self-Feeding Loops (B-6)` or a minimal local management API reader.

---

## Week 1 Active Maintenance Plan

This plan keeps `agentflow-oss` visibly active and genuinely maintained during the first week after publication.

The goal is not to create empty activity. Each day should produce a small, reviewable improvement with a clear maintenance purpose, a passing CI run, and an understandable commit.

### Current Baseline

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

### Week Objective

Move the project from "newly published" to "actively maintained" by showing:

- Meaningful commits every 1-2 days
- Passing CI on `main`
- Public issues with scoped work
- Roadmap alignment with completed features
- Docs that explain the maintainer workflow model, not only commands
- A first release candidate or release milestone

### Middleman Expansion Guardrails

This week should bring the `AgentFlowDev` middleman concept into `agentflow-oss` carefully. The OSS scope is the internal provider orchestration layer used by the workflow engine, not a full external packet-inspecting proxy.

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

### Daily Plan

#### Day 1 - Sync Roadmap And Open Issues

Purpose: make the public roadmap match the current implementation.

Tasks:

- Update `ROADMAP.md`.
- Move `OpenAI-compatible gateway smoke test` from planned work into current or completed work.
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

#### Day 2 - Publish State Machine Concept Doc

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

#### Day 3 - Strengthen Smoke Test Coverage

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

#### Day 4 - Add Provider Capability Registry

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

- The middleman is becoming a verifiable routing layer, not just a provider switch statement.

#### Day 5 - Add Capability Validation And Route Metadata

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

- The middleman records why a provider was chosen and why a request was safe to send.

#### Day 6 - Add Security Profiles And Route Audit

Purpose: turn the middleman into an audit-friendly safety boundary.

Tasks:

- Extend `MiddlemanPolicy` with named security profiles:
  - `default`
  - `strict`
  - `off`
- Keep the implementation regex/profile based; do not add local model anonymization this week.
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

#### Day 7 - Sync Docs, Roadmap, And Release Notes

Purpose: close the middleman expansion loop with public documentation and a clean next milestone.

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

- The repo shows a coherent feature evolution from smoke test to provider routing governance.
- Future contributors can understand what middleman means in the OSS scope.

### Suggested Issue Backlog

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

### Weekly Success Criteria

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

### Maintenance Commands

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

### Public Safety Checklist

Before committing docs, examples, or fixtures, confirm:

- No `.env` files are included.
- No local absolute paths are included.
- No private project names are included.
- No raw sprint output directories are included.
- No API keys or token-like strings are included.
- Any examples use neutral workflow names.
- Public docs match real CLI behavior.

### Notes For OpenAI Codex For Open Source Review

During the application review period:

- Keep `main` green.
- Avoid force-pushing `main`.
- Avoid large unrelated rewrites.
- Prefer small, visible docs and test improvements.
- Keep issues and roadmap tidy.
- Keep the project clearly scoped around OSS maintainer workflows.

The strongest signal is not high commit volume by itself. The strongest signal is a repo that repeatedly shows: clear plan, small improvement, passing CI, updated docs, and scoped next work.

---

## Week 2 Active Maintenance Plan

This plan outlines the maintenance and development activities for `agentflow-oss` during its second week post-publication.

The objective is to expand the project's utility by adding a core recipe for maintainers, introducing configurable security policies, and maintaining a steady public development cadence.

### Current Baseline

*   Repository: https://github.com/AlvinTsou/agentflow-oss
*   Default branch: `main`
*   Current Release Milestone: `v0.1.0` (Core Engine and Middleman Expansion)
*   Key Week 1 Deliverables Completed:
    *   Provider capability registry and routing validations
    *   Security profiles (`default`, `strict`, `off`) and route audit trails
    *   State-machine conceptual documentation
    *   Offline middleman test suite

### Week Objective

*   **Implement Release Readiness Recipe:** Add a built-in workflow recipe that automates release sanity checks (changelog verification, version alignment, dependency state).
*   **Custom Secret Redaction Profiles:** Support custom regex patterns in policy configuration to allow users to redact project-specific keys or identifiers.
*   **Enhance CLI Documentation:** Address the backlog item of providing one more complete, sanitized CLI example.
*   **Maintain Stable CI:** Ensure all new features are backed by offline unit and integration tests, preserving green builds.

### Daily Plan

#### Day 1 - Sync Roadmap and Add Sanitized CLI Example

**Purpose:** Update the issue backlog for Week 2 and document practical CLI workflows for newcomers.

**Tasks:**
*   Update `ROADMAP.md` to reflect Week 2 goals.
*   Create GitHub issues for:
    *   `recipe: add release-readiness workflow`
    *   `enhancement: support custom secret redaction patterns`
    *   `test: cover release-readiness recipe logic`
*   Add a new example markdown file `docs/examples/quickstart-mini.md` demonstrating a full local run using the `mini` recipe, showing the git checkpoints, state logs, and status output.

**Validation:**
```bash
pnpm run test:secret-scan
git diff --check
```

**Suggested commit:**
```text
docs: add mini recipe quickstart guide and sync roadmap
```

---

#### Day 2 - Design Release Readiness Recipe

**Purpose:** Design the steps, prompt templates, and evaluation rubrics for the `release-readiness` recipe.

**Tasks:**
*   Add `recipes/release-readiness.json` defining a 3-step workflow:
    1.  `audit-changelog`: Verify that `CHANGELOG.md` is updated with recent commit scopes and version numbers.
    2.  `check-version`: Ensure `package.json` version has been incremented relative to recent release tags.
    3.  `validate-docs`: Confirm all new source options/features have corresponding documentation coverage.
*   Define the rubrics, target scores, and default providers for each step.
*   Document the recipe design in `docs/proposals/release-readiness-recipe.md`.

**Validation:**
```bash
pnpm run test:secret-scan
git diff --check
```

**Suggested commit:**
```text
docs: design release-readiness recipe workflow
```

---

#### Day 3 - Implement Release-Readiness Recipe Execution

**Purpose:** Code the runner logic and integrate the new recipe into the recipe registry.

**Tasks:**
*   Add the recipe configuration loading code in `src/recipe/registry.ts` or `src/workflow/config-loader.ts`.
*   Ensure `pnpm ag init release-readiness` resolves and initializes correctly.
*   Verify that step context mapping correctly forwards repository metadata (like git tag logs or diff summaries) to the recipe steps.

**Validation:**
```bash
pnpm run test
git diff --check
```

**Suggested commit:**
```text
feat: integrate release-readiness recipe into engine
```

---

#### Day 4 - Add Integration Tests for Release-Readiness Recipe

**Purpose:** Secure the new recipe with offline tests, verifying it correctly flags version mismatches and missing files.

**Tasks:**
*   Create `tests/poc-release-readiness.ts`.
*   Mock provider responses for passing/failing steps (e.g. mock a failed changelog score due to missing entries, then a successful fix).
*   Assert that the readiness status matches the step outcomes and readiness carry-overs are extracted correctly.

**Validation:**
```bash
pnpm run test
git diff --check
```

**Suggested commit:**
```text
test: verify release-readiness recipe execution offline
```

---

#### Day 5 - Custom Secret Redaction Patterns

**Purpose:** Enable project-specific redaction rules to prevent developers from leaking non-standard proprietary keys.

**Tasks:**
*   Extend `MiddlemanPolicy` configuration in `src/middleman/policy.ts` to accept a `customRedactions` array of `{ pattern: string, replacement?: string }`.
*   Update the scanner regex builder to compile these custom patterns dynamically.
*   Expose this configuration in `agentflow.config.json` schema.

**Validation:**
```bash
pnpm run test
git diff --check
```

**Suggested commit:**
```text
feat: support custom regex redaction patterns in policy
```

---

#### Day 6 - Add Policy Custom Redaction Tests

**Purpose:** Validate the safety and precision of custom redaction rules under multiple security profiles.

**Tasks:**
*   Extend `tests/poc-middleman.ts` to verify:
    *   Custom patterns are successfully redacted under `default` profile.
    *   Custom patterns trigger exceptions under `strict` profile.
    *   No false positives on standard code keywords.
*   Update `docs/provider-routing.md` to document the custom policy syntax.

**Validation:**
```bash
pnpm run test
pnpm run test:secret-scan
```

**Suggested commit:**
```text
test: cover custom secret redaction policy behavior
```

---

#### Day 7 - Sync Docs, Roadmap, and Release Log

**Purpose:** Consolidate the Week 2 milestone, update roadmap, and prepare release tags.

**Tasks:**
*   Add `docs/maintenance-log/2026-06-week-2.md` summarizing the new recipe and policy configuration.
*   Update `ROADMAP.md` to mark release-readiness and custom redaction as completed.
*   Verify all tests are green.
*   Prepare the `v0.2.0` milestone release notes.

**Validation:**
```bash
pnpm run test
pnpm run test:secret-scan
git status --short
```

**Suggested commit:**
```text
docs: finalize week 2 maintenance cycle
```

### Suggested Issue Backlog

Keep the following issues active or open during the week:
1.  `recipe: add release-readiness workflow`
2.  `enhancement: support custom secret redaction patterns`
3.  `test: cover release-readiness recipe logic`
4.  `good first issue: add one more sanitized CLI example`
5.  `good first issue: improve status CLI terminal layout`

### Weekly Success Criteria

*   **5-7 Meaningful Commits:** Showing a continuous flow of small, reviewed improvements.
*   **Green Build:** Zero failures in local test suites and GitHub Actions CI.
*   **Fully Functional Recipe:** Users can initialize and run the `release-readiness` recipe.
*   **Robust Custom Redaction:** Custom patterns are validated, redacted, and covered by tests.
*   **Updated Docs:** Clean documentation matches the new configuration schema and recipe formats.

---

## Week 3 Active Maintenance Plan

This plan covers the next maintenance cycle for `agentflow-oss`, from 2026-06-08 through 2026-06-14.

The goal is to keep the repository visibly active while improving engineering quality. The priority is validation depth: release-readiness tests first, custom redaction second, documentation and release hygiene last.

### Current Baseline

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

### Week Objective

By the end of the week, the project should have:

- Offline coverage for the release-readiness recipe.
- Fixture coverage for common release-readiness failures.
- Custom redaction patterns implemented, tested, and documented.
- Roadmap and maintenance log synchronized with shipped work.
- `v0.2.0` release candidate notes prepared.

### Priority Order

1. Harden release-readiness with tests.
2. Add custom redaction patterns.
3. Update docs and roadmap.
4. Prepare release candidate notes.
5. Keep GitHub Issues and CI clean.

Do not start another large feature until release-readiness and custom redaction are tested.

### Daily Plan

#### Day 1 - Release-Readiness Offline Tests

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

- The new recipe is not just present in docs; it has executable offline coverage.

#### Day 2 - Release-Readiness Fixture Coverage

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

#### Day 3 - Custom Redaction Patterns

Purpose: let projects define their own non-standard secret or identifier patterns.

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

#### Day 4 - Custom Redaction Tests And Docs

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

#### Day 5 - Roadmap And Maintenance Log Sync

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

#### Day 6 - v0.2.0 Release Candidate Notes

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

#### Day 7 - Issue Hygiene And Week 4 Planning

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

### Suggested Issue Backlog

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

### Weekly Success Criteria

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

### Verification Checklist

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

### Constraints

- Keep examples neutral and public-safe.
- Do not commit raw sprint directories.
- Do not add provider-backed tests to default CI.
- Do not add large new features before the release-readiness and custom redaction work is tested.
- Do not force-push `main`.

---

## Week 4 Active Maintenance Plan

This plan outlines the next maintenance cycle for `agentflow-oss` (from 2026-06-15 through 2026-06-21).

The focus for this week is on enhancing maintainer workflow recipes and hardening CLI usability.

### Week Objective

- **PR Review Recipe Proposal**: Design and draft steps for a PR review recipe to support automated code reviews.
- **Release-Readiness Hardening**: Address potential edge cases and optimize validation logic in the release-readiness recipe runner.
- **Route Audit Replay Formatting**: Enhance formatting for replay commands to improve route decision readability.
- **CLI Layout Improvements**: Tidy and improve terminal layouts for `ag status` and overall CLI outputs.
- **Custom Redaction Config Integration**: Seamlessly resolve and load `customRedactions` directly within the `agentflow.config.json` loader.

### Daily Plan

#### Day 1 - PR Review Recipe Proposal
- Purpose: Design a structured code review recipe that outputs GitHub-compatible feedback.
- Tasks:
  - Add `docs/proposals/pr-review-recipe.md`.
  - Outline steps, rubrics, and model provider configurations.
- Validation:
  ```bash
  pnpm run test:secret-scan
  git diff --check
  ```
- Suggested commit:
  ```text
  docs: propose PR review recipe workflow
  ```

#### Day 2 - Release-Readiness Hardening
- Purpose: Harden verification steps for release-readiness recipe.
- Tasks:
  - Add edge case assertions in readiness checks (e.g. handle missing package.json gracefully).
- Validation:
  ```bash
  pnpm run test
  ```
- Suggested commit:
  ```text
  refactor: harden release-readiness edge cases
  ```

#### Day 3 - Route Audit Replay Formatting
- Purpose: Improve routing analysis logs in replay modes.
- Tasks:
  - Update `src/workflow/sprint-engine.ts` and audit reports to format decisions more cleanly.
- Validation:
  ```bash
  pnpm run test
  ```
- Suggested commit:
  ```text
  feat: format route audit replay logs
  ```

#### Day 4 - CLI Layout Improvements
- Purpose: Enhance user feedback readability during sprint execution.
- Tasks:
  - Adjust formatting and alignment inside `ag-status.ts`.
- Validation:
  ```bash
  pnpm run test
  ```
- Suggested commit:
  ```text
  ui: improve status CLI terminal layout
  ```

#### Day 5 - Custom Redaction Config Integration
- Purpose: Load custom redactions dynamically from config files.
- Tasks:
  - Update `src/workflow/config-loader.ts` to deserialize and validate `customRedactions` policy array.
- Validation:
  ```bash
  pnpm run test
  ```
- Suggested commit:
  ```text
  feat: integrate custom redactions into config-loader
  ```

#### Day 6 - Sync Docs and Roadmap
- Purpose: Align roadmap milestones.
- Tasks:
  - Sync `ROADMAP.md` and draft next week goals.
- Validation:
  ```bash
  pnpm run test
  ```
- Suggested commit:
  ```text
  docs: sync roadmap and plan week 5
  ```

#### Day 7 - Finalize Week 4 Log
- Purpose: Close out Week 4 work.
- Tasks:
  - Add `docs/maintenance-log/2026-06-week-4.md`.
- Validation:
  ```bash
  pnpm run test
  ```
- Suggested commit:
  ```text
  docs: finalize week 4 maintenance log
  ```

---

## Week 5 Active Maintenance Plan

This plan outlines the next maintenance cycle for `agentflow-oss` (from 2026-06-22 through 2026-06-28).

The objective is to implement and verify the `pr-review` workflow recipe, incorporating git diff ingestion and automated review feedback.

### Week Objective

- **PR Review Recipe Definition**: Add `recipes/pr-review.json` defining the 3-step code review workflow.
- **Recipe Ingestion & Init**: Support `pnpm ag init pr-review` in CLI.
- **Offline PR Review Tests**: Set up a test suite `tests/poc-pr-review.ts` to mock and execute the recipe.
- **PR Review Fixtures**: Create realistic buggy/clean diff fixtures to cover rubrics and verify scores.
- **Git Diff Ingestion Tooling**: Integrate mechanisms to feed repository changes into the step context.

### Daily Plan

#### Day 1 - PR Review Recipe Definition and Init
- Purpose: Add recipe json structure and expose initialization via CLI.
- Tasks:
  - Add `recipes/pr-review.json` containing `analyze-diff`, `review-code`, and `generate-feedback` steps.
  - Update `ag-init.ts` to include `"pr-review"` in `KNOWN_RECIPES`.
- Validation:
  ```bash
  pnpm run test:secret-scan
  git diff --check
  ```
- Suggested commit:
  ```text
  feat: define pr-review recipe and expose init
  ```

#### Day 2 - Offline PR Review Tests
- Purpose: Create executable offline coverage for the `pr-review` sprint.
- Tasks:
  - Create `tests/poc-pr-review.ts` that mocks LLM responses and asserts sprint execution.
- Validation:
  ```bash
  pnpm run test:offline
  ```
- Suggested commit:
  ```text
  test: add offline execution tests for pr-review
  ```

#### Day 3 - PR Review Fixtures
- Purpose: Verify rubrics against realistic PR reviews.
- Tasks:
  - Create review fixtures under `tests/fixtures/pr-review/` simulating bug findings vs clean passes.
- Validation:
  ```bash
  pnpm run test:offline
  ```
- Suggested commit:
  ```text
  test: add pr-review fixtures and rubric tests
  ```

#### Day 4 - Git Diff Ingestion Tooling
- Purpose: Provide tools to feed current git diff into step prompts.
- Tasks:
  - Add logic to capture `git diff` output and supply it to the sprint context.
- Validation:
  ```bash
  pnpm run test:offline
  ```
- Suggested commit:
  ```text
  feat: support git diff ingestion for pr-review context
  ```

#### Day 5 - Sync Docs and Finalize Week 5
- Purpose: Synchronize logs and roadmap.
- Tasks:
  - Sync `ROADMAP.md` and add `docs/maintenance-log/2026-06-week-5.md`.
- Validation:
  ```bash
  pnpm run test:offline
  ```
- Suggested commit:
  ```text
  docs: finalize week 5 maintenance log and sync roadmap
  ```

---

## Week 6 Active Maintenance Plan

This plan outlines the next maintenance cycle for `agentflow-oss`.

The objective is to keep the public GitHub Pages site accurate after the multilingual launch, turn the next recipe idea into a scoped proposal, and harden the newly implemented `pr-review` workflow documentation without starting a large unvalidated feature.

### Current Baseline

- Repository: https://github.com/AlvinTsou/agentflow-oss
- Public site: https://alvintsou.github.io/agentflow-oss/
- Pages source: `main:/docs`
- Pages status: `built`
- Latest checked public response: `HTTP/2 200`
- Current completed recipe set: `mini`, `research`, `sdd`, `release-readiness`, `pr-review`
- Current roadmap state: v1.1, v1.2, and v1.3 maintenance milestones are marked completed.

### Week Objective

- **Pages Accuracy Pass**: Confirm localized Pages content still matches current roadmap and shipped features.
- **PR Review Documentation**: Add practical docs for initializing, running, and interpreting `pr-review` output.
- **Security Review Recipe Proposal**: Scope the next recipe without implementing it yet.
- **Route Audit Examples**: Add a public-safe example showing route audit replay output.
- **Verification Discipline**: Keep `test:offline`, `test:secret-scan`, and GitHub Actions green.

### Daily Plan

#### Day 1 - Pages Content Audit
- Purpose: ensure the public site describes the real project state.
- Tasks:
  - Review `docs/en/`, `docs/zh-tw/`, `docs/zh-cn/`, `docs/ja/`, and `docs/ko/` landing pages.
  - Update shipped feature lists to include `pr-review`, git diff ingestion, and route audit replay formatting where appropriate.
  - Confirm navigation still points to the correct repo docs and roadmap.
- Validation:
  ```bash
  pnpm run test:secret-scan
  git diff --check
  curl -I https://alvintsou.github.io/agentflow-oss/
  ```
- Suggested commit:
  ```text
  docs: sync pages content with current roadmap
  ```

#### Day 2 - PR Review Usage Guide
- Purpose: make the new recipe usable without reading tests.
- Tasks:
  - Add `docs/recipes/pr-review.md`.
  - Document `pnpm ag init pr-review`, expected sprint artifacts, git diff context behavior, and review output categories.
  - Include one sanitized example command sequence.
- Validation:
  ```bash
  pnpm run test:secret-scan
  git diff --check
  ```
- Suggested commit:
  ```text
  docs: add pr-review recipe usage guide
  ```

#### Day 3 - Route Audit Replay Example
- Purpose: show maintainers how to inspect provider routing decisions.
- Tasks:
  - Add or update a docs example showing `ag replay` route audit output.
  - Explain provider, model, route reason, matched rule, warnings, and security profile fields.
  - Keep the example public-safe and avoid real provider request payloads.
- Validation:
  ```bash
  pnpm run test:secret-scan
  git diff --check
  ```
- Suggested commit:
  ```text
  docs: add route audit replay example
  ```

#### Day 4 - Security Review Recipe Proposal
- Purpose: scope the next recipe before implementation.
- Tasks:
  - Add `docs/proposals/security-review-recipe.md`.
  - Define proposed steps for dependency risk, secret exposure, auth boundary review, and unsafe pattern review.
  - Specify offline-test requirements and constraints before any code work starts.
- Validation:
  ```bash
  pnpm run test:secret-scan
  git diff --check
  ```
- Suggested commit:
  ```text
  docs: propose security review recipe
  ```

#### Day 5 - Roadmap and Issue Hygiene
- Purpose: keep public planning aligned with completed and next work.
- Tasks:
  - Update `ROADMAP.md` to mark `security review recipe` as proposed, not implemented.
  - Keep `Web UI` and team features in the future section.
  - Create or update scoped issues for Pages polish, PR review docs, route audit examples, and security review recipe design.
- Validation:
  ```bash
  pnpm run test:secret-scan
  gh run list --repo AlvinTsou/agentflow-oss --limit 5
  git diff --check
  ```
- Suggested commit:
  ```text
  docs: sync roadmap for week 6 planning
  ```

#### Day 6 - Offline Verification Sweep
- Purpose: catch regressions before the weekly log.
- Tasks:
  - Run the offline suite.
  - Run the secret scanner.
  - Inspect `git status --short --branch`.
  - Fix any docs or fixture drift found during validation.
- Validation:
  ```bash
  pnpm run test:offline
  pnpm run test:secret-scan
  git status --short --branch
  ```
- Suggested commit:
  ```text
  test: verify week 6 maintenance docs
  ```

#### Day 7 - Finalize Week 6 Log
- Purpose: close the cycle with a durable maintenance record.
- Tasks:
  - Add `docs/maintenance-log/2026-06-week-6.md`.
  - Summarize Pages verification, PR review docs, route audit examples, security review proposal, and validation results.
  - Confirm GitHub Pages remains live after push.
- Validation:
  ```bash
  pnpm run test:offline
  pnpm run test:secret-scan
  git diff --check
  curl -I https://alvintsou.github.io/agentflow-oss/
  ```
- Suggested commit:
  ```text
  docs: finalize week 6 maintenance log
  ```

### Suggested Issue Backlog

Keep these issues open or create them if missing:

1. `docs: sync multilingual pages with current roadmap`
2. `docs: add pr-review recipe usage guide`
3. `docs: add route audit replay example`
4. `docs: propose security review recipe`
5. `good first issue: add one more sanitized replay fixture`

Recommended labels:

- `documentation`
- `recipe`
- `good first issue`
- `roadmap`
- `security`

### Weekly Success Criteria

The week is successful when:

- GitHub Pages still serves `HTTP/2 200`.
- Pages source remains `main:/docs`.
- Localized public pages match the current shipped feature set.
- `pr-review` has a practical user guide.
- Route audit replay has a sanitized example.
- Security review remains a scoped proposal until tests and fixtures are planned.
- `pnpm run test:offline` passes.
- `pnpm run test:secret-scan` passes.
- Recent GitHub Actions runs remain green.
