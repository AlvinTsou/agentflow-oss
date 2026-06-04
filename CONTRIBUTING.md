# Contributing to agentflow-oss

Thank you for considering a contribution to agentflow-oss. This document
explains how to set up your development environment, run tests, and submit
changes.

## Prerequisites

- **Node.js 22+** (LTS recommended)
- **pnpm** (latest stable)
- **tsx** for running TypeScript directly

```bash
# Verify your environment
node --version    # v22.x or later
pnpm --version    # 9.x or later
```

## Development Setup

```bash
# Clone the repository
git clone https://github.com/agentflow-oss/agentflow-oss.git
cd agentflow-oss

# Install dependencies
pnpm install
```

## Running Tests

The project includes several test targets. All tests should pass before
submitting a pull request.

```bash
# Type-check the entire project (no emit)
pnpm exec tsc --noEmit

# Run offline tests (no API keys required)
pnpm test:offline

# Run the secret-scan test (verifies no secrets are committed)
pnpm test:secret-scan
```

**Offline tests** exercise the workflow engine, recipe parsing, artifact IO,
readiness scoring, and contract gate logic without making any model calls.

**Secret-scan tests** verify that API keys, tokens, and other sensitive values
are not present in committed files.

## Code Style

- TypeScript in **strict mode** (`"strict": true` in `tsconfig.json`).
- No `any` types unless absolutely necessary and documented with a comment.
- Prefer explicit return types on exported functions.
- Use `readonly` where possible.
- Imports should be organized: Node built-ins first, then external packages,
  then internal modules.
- File names use kebab-case (e.g., `quality-loop.ts`, `state-store.ts`).

There is no auto-formatter enforced at this time. Please match the style of
surrounding code.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add openrouter provider support
fix: correct score parsing for multi-line review output
docs: update provider routing documentation
test: add offline tests for readiness scoring
chore: bump dependencies
```

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. **Make your changes.** Keep PRs focused -- one feature or fix per PR.
3. **Add tests** for new functionality. All existing tests must continue to pass.
4. **Update documentation** if your change affects user-facing behavior, CLI
   commands, configuration, or the architecture.
5. **Run the full test suite** before pushing:
   ```bash
   pnpm exec tsc --noEmit
   pnpm test:offline
   pnpm test:secret-scan
   ```
6. **Open a pull request** against `main`. Include:
   - A clear description of what the PR does and why.
   - Links to any related issues.
   - Screenshots or command output if applicable.
7. **Address review feedback.** Maintainers may request changes before merging.

## Issue Reports

When filing an issue, please include:

- **agentflow-oss version** (`pnpm exec ag --version`)
- **Node.js version** (`node --version`)
- **Operating system** and version
- **Steps to reproduce** the issue
- **Expected behavior** vs. **actual behavior**
- **Relevant logs or error output** (redact any secrets)

## Suggested Issue Labels

If you are a maintainer setting up issue tracking, consider these labels:

| Label | Description |
|-------|-------------|
| `bug` | Something is not working as expected |
| `enhancement` | New feature or improvement |
| `documentation` | Documentation improvements |
| `good first issue` | Suitable for new contributors |
| `provider` | Related to a specific model provider |
| `recipe` | Related to recipe definitions |
| `workflow-engine` | Related to the core sprint/step engine |

## License

By contributing to agentflow-oss, you agree that your contributions will be
licensed under the [Apache License 2.0](LICENSE).
