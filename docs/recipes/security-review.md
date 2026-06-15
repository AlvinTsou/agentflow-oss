# Security Review Recipe

The `security-review` recipe runs a three-step automated security review sprint:

1. `map-security-scope` inspects the git diff, classifies touched surfaces (authentication, data access, dependencies, configuration, logging, file IO, network calls, etc.), and maps changed files to threat categories.
2. `audit-threats` audits the code changes for access-control gaps, injection risks, insecure defaults, unsafe logging, missing validation, and dependency misuse.
3. `generate-security-verdict` aggregates findings and produces a verdict (`PASS`, `PASS WITH FOLLOW-UP`, or `BLOCK`), separating mandatory fixes from hardening recommendations and listing manual verification checklists.

Use this recipe when changes affect sensitive components or when you want to enforce security policy checks.

## Initialize A Security Review Sprint

```bash
pnpm ag init security-review --prefix security-sprint
```

This initializes the sprint environment and commits files under a local git repository inside the sprint directory, tagging the starting point.

Expected artifacts in the sprint directory:

- `state.json`: sprint phase, current step, attempts, scores, and git checkpoint metadata.
- `events.jsonl`: append-only execution log with route audits and policy verdicts.
- `artifacts/`: output files from each step.

## Run The Security Review

```bash
pnpm ag run security-sprint
```

The sprint engine runs each step, injecting the git diff of your changes via `{{GIT_DIFF}}`. 

## Interpret Output

The final step `generate-security-verdict` produces the security verdict:

- `PASS`: No security issues or risks detected.
- `PASS WITH FOLLOW-UP`: Security audit identified items that require maintainer review or deferred tasks (e.g. dependency audits), but are not immediately blocking.
- `BLOCK`: High-risk issues (e.g. unsafe logging of secrets, missing authorization) were found and must be fixed.

Mandatory fixes are listed for `BLOCK` and `PASS WITH FOLLOW-UP` verdicts, along with a maintainer checklist for manual verification.

All code review summaries and outputs are designed to be public-safe.

## Resume and Inspect

If a step fails or is interrupted:

```bash
pnpm ag resume sprints/<sprint-id>
```

To view sprint logs and route decisions:

```bash
pnpm ag status sprints/<sprint-id>
```
