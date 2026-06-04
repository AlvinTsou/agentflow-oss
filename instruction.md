# AgentFlow OSS Active Maintenance Instructions

This document is the operating guide for keeping `agentflow-oss` visibly active,
credible, and useful as a public open-source project.

The goal is not to manufacture noise. The goal is to keep a steady trail of
real maintenance: passing CI, small improvements, open issues, releases, and
clear maintainer notes.

## Repository Snapshot

- GitHub repo: https://github.com/AlvinTsou/agentflow-oss
- Default branch: `main`
- License: `Apache-2.0`
- Package manager: `pnpm`
- Runtime target: Node.js `>=22`
- Main validation command: `pnpm run test`
- CI workflow: `.github/workflows/ci.yml`
- Public positioning: maintainer workflow engine for repeatable AI-assisted
  coding, review gates, readiness checks, provider routing, sprint state, and
  carry-over workflows.

## Maintenance Principles

1. Keep activity meaningful.
   Each commit should improve docs, tests, examples, CI, issue quality, or the
   core workflow engine.

2. Prefer small, reviewable changes.
   A steady stream of small improvements is more credible than large unrelated
   rewrites.

3. Keep private context out.
   Do not commit `.env`, logs, local paths, private sprint artifacts, customer
   names, internal task notes, or generated work directories.

4. Keep CI green.
   Every public branch and PR should pass `pnpm run test`.

5. Maintain public signals.
   The README, roadmap, issues, releases, and CI badge should tell the same
   story: this is an active maintainer tool.

## Weekly Maintenance Loop

Run this once or twice per week.

```bash
cd agentflow-oss
git status --short --branch
pnpm run test
pnpm run test:secret-scan
```

Then choose one small maintenance task:

- Improve one README section.
- Add or refine one usage example.
- Add one focused fixture or test.
- Convert a roadmap item into a GitHub issue.
- Close or update one issue with status.
- Cut a patch release if there are user-visible changes.

After the change:

```bash
git diff --check
pnpm run test
git add .
git commit -m "<clear maintenance message>"
git push origin main
gh run list --repo AlvinTsou/agentflow-oss --limit 3
```

Expected result:

- GitHub Actions shows a recent successful `CI` run.
- The repository contribution graph shows real activity.
- The commit history shows understandable project maintenance.

## Monthly Maintenance Loop

Run this once per month.

1. Review `ROADMAP.md`.
   Move completed items into release notes or mark them done in issues.

2. Review `README.md`.
   Confirm Quick Start commands still work and match the CLI.

3. Review `SECURITY.md`.
   Confirm reporting instructions and supported versions are still accurate.

4. Review `CONTRIBUTING.md`.
   Confirm setup, test, branch, and PR guidance still match the repo.

5. Review GitHub Issues.
   Keep at least a few clear open issues:
   - `good first issue`
   - `documentation`
   - `enhancement`
   - `ci`
   - `roadmap`

6. Review GitHub Actions.
   Confirm the latest default-branch CI run is green.

7. Consider a release.
   If there were visible improvements, cut a GitHub release.

## GitHub Issues Strategy

Keep issues specific and maintainer-friendly.

Good issue examples:

- Add a minimal demo sprint transcript to README
- Add CLI examples for `approve`, `request-changes`, and `resolve`
- Add a fixture for readiness reports with deferred carry-overs
- Improve provider-routing documentation for local OpenAI-compatible endpoints
- Add a release checklist for maintainers

Avoid vague issues:

- Make it better
- Add AI
- Improve everything
- Refactor core

Suggested labels:

- `good first issue`
- `documentation`
- `enhancement`
- `bug`
- `ci`
- `roadmap`
- `security`

Issue maintenance method:

```bash
gh issue list --repo AlvinTsou/agentflow-oss
gh issue create --repo AlvinTsou/agentflow-oss \
  --title "Add CLI examples for feedback commands" \
  --label documentation \
  --body "Document approve, request-changes, force-pass, and resolve with small examples."
```

## Pull Request Strategy

Use PRs for non-trivial changes, even if you are the only maintainer.

Good PR size:

- One doc topic
- One command improvement
- One test fixture family
- One CI improvement
- One bug fix

Before opening a PR:

```bash
pnpm run test
pnpm run test:secret-scan
git diff --check
```

PR checklist:

- CI passes.
- README/docs still match real commands.
- No private files or local-only paths are included.
- New behavior has a focused test or fixture update.

## Release Strategy

Use releases to show project milestones.

Initial release:

- Tag: `v0.1.0`
- Title: `v0.1.0 - Public core release`
- Notes should mention:
  - Apache-2.0 public extraction
  - Sprint engine
  - Provider routing
  - Quality loop
  - Readiness reports
  - Feedback records
  - Secret/privacy scan
  - GitHub Actions CI

Release command:

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 \
  --repo AlvinTsou/agentflow-oss \
  --title "v0.1.0 - Public core release" \
  --notes "Initial public release of AgentFlow OSS: maintainer workflow engine with sprint state, provider routing, quality gates, readiness reports, feedback records, tests, secret/privacy scan, and CI."
```

Patch release cadence:

- Use `v0.1.1`, `v0.1.2`, etc. for small fixes.
- Use `v0.2.0` when adding visible new workflow capabilities.
- Avoid releases with no meaningful change.

## CI Maintenance

CI should stay simple and reliable.

Current workflow responsibilities:

- Checkout repo
- Setup `pnpm`
- Setup Node.js `22`
- Install dependencies with frozen lockfile
- Run `pnpm run test`

Do not add provider-backed tests to default CI unless they are optional and
properly skipped without secrets. The default public CI should remain runnable
without API keys.

If CI fails:

1. Open the failed run.
2. Identify whether failure is install, TypeScript, offline test, or secret scan.
3. Reproduce locally with the same command.
4. Fix in a small commit.
5. Push and confirm GitHub Actions is green.

Useful commands:

```bash
gh run list --repo AlvinTsou/agentflow-oss --limit 5
gh run view --repo AlvinTsou/agentflow-oss --log
gh run watch --repo AlvinTsou/agentflow-oss --exit-status
```

## Secret And Privacy Hygiene

Always run this before pushing public changes:

```bash
pnpm run test:secret-scan
```

The secret scan also checks for private project names, local machine paths,
private sprint prefixes, and common secret value shapes. When touching docs,
fixtures, or imported artifacts, keep the pattern list in
`tests/secret-scan.ts` updated instead of pasting sensitive strings into public
documentation.

```bash
pnpm run test:secret-scan
```

If this finds anything:

- Remove the private detail.
- Replace domain-heavy examples with neutral workflow examples.
- Re-run `pnpm run test`.
- Re-run the scan.

## README Maintenance

README should always answer:

- What is this?
- Who is it for?
- How do I install it?
- How do I run the offline tests?
- How do I create and run a sprint?
- What commands exist?
- What is intentionally out of scope?

Keep the CI badge near the top:

```md
[![CI](https://github.com/AlvinTsou/agentflow-oss/actions/workflows/ci.yml/badge.svg)](https://github.com/AlvinTsou/agentflow-oss/actions/workflows/ci.yml)
```

After changing CLI behavior, update:

- `README.md`
- `docs/maintainer-workflows.md`
- `CONTRIBUTING.md` if setup or validation changes
- Tests or fixtures if command behavior changed

## Demo And Screenshot Work

For a stronger public repo, add one simple demo artifact.

Good demo options:

- A terminal screenshot showing `pnpm run test` passing.
- A short GIF showing `pnpm ag init sdd --input INPUT.md --prefix demo`.
- A sample `sprints/demo-*` transcript converted into a sanitized markdown
  document, not committed as raw runtime state.

Important:

- Do not commit actual private sprint directories.
- Do not include API keys, local usernames, private project names, or model logs
  containing sensitive prompt data.
- Prefer sanitized docs under `docs/examples/`.

## Roadmap Maintenance

Keep roadmap items concrete.

Good roadmap item:

```md
- Add sanitized demo sprint walkthrough under `docs/examples/`.
```

Poor roadmap item:

```md
- Make AgentFlow better.
```

Every roadmap item should be convertible into an issue or PR.

Suggested near-term roadmap:

1. Add `docs/examples/basic-sdd-sprint.md`.
2. Add a CLI command reference table generated from current help text.
3. Add a minimal release checklist.
4. Add optional provider smoke-test docs.
5. Add more neutral readiness fixtures.

## OpenAI Codex For Open Source Follow-Up

Because this repo was used for the Codex for Open Source application, keep the
public surface stable during review.

Recommended review-period behavior:

- Keep CI green.
- Make small docs/test improvements weekly.
- Avoid large rewrites that make the repo look unstable.
- Keep issues and roadmap tidy.
- Do not force-push `main`.
- Do not delete release tags.
- Keep `README.md` and `ROADMAP.md` aligned with actual repo behavior.

If OpenAI asks for proof of maintainership:

- GitHub repo owner: `AlvinTsou`
- Public repo URL: https://github.com/AlvinTsou/agentflow-oss
- Default branch: `main`
- License: `Apache-2.0`
- CI: GitHub Actions `CI`
- Maintainer docs: `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`,
  `docs/maintainer-workflows.md`

## What Counts As Healthy Activity

Healthy activity:

- Passing CI on `main`
- New issues with clear scope
- PRs linked to issues
- Documentation updates matching real commands
- Release notes
- Test and fixture improvements
- Security scan improvements

Weak activity:

- Empty commits
- Formatting-only churn with no reason
- Changing files only to bump contribution graphs
- Large unreviewed rewrites
- Issues with no actionable scope

## Emergency Checklist

If a private artifact or secret is accidentally pushed:

1. Immediately make the repo private if possible.
2. Revoke the leaked credential.
3. Remove the artifact in a cleanup commit.
4. If the secret is in history, rotate it anyway; do not rely only on deletion.
5. Consider history rewrite only after understanding the impact.
6. Add a secret-scan regression test or pattern.
7. Document the incident in a private note, not in public issue text if it
   exposes more sensitive details.

## Quick Active-Maintenance Session Template

Use this when doing a short maintenance pass:

```bash
cd agentflow-oss
git pull --ff-only
git status --short --branch
pnpm run test

# Make one small docs/test/issue/release improvement.

pnpm run test:secret-scan
git diff --check
git status --short
git add .
git commit -m "<maintenance change>"
git push origin main
gh run watch --repo AlvinTsou/agentflow-oss --exit-status
```

End state should be:

- Local branch is clean.
- Remote `main` has the latest commit.
- Latest GitHub Actions run is successful.
- The change has an obvious maintenance purpose.
