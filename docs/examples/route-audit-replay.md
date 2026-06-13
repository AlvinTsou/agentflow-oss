# Route Audit Replay Example

`ag replay` renders `events.jsonl` without making provider calls. When a sprint used middleman routing, replay output includes route decisions so maintainers can audit which provider, model, rule, and policy profile were used.

## Command

```bash
pnpm ag replay sprints/example-pr-review
```

## Sanitized Output

```text
Sprint: example-pr-review

[phase] analyze-diff
  route:
    provider: claude
    model: claude-sonnet
    reason: explicit step provider
    policyProfile: default
    warnings: none

[phase] review-code
  route:
    provider: claude
    model: claude-sonnet
    reason: explicit step provider
    policyProfile: default
    warnings:
      - requested streaming was disabled because provider route selected non-streaming execution

[phase] generate-feedback
  route:
    provider: claude
    model: claude-sonnet
    reason: explicit step provider
    policyProfile: default
    warnings: none
```

## Review Checklist

- Confirm every model call has a visible `provider` and `model`.
- Confirm `reason` explains why the route was selected.
- Confirm `policyProfile` matches the expected security posture for the repository.
- Investigate any `warnings` before treating the sprint as release evidence.
- Keep replay examples sanitized. Do not commit real prompts, proprietary diffs, provider keys, or customer data.

This example is intentionally small. Real sprint logs may include additional phase events, scores, feedback gates, git checkpoint tags, and artifact paths.
