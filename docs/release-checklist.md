# Release Checklist

This document provides a step-by-step checklist for maintainers before and after cutting a release for `agentflow-oss`.

## Pre-Release Verification

- [ ] **Run Offline Tests**: Ensure all core logic and offline tests pass locally.
  ```bash
  pnpm run test:offline
  ```
- [ ] **Run Secret and Privacy Scan**: Confirm no secrets, API keys, or private keywords are in the codebase.
  ```bash
  pnpm run test:secret-scan
  ```
- [ ] **Verify TypeScript Compilation**: Verify that code compiles without warnings or errors.
  ```bash
  pnpm run build
  ```
- [ ] **Check Git Status**: Ensure there are no uncommitted changes.
  ```bash
  git status --short
  ```
- [ ] **Align Documentation**: Confirm that `README.md`, `ROADMAP.md`, and help texts match the current CLI behavior and implementation.

## Tag and Push Release

- [ ] **Determine the Release Version**: Follow semantic versioning (`v0.x.y`).
- [ ] **Tag the Commit**: Create a local git tag for the version.
  ```bash
  git tag v<version>
  ```
- [ ] **Push the Tag to Remote**:
  ```bash
  git push origin v<version>
  ```

## Cut GitHub Release

- [ ] **Create GitHub Release**: Use the GitHub CLI (`gh`) to create the release with appropriate release notes.
  ```bash
  gh release create v<version> \
    --repo AlvinTsou/agentflow-oss \
    --title "v<version> - <Summary>" \
    --notes "<Release notes outlining the key features, fixes, and changes>"
  ```
- [ ] **Validate Release Runs**: Check GitHub Actions to verify that CI runs completed successfully.
