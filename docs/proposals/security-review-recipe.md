# Proposal: Security Review Recipe

This document scopes a future built-in recipe named `security-review`. It is a proposal only; it should not be treated as implemented until the recipe, fixtures, and offline tests are added.

## Objective

Provide a repeatable security-focused review sprint for changes that affect authentication, authorization, secrets handling, input validation, dependency boundaries, deployment configuration, or data exposure.

## Non-Goals

- Do not replace a professional security audit.
- Do not claim vulnerability detection coverage beyond the encoded rubric and fixtures.
- Do not call external scanners by default.
- Do not send private credentials, production logs, customer data, or proprietary incident artifacts to a provider.

## Proposed Workflow

1. `map-security-scope`
   - Inspect the diff and classify touched surfaces: auth, data access, dependencies, configuration, logging, file IO, network calls, or public API behavior.
   - Produce a concise risk map with changed files and likely threat categories.

2. `audit-threats`
   - Review the changed code for access-control gaps, injection risks, insecure defaults, unsafe logging, missing validation, and dependency misuse.
   - Emit findings with file references, severity, exploit preconditions, and suggested fixes.

3. `generate-security-verdict`
   - Aggregate findings into `PASS`, `PASS WITH FOLLOW-UP`, or `BLOCK`.
   - Separate mandatory fixes from hardening recommendations.
   - Include a maintainer checklist for manual verification.

## Proposed Rubric

- Correctly identifies security-relevant files and changed trust boundaries.
- Flags high-risk areas without overstating unproven vulnerabilities.
- Distinguishes exploitable bugs from hardening suggestions.
- Requires tests or manual verification for any blocking claim.
- Keeps all examples and artifacts public-safe.

## Test Plan

Before implementation, add offline fixtures for:

- Clean configuration-only changes that should pass.
- Unsafe logging of sensitive values that should block.
- Missing authorization checks in a route handler that should block.
- Dependency or config changes that should produce follow-up items.

The fixture suite should run under `pnpm run test:offline` without network calls.

## Documentation Plan

- Add `docs/recipes/security-review.md` after implementation.
- Link the recipe from `docs/cli-reference.md` when `init` and `run` support it.
- Add sanitized examples that show verdict categories without exposing real incidents.

## Open Questions

- Whether the recipe should require explicit opt-in for broader file reads beyond `git diff`.
- Whether route policy should default to `strict` for this recipe.
- Whether security findings should create maintainer feedback records automatically or only generate an artifact.
