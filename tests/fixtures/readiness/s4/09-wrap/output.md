<!--agentflow
{
  "step": "wrap",
  "sprint": "maintainer-s4-intent-1780311766016",
  "score": 9,
  "attempts": 2,
  "provider": "claude",
  "generated_at": "2026-06-01T18:07:59.068Z"
}
-->
## What shipped

All five tickets from the decomposition (T1–T5) have dev iterations; no ticket is unimplemented. **T1** shipped a plain TypeScript `WorkflowContext` interface with exactly five required fields (`orgId`, `workspaceId`, `resourceId` as `string`; `seats` as `number[]`; `actorRole` as `'EDITOR' | 'REVIEWER' | 'ADMIN'`), no optional members, and no methods (score 10, 1 attempt). **T2** shipped `LlmProviderError extends Error` with `public readonly cause?: unknown`, explicit `this.name = 'LlmProviderError'` in the constructor body, and no cause-scrubbing (score 10, 1 attempt). **T3** shipped `IntentParserService` as a NestJS injectable with a `buildPrompt` helper embedding all five context fields, a 30-second `AbortController` timeout, correct `LlmProviderError` throws for HTTP 429, HTTP 5xx, network errors, and aborts, and null/empty-body handling — but also an `extractLlmContent` helper that unwraps an Worker-style `choices[0].message.content` envelope and a downstream `JSON.parse` on any string content before returning; both are structural transformations the review flagged as blocking violations of the raw-output contract (score 10, 1 attempt). **T4** shipped `WorkflowService.parseIntent` with exactly one module-level `CONFIDENCE_THRESHOLD = 0.7` constant, a `MARKDOWN_FENCE_RE` regex, the six-step processing pipeline in the required order, a `takeFailurePath` closure that fires `writeWorkflowRow({ actorId, transcript, actionStatus: 'MODEL_FAILED' })` and suppresses both synchronous and asynchronous audit throws, and a `{ type: 'AMBIGUOUS_INTENT', candidates: [] }` degraded return (score 10, 1 attempt). **T5** shipped across six files — `ParseIntentDto`/`WorkflowContextDto` with class-validator decorators and a trim `@Transform`, `SessionAuthGuard` delegating to Passport `'session'`, `RolesGuard` reading `ROLES_KEY` metadata, `WorkflowValidationExceptionFilter` catching `BadRequestException` and writing `VALIDATION_FAILED`, `WorkflowController` with `RISK_LEVEL` import, exhaustive `CONFIRMATION_TYPE_MAP`, SHA-256 idempotency key, suppressed `SUCCESS` audit write, and `WorkflowModule` wiring — plus a revised `WorkflowService` excerpt whose listing is truncated (the file begins mid-method at `orId, transcript);`) and which returns `ParseIntentResult { intent, confidence? }` rather than the bare `Promise<WorkflowAction>` defined in T4, creating a signature conflict; the review additionally flagged the filter's missing `try/catch` around the initial `writeWorkflowRow` call and the empty-string `targetId` placeholder in the idempotency formula as blocking findings (score 10, 2 attempts; overall review verdict: REQUEST CHANGES).

---

## Success criteria check

| # | Criterion | Status | Reason |
|---|-----------|--------|--------|
| 1 | `parse('advance the blinds', ctx)` returns raw JSON exactly as received from the LLM | PARTIAL | T3 unwraps `choices[0].message.content` and parses string content before returning; structural-transformation contract violated (blocking review finding) |
| 2 | `parse('seat four rebuy', ctx)` returns raw rebuy JSON when seat 4 present in `ctx.seats` | PARTIAL | Same raw-output violation as #1; core LLM call and credential handling are present |
| 3 | Homophone ambiguity returns `AMBIGUOUS_INTENT`; empty `seats` does not short-circuit the LLM call | PARTIAL | `buildPrompt` includes empty seats as `'none'` with no short-circuit guard; but raw-output contract breach means the returned value may not match what the LLM emitted verbatim |
| 4 | LLM HTTP 429 or any unavailability throws `LlmProviderError`; no credential in logs or response | MET | T3 throws `LlmProviderError('Rate limit exceeded (HTTP 429)', { httpStatus: 429 })`; API key never appears in the error payload; network and abort paths handled correctly |
| 5 | `WorkflowService.parseIntent` always resolves to a valid `WorkflowAction`; never throws | MET | T4 wraps every step in try/catch; `takeFailurePath` suppresses synchronous audit throws; every code path resolves |
| 6 | Schema failure, fenced JSON, `LlmProviderError`, and sub-threshold confidence each degrade to `AMBIGUOUS_INTENT` + `MODEL_FAILED` audit; no exception propagates | MET | T4 covers all four paths; audit errors swallowed via `.catch(() => {})` and synchronous guard in `takeFailurePath` |
| 7 | `REVIEWER` + `'advance the blinds'` → HTTP 200 with `riskTier: 'MEDIUM'` and `confirmationType: 'COUNTDOWN_MODAL'` | PARTIAL | `CONFIRMATION_TYPE_MAP` and `RISK_LEVEL` lookup are present in T5 controller; T5's `WorkflowService` signature conflict with T4 makes the end-to-end pipeline non-compilable as written |
| 8 | Whitespace-only `transcript` → HTTP 400 `{ code: 'EMPTY_TRANSCRIPT' }`, no LLM call, `VALIDATION_FAILED` audit row written | PARTIAL | Trim + `@IsNotEmpty()` decorator and exception filter are present; filter does not wrap the initial `writeWorkflowRow` call in `try/catch`, so a synchronous throw escapes and can prevent the 400 response (blocking review finding) |
| 9 | Non-UUID context fields → HTTP 400 `{ code: 'INVALID_CONTEXT' }` before any service method is invoked | PARTIAL | `@IsUUID('4')` decorators on `WorkflowContextDto` and exception filter code-path present; same synchronous-throw gap as #8 |
| 10 | `REJECTED_ACTION` → HTTP 200, `riskTier: 'LOW'`, `confirmationType: 'NONE'` | MET | T5 `CONFIRMATION_TYPE_MAP` maps `REJECTED_ACTION → 'NONE'`; `RISK_LEVEL['REJECTED_ACTION']` sourced from `packages/core-schema` |
| 11 | All LLM failure paths → HTTP 200 with `AMBIGUOUS_INTENT`; no HTTP 500 | MET | T4 never-throw guarantee combined with T5 controller passing the result through without re-throwing |
| 12 | No session → HTTP 401; wrong-role session → HTTP 403 | MET | T5 declares `@UseGuards(SessionAuthGuard, RolesGuard)` in that order; guards fire before `ValidationPipe` and before the controller body |
| 13 | `riskTier` sourced exclusively from `RISK_LEVEL` imported from `packages/core-schema`; no local copy in this module | MET | T5 controller imports `{ RISK_LEVEL }` from `packages/core-schema` and uses it directly; no local shadow declared |
| 14 | Every request path — validation rejection, LLM failure, successful parse — produces an audit row | PARTIAL | Three paths covered in code (T4 `MODEL_FAILED`, T5 filter `VALIDATION_FAILED`, T5 controller `SUCCESS`); filter synchronous-throw gap and T5/T4 signature conflict leave the path unverified end-to-end |
| 15 | Idempotency key present in every HTTP 200 response | PARTIAL | Key computed via `createHash('sha256')` and included in every `ParseIntentResponse`; `targetId` component is an empty-string placeholder explicitly noted as not shippable against the final acceptance criteria |

---

## Open follow-ups

**Tickets with no implementation iteration:** None — all five tickets have dev iterations.

**Carry-over from review — blocking (must be resolved before shipping):**

- **T3 — raw-output contract breach:** Remove `extractLlmContent` and the downstream `JSON.parse` on string content. `IntentParserService.parse` must return the response body (or inner string content) exactly as received, without envelope unwrapping or JSON parsing; both transformations belong exclusively in `WorkflowService.parseIntent`.
- **T5 — `WorkflowService` signature conflict:** T5 introduces a revised `WorkflowService` returning `ParseIntentResult { intent, confidence? }` rather than the bare `Promise<WorkflowAction>` mandated by T4. One canonical signature must be chosen; the T5 controller's destructure of `{ intent, confidence }` is incompatible with the T4 implementation as written.
- **T5 — `WorkflowValidationExceptionFilter` synchronous-throw gap:** The initial `this.auditService.writeWorkflowRow(…).catch(…)` call is not wrapped in `try/catch`; a synchronous throw from `writeWorkflowRow` escapes the filter and can prevent the HTTP 400 from being sent. Wrap to match the suppression pattern used in T4's `takeFailurePath`.
- **T5 — `targetId` placeholder:** The empty-string `TARGET_ID_PLACEHOLDER` in the idempotency formula is non-shippable. The open question — `workspaceId`, `resourceId`, affected `playerId`, or a composite — must be resolved before this ticket closes.

**Carry-over from review — nit (non-blocking, address before next sprint):**

- **T5 — `confidence: NaN` in response body:** T4 correctly treats `NaN` as absent for degradation purposes; T5's controller will include `confidence: NaN` in `ParseIntentResponse` if the provider emits it and Zod passes the intent. Whether to filter `NaN` from the response should be specified.
- **T5 — `CONFIRMATION_TYPE_MAP` exhaustiveness enforcement:** The type `Record<WorkflowAction['type'], ConfirmationType>` provides compile-time coverage but relies on `packages/core-schema` keeping `WorkflowAction['type']` in sync without a build-time alert if a new intent type is added. Document this dependency explicitly.

**Unresolved open questions (all blocking before the sprint can close):**

- `targetId` component of the idempotency formula — `workspaceId`, `resourceId`, affected `playerId`, or composite?
- `actorId` session claim name — `sub`, `userId`, or another claim? Must be resolved against `SessionStrategy.validate()` output shape.
- Minimum non-nullable field set for partial audit rows (validation-failure and LLM-failure paths) — resolve against S2 `WorkflowAuditEntry`.
- LLM provider and model selection — `IntentParserService` currently uses bare `fetch` against a configurable base URL; SDK dependencies and prompt format are provider-specific.
- `confidence` field name in the LLM response payload — where in the returned JSON object is the score expected?
- `confidence` threading from `WorkflowService.parseIntent` to the controller — if `Promise<WorkflowAction>` is kept as the canonical return type, a supplementary mechanism is needed to surface the score.
- Sprint split contingency trigger ownership — the brief describes a contingency to subdivide the HTTP endpoint ticket if iteration stalls below score 7, but does not specify whether the split decision is triggered automatically by a pipeline rule or manually by a human engineer.

---

## Audit trail

- **discuss** — Sprint problem statement, scope boundaries, and open-question catalogue; see `artifacts/s4/discuss.md`.
- **explore** — Codebase survey of `packages/core-schema` exports (`WorkflowActionSchema`, `RISK_LEVEL`, `RiskLevel`, `WorkflowAction`), S2 `AuditService.writeWorkflowRow` signature, and `SessionAuthGuard`/Passport wiring; see `artifacts/s4/explore.md`.
- **prototype** — Proof-of-concept for `IntentParserService` fetch loop, 30-second timeout, and `LlmProviderError` mapping; see `artifacts/s4/prototype.md`.
- **spec** — Per-ticket acceptance criteria, signature contracts, boundary conditions, and out-of-scope declarations; see `artifacts/s4/spec.md`.
- **usage** — Downstream consumption sketch showing how S5 `WorkflowService.execute` reads `WorkflowAction` and the idempotency key; see `artifacts/s4/usage.md`.
- **tkt** — Full five-ticket decomposition (T1–T5) with signatures, acceptance criteria, and out-of-scope lists; see `artifacts/s4/tkt.md`.
- **dev / T1** — `WorkflowContext` interface; score 10, 1 attempt; see `artifacts/s4/dev/t1/`.
- **dev / T2** — `LlmProviderError` class; score 10, 1 attempt; see `artifacts/s4/dev/t2/`.
- **dev / T3** — `IntentParserService.parse`; score 10, 1 attempt; raw-output contract violation flagged post-hoc in review; see `artifacts/s4/dev/t3/`.
- **dev / T4** — `WorkflowService.parseIntent`; score 10, 1 attempt; see `artifacts/s4/dev/t4/`.
- **dev / T5** — `POST /workflow/parse-action` controller, guards, filter, DTO, and module; score 10, 2 attempts; see `artifacts/s4/dev/t5/`.
- **review** — Full review report with REQUEST CHANGES verdict, five blocking findings, and two nits; see `artifacts/s4/review.md`.
- **wrap** — This document; see `artifacts/s4/wrap.md`.
