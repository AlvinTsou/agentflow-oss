# Roadmap

This document outlines the current scope, planned features, and future
direction for agentflow-oss. Timelines are estimates, not commitments.

## v1.0 -- Core Engine (Current)

The v1.0 release focuses on delivering a stable, CLI-only workflow engine
with the foundational components needed for maintainer-driven AI-assisted
development.

### Scope

- **CLI runner:** `init`, `run`, `resume`, `status`, `replay`, `approve`,
  `request-changes`, `force-pass`, `resolve`.
- **Sprint engine:** Full step execution with state persistence
  (`state.json` + `events.jsonl`).
- **Quality loop:** Produce/review/fix cycle with configurable score
  thresholds and max repeat limits.
- **Readiness pipeline:** Carry-over extraction (blocking/deferred/nit) from
  review and wrap artifacts, with readiness report generation.
- **Contract gate:** `agentflow-contract` blocks in INPUT.md that mandate
  specific literals or fields in step output.
- **Git checkpoint:** Per-sprint local repository with tagged commits per step.
- **Recipes:**
  - `mini` -- 4-step self-test for installation verification.
  - `research` -- 6-step structured research report.
  - `sdd` -- 9-step spec-driven development workflow.
- **Providers:**
  - Claude (`ANTHROPIC_API_KEY`)
  - Codex (`OPENAI_API_KEY` + Codex CLI)
  - OpenAI-compatible (`OPENAI_API_KEY` + `OPENAI_BASE_URL`)
  - OpenRouter (`OPENROUTER_API_KEY`)
  - Gemini (`GEMINI_API_KEY`)
- **Gateway smoke test:** Pre-flight check command (`ag smoke-test`) that verifies connectivity and credential validity against an OpenAI-compatible gateway.
- **Artifact IO:** Frontmatter-based markdown artifacts with structured
  metadata.
- **Feedback ingestion:** File-based feedback from `.agentflow-feedback/`
  directory.
- **Provider capability registry:** A declarative registry that maps provider names to their supported features (streaming, tool-calls, json-response, smoke-test, token-limits, timeout, etc.) to validate requests before dispatch.
- **Capability validation & route metadata:** Automatically validates requests against provider capabilities, handles streaming fallback with warnings, and returns detailed route decisions in `StepResult`.
- **Security profiles & route audit:** Named policy profiles (`default`, `strict`, `off`) that govern prompt scanners for secret redaction or blocking, and logs route decisions to sprint events (`events.jsonl`).
## v1.1 -- Release Readiness & Custom Redaction (Completed)

This minor release introduces maintainer utility workflows and policy customization.

- **Release readiness recipe:** A built-in workflow recipe that audits a repository for release readiness: changelog completeness, version bumps, dependency freshness, and documentation coverage.
- **Custom secret redaction profiles:** Support for developer-defined custom regex patterns inside middleman policies to scrub proprietary credentials or keys.

## v1.2 -- Maintenance & CLI Usability (Completed)

This release focuses on hardening existing recipes, improving CLI readability, and integrating policy configuration.

- **PR review recipe proposal:** Proposed structured review steps and rubrics for pull request code reviews.
- **Release-readiness hardening:** Hardened edge cases in release-readiness recipe runner.
- **Route audit replay formatting:** Enhanced replay formatting to print route decisions, warnings, matched rules, and policy profiles.
- **CLI layout improvements:** Aligned labels and improved formatting of status reports for terminal readability.
- **Custom redaction config integration:** Dynamically load and validate policy profiles and custom redactions from `agentflow.config.json`.

## v1.3 -- PR Review Workflow (Completed)

This release implements a production-grade automated code review workflow that integrates git diff changes into LLM prompt contexts.

- **PR review recipe implementation:** Expose a fully working `pr-review` JSON recipe for automated pull request audits.
- **Git diff context ingestion:** Support dynamic substitution of the `{{GIT_DIFF}}` placeholder with the sprint's code diff relative to initialization.
- **Offline test suite validation:** Implement comprehensive mock fixture tests validating clean and buggy PR paths under offline conditions.

## v1.4 -- Security Review Workflow (Completed)

This release implements a specialized security audit review recipe to analyze touched security surfaces and enforce policies.

- **Security review recipe implementation:** Expose a fully working `security-review` JSON recipe for auditing code changes.
- **Offline mock validation:** Support four offline scenarios (clean config, unsafe logging, missing authorization, dependency change) under test coverage.
- **Recipe documentation:** Documented security workflow steps and verdict guidelines.

## Future

These items are on the long-term radar but not yet scoped in detail.

### Web UI

A web-based interface for managing sprints, reviewing artifacts, and
monitoring workflow progress. This will be developed as a separate module
and will not affect the CLI-first architecture.

- Sprint dashboard with real-time status.
- Side-by-side artifact diff viewer.
- Inline approval and change-request interface.
- Feedback submission through the browser.

### Additional Recipes

Community-contributed recipes for specialized workflows:

- API design review.
- Database migration planning.
- Test coverage gap analysis.
- Documentation generation from code.
- Onboarding guide creation.

### Engine Extensions

- **Parallel step execution** for independent steps within a recipe.
- **Remote state store** for team-based sprint management.
- **Webhook notifications** for sprint state transitions.
- **Plugin system** for custom quality loop scorers and readiness analyzers.

---

To suggest a feature or discuss the roadmap, please open a GitHub issue
with the `enhancement` label.
