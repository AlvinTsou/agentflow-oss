# Architecture Status Mapping

This document maps claims from the local `agentflow-architecture-report.html`
scan against the current `agentflow-oss` source tree.

The purpose is to keep public project scope grounded in source evidence. The
HTML report describes a broader AgentFlow architecture; this repository
currently ships a maintainer workflow engine with CLI, workflow, provider
routing, checkpoint, management API, and dashboard foundations.

Last checked: 2026-06-30.

## Current Source Summary

| Area | Current source evidence | Status |
|---|---|---|
| Product identity | `README.md` positions `agentflow-oss` as a maintainer workflow engine, not a universal AI proxy or chat wrapper. | Shipped |
| Source directories | `src/artifacts`, `src/feedback`, `src/middleman`, `src/recipe`, `src/server`, `src/util`, `src/workflow`. | Shipped |
| CLI commands | `ag.ts` dispatches `init`, `run`, `resume`, `status`, `replay`, feedback commands, `smoke-test`, and `daemon`. | Shipped |
| Core runnable recipes | `ag.ts` allows direct `ag run` for `mini`, `sdd`, and `research`. | Shipped |
| Init-supported JSON recipes | `ag.ts` supports `release-readiness`, `pr-review`, `security-review`, and `api-design-review` during `init`. | Shipped |
| Provider routing | `docs/provider-routing.md` documents Claude, Codex, OpenAI-compatible, OpenRouter, and Gemini. | Shipped |
| Deferred provider variants | `docs/provider-routing.md` and `src/middleman/router.ts` mark `gemini-oauth` and `antigravity` as deferred/placeholder variants. | Deferred |
| Management server | `src/server/index.ts` implements a Hono app. | Shipped |
| Management endpoints | `GET /api/sprints`, `GET /api/sprints/:id/events`, `GET /api/sprints/:id/checkpoints`, `POST /api/sprints/:id/actions`. | Shipped |
| Dashboard UI | `ui/` contains a separate Vite React dashboard, not an inline `src/web/ui.ts`. | Shipped with different architecture |
| Streaming checkpoints | `src/workflow/streaming-checkpoint.ts` writes `streaming-checkpoints.jsonl`; `docs/management-api-contract.md` defines the dashboard-facing contract. | Shipped |
| Test inventory | `tests/` currently contains 19 `poc-*.ts` files. | Shipped |

## HTML Report Claim Mapping

| HTML report claim | Current `agentflow-oss` evidence | Status | Decision needed |
|---|---|---|---|
| AgentFlow is a governed-autonomy framework with quality loops, provider routing, state files, and gates. | `README.md`, `docs/architecture.md`, `src/workflow/`, and `src/middleman/` support this core workflow-engine claim. | Mostly aligned | Keep as project thesis, but avoid implying gateway/proxy scope. |
| CLI includes `init`, `run`, `resume`, `gate`, `status`, `replay`, `estimate`, `web`, and `middleman`. | `ag.ts` ships `init`, `run`, `resume`, `status`, `replay`, feedback verbs, `smoke-test`, and `daemon`; no `estimate`, `web`, or `middleman` subcommand is dispatched. | Partially aligned | Decide whether missing commands are future roadmap, private-only, or report drift. |
| Specialized runners include `run-source-align.ts` and `run-ebook.ts`. | Current top-level runners are `run-sprint.ts`, `run-sdd.ts`, `run-research.ts`; source-align and ebook runners are not present. | Not implemented in current OSS | Treat as out of scope unless a source-align or ebook recipe is planned. |
| Planning layer includes `plan-run.ts`, `goal-planner.ts`, and `run-controller.ts`. | No matching planning directory or files are present in current source. | Not implemented in current OSS | Decide whether planning is future workflow-engine scope or a separate product layer. |
| Core engine includes `diff-evidence.ts`, `exec-evidence.ts`, and `carry-over-memory.ts`. | Current `src/workflow/` includes `contract-gate.ts`, `readiness.ts`, `state-store.ts`, `sprint-engine.ts`, and related workflow files; those named modules are not present. | Partially aligned by concept, not by module | Keep current module names in docs; do not cite missing filenames as shipped. |
| Middleman ships 7 providers, including Gemini OAuth and Antigravity. | Provider docs list 5 supported providers; `gemini-oauth` and `antigravity` are documented as deferred and implemented as placeholders for custom override. | Overstated | Keep public provider list at 5 until real adapters ship. |
| Middleman gateway exposes OpenAI-compatible `/v1/chat/completions`, `/v1/models`, and `/v1/messages`. | Current server exposes sprint management endpoints under `/api`; no `/v1/*` gateway endpoints are present. | Not implemented in current OSS | Explicitly decide whether gateway/proxy belongs in this repo, a sibling repo, or future roadmap. |
| Policy profiles include `default`, `strict`, `local-only`, `enterprise-redact`, and `off`. | `docs/provider-routing.md` documents `default`, `strict`, and `off`; current policy docs also cover custom redactions. | Overstated | Do not document `local-only` or `enterprise-redact` as current unless implemented. |
| Observability modules include `cost-forecast.ts`, `forecast-gate.ts`, `cost-drift.ts`, `cost-table.ts`, and `cost-governance.ts`. | No matching `src/observability/` directory or named files are present. Cost/tokens are tracked in workflow/provider results and management summaries. | Not implemented as reported | Decide whether cost observability is future dashboard scope or separate gateway scope. |
| Web dashboard is `src/web/` with inline `ui.ts` and SSE endpoints. | Current backend is `src/server/index.ts`; current frontend is a separate Vite React app under `ui/`; events/checkpoints are polled over REST. | Shipped with different architecture | Update any public architecture docs to name Hono + Vite React, not inline `src/web`. |
| PR delivery lives in `src/pr/` with finalize, deliver, and preflight modules. | No `src/pr/` directory is present. PR/security/api-design review exist as recipes and docs, not a delivery pipeline. | Not implemented in current OSS | Do not imply automatic PR creation unless a PR delivery feature is scoped. |
| Sprint directories contain `state.json`, `events.jsonl`, `summary.json`, `carry-over.json`, config, artifacts, and feedback. | `src/workflow/sprint-engine.ts` writes `summary.json` and `carry-over.json`; docs describe `state.json`, `events.jsonl`, artifacts, and feedback ingestion. | Mostly aligned | Keep, but use `.agentflow-feedback/` for feedback rather than `.agentflow-web/` unless a web audit store is added. |
| Event types total 23. | Current events are TypeScript types and emitted records in `src/workflow/state-store.ts` and workflow code; no verified public count is maintained here. | Unverified | Avoid publishing a count unless generated from source. |
| Built-in recipes total 5: `mini`, `sdd`, `source-align`, `ebook`, `research`. | Current direct-run recipes are `mini`, `sdd`, `research`; JSON recipes add review-oriented workflows. No `source-align` or `ebook` recipe is present. | Overstated | Document recipe categories as current direct-run TS recipes plus init-supported JSON recipes. |
| Tests include 109 `poc-*.ts` files. | Current count is 19 `tests/poc-*.ts` files. | Overstated | Do not cite 109 unless importing historical/private tests. |
| Project has 70+ source files and 9 source directories. | Current `src/` count is 36 files across 7 child directories. | Overstated | Keep source metrics generated from current tree only. |

## Recommended Treatment

Use this repository as the source of truth for shipped `agentflow-oss`
capabilities. Treat the HTML report as one of:

1. A target architecture draft, if the broader gateway/proxy direction is still
   intended.
2. A private/full AgentFlow architecture snapshot, if it describes a larger
   codebase outside this public repo.
3. A stale report that should be corrected before external circulation.

The next architecture decision should separate workflow-engine scope from
gateway/proxy scope. In current source, `agentflow-oss` clearly ships the
workflow-engine side; `/v1/*` gateway endpoints, cost observability modules,
planning controllers, and automatic PR delivery are not current OSS features.
