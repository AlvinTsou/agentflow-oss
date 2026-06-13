# PR Review Recipe

The `pr-review` recipe runs a three-step automated pull request review sprint:

1. `analyze-diff` summarizes changed files, modified exports, architectural scope, and risk level.
2. `review-code` audits logic, type safety, error handling, performance, security, and test coverage.
3. `generate-feedback` turns findings into a GitHub-style verdict with `[blocking]`, `[deferred]`, and `[nit]` tasks.

Use this recipe when you want a repeatable first-pass review before a human maintainer decides whether to approve or request changes.

## Initialize A Review Sprint

```bash
pnpm ag init pr-review --prefix pr-review
```

This creates a sprint directory without calling a provider. Use it to inspect the generated plan and confirm the workspace is clean before running the review.

Expected artifacts:

- `state.json`: sprint phase, current step, attempts, scores, and git checkpoint metadata.
- `events.jsonl`: append-only execution log, including route decisions when provider calls are made.
- `artifacts/`: model outputs for each recipe step.
- `.agentflow-feedback/feedback.jsonl`: maintainer approvals, requested changes, and resolved feedback records.

## Run The Review

```bash
pnpm ag run pr-review
```

The recipe injects the current git diff into the `analyze-diff` prompt through `{{GIT_DIFF}}`. Keep the branch focused before running the sprint:

- Stage or isolate only the changes that belong to the pull request.
- Remove generated noise, local logs, and private task files before review.
- Prefer small pull requests so the diff summary and line-level suggestions remain actionable.

## Interpret Output

The final report should end with a clear verdict:

- `APPROVE`: no blocking findings were detected by the review sprint.
- `REQUEST CHANGES`: at least one blocking issue requires maintainer attention.

Follow-up tasks are grouped by severity:

- `[blocking]`: must be fixed before merge.
- `[deferred]`: valid improvement that can be scheduled separately.
- `[nit]`: style or clarity issue that should not block release.

Treat the recipe output as a review assistant, not an automatic merge decision. Human maintainers remain responsible for final approval, especially for security, data migration, authentication, billing, and public API changes.

## Resume And Audit

If a sprint fails or pauses, resume it from the stored state:

```bash
pnpm ag resume sprints/<sprint-id>
```

To inspect what happened without making provider calls:

```bash
pnpm ag status sprints/<sprint-id>
pnpm ag replay sprints/<sprint-id>
```

Use `ag replay` when you need to review route metadata, warnings, policy profile decisions, and step-level audit trails after the run.
