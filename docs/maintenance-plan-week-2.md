# Week 2 Active Maintenance Plan

This plan outlines the maintenance and development activities for `agentflow-oss` during its second week post-publication.

The objective is to expand the project's utility by adding a core recipe for maintainers, introducing configurable security policies, and maintaining a steady public development cadence.

## Current Baseline

*   Repository: https://github.com/AlvinTsou/agentflow-oss
*   Default branch: `main`
*   Current Release Milestone: `v0.1.0` (Core Engine and Middleman Expansion)
*   Key Week 1 Deliverables Completed:
    *   Provider capability registry and routing validations
    *   Security profiles (`default`, `strict`, `off`) and route audit trails
    *   State-machine conceptual documentation
    *   Offline middleman test suite

## Week Objective

*   **Implement Release Readiness Recipe:** Add a built-in workflow recipe that automates release sanity checks (changelog verification, version alignment, dependency state).
*   **Custom Secret Redaction Profiles:** Support custom regex patterns in policy configuration to allow users to redact project-specific keys or identifiers.
*   **Enhance CLI Documentation:** Address the backlog item of providing one more complete, sanitized CLI example.
*   **Maintain Stable CI:** Ensure all new features are backed by offline unit and integration tests, preserving green builds.

---

## Daily Plan

### Day 1 - Sync Roadmap and Add Sanitized CLI Example

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

### Day 2 - Design Release Readiness Recipe

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

### Day 3 - Implement Release-Readiness Recipe Execution

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

### Day 4 - Add Integration Tests for Release-Readiness Recipe

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

### Day 5 - Custom Secret Redaction Patterns

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

### Day 6 - Add Policy Custom Redaction Tests

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

### Day 7 - Sync Docs, Roadmap, and Release Log

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

---

## Suggested Issue Backlog

Keep the following issues active or open during the week:
1.  `recipe: add release-readiness workflow`
2.  `enhancement: support custom secret redaction patterns`
3.  `test: cover release-readiness recipe logic`
4.  `good first issue: add one more sanitized CLI example`
5.  `good first issue: improve status CLI terminal layout`

---

## Weekly Success Criteria

*   **5-7 Meaningful Commits:** Showing a continuous flow of small, reviewed improvements.
*   **Green Build:** Zero failures in local test suites and GitHub Actions CI.
*   **Fully Functional Recipe:** Users can initialize and run the `release-readiness` recipe.
*   **Robust Custom Redaction:** Custom patterns are validated, redacted, and covered by tests.
*   **Updated Docs:** Clean documentation matches the new configuration schema and recipe formats.
