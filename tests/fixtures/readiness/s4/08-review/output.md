<!--agentflow
{
  "step": "review",
  "sprint": "maintainer-s4-intent-1780311766016",
  "score": 9,
  "attempts": 1,
  "provider": "codex",
  "generated_at": "2026-06-01T18:01:09.773Z"
}
-->
## Verdict
REQUEST CHANGES. T1, T2, and T4 are mostly aligned, but T3 transforms provider output despite its raw-output contract, and T5 both conflicts with the T4 `WorkflowService.parseIntent` signature and leaves several controller/validation behaviours underspecified or incorrectly wired.

## Findings
- T3 [blocking] `IntentParserService.parse` does not return the raw LLM output exactly as received. It unwraps Worker-style `choices[0].message.content` and then attempts `JSON.parse` on string content, which violates the “no structural transformation” requirement.
- T3 [blocking] Markdown-fenced JSON may be returned raw only because `JSON.parse` fails, but plain JSON strings are parsed into objects at this layer. Ticket says parsing/stripping belongs to `WorkflowService.parseIntent`.
- T5 [blocking] The shown T5 implementation appears to change `WorkflowService.parseIntent` to return `ParseIntentResult` with `{ intent, confidence }`, conflicting with T4’s required signature `Promise<WorkflowAction>`.
- T5 [blocking] `WorkflowService.parseIntent` is destructured in the controller as `{ intent, confidence }`; this is incompatible with the T4 implementation that returns a bare `WorkflowAction`.
- T5 [blocking] `WorkflowValidationExceptionFilter` only calls `writeWorkflowRow(...).catch(...)` without wrapping the initial call in `try/catch`; a synchronous audit throw would escape and could mask the intended HTTP 400.
- T5 [blocking] `ValidationPipe({ transform: true, whitelist: true })` does not guarantee custom `{ code: 'EMPTY_TRANSCRIPT' }` / `{ code: 'INVALID_CONTEXT' }` only from controller-local validation unless the exception filter is correctly instantiated with DI. Using `@UseFilters(WorkflowValidationExceptionFilter)` with a constructor-injected filter can be fragile unless the filter is resolved as a provider in the current Nest context.
- T5 [blocking] `targetId` is implemented as an empty string placeholder. The ticket allows a documented placeholder until resolved before shipping, but this is explicitly not shippable against the final acceptance criteria.
- T5 [nit] `CONFIRMATION_TYPE_MAP` is local. That is allowed for confirmation type, but the comment “every key defined in WorkflowActionSchema” is not compiler-enforced beyond `Record<WorkflowAction['type'], ...>`.
- T5 [nit] `response.confidence` is emitted whenever `confidence !== undefined`, so `NaN` would be included if the provider emitted `confidence: NaN` and Zod accepted the intent. The ticket only says NaN should not degrade in T4; T5 does not define NaN response handling.

## Test sketch
T1:
- Input type check: `{ orgId: 'v', workspaceId: 't', resourceId: 'tbl', seats: [], actorRole: 'ADMIN' }` should type-check.
- Input type check: `actorRole: 'VIEWER'` should not be assignable.
- Input type check: missing `seats` should not be assignable.

T2:
- `new LlmProviderError('x')` should satisfy `instanceof Error`, `instanceof LlmProviderError`, `name === 'LlmProviderError'`, `message === 'x'`, and `cause === undefined`.
- `const cause = { httpStatus: 429, retryAfter: 60 }`; `new LlmProviderError('rate', cause).cause` should be the exact same object reference.
- `new LlmProviderError('fetch', new TypeError('fetch failed')).cause` should preserve the original `TypeError`.

T3:
- HTTP 200 body with provider content `{ choices: [{ message: { content: '{"type":"PAUSE_JOB","confidence":0.97}' } }] }` should not be structurally transformed under the ticket’s raw-output rule, but implementation returns parsed object.
- HTTP 200 body with content string `` ```json\n{"type":"REMOVE_ITEM","targetSeat":4,"confidence":0.91}\n``` `` should resolve to the raw fenced string for `WorkflowService` to strip.
- HTTP 429 should reject with `LlmProviderError`, message `Rate limit exceeded (HTTP 429)`, and cause `{ httpStatus: 429 }`.

T4:
- Parser returns `` ```json\n{"type":"REMOVE_ITEM","targetSeat":9,"confidence":0.88}\n``` ``; expected result is validated `{ type: 'REMOVE_ITEM', targetSeat: 9 }`.
- Parser returns `{ type: 'PAUSE_JOB', confidence: 0.62 }`; expected result is `{ type: 'AMBIGUOUS_INTENT', candidates: [] }` and one `MODEL_FAILED` audit attempt.
- Parser rejects with `new LlmProviderError('HTTP 503')`; expected result is degraded ambiguous intent, no rejection.

T5:
- No `Authorization` header with otherwise valid body should return HTTP 401 and write no audit row.
- Valid session role `VIEWER` should return HTTP 403 and write no audit row.
- `transcript: '   '` should return HTTP 400 `{ code: 'EMPTY_TRANSCRIPT' }`, not call `WorkflowService.parseIntent`, and write `VALIDATION_FAILED`.
- Valid dealer request producing `{ type: 'PAUSE_JOB', confidence: 0.97 }` should return HTTP 200 with `riskTier: 'LOW'`, `confirmationType: 'UNDO_WINDOW'`, a 64-char lowercase hex `idempotencyKey`, and `confidence: 0.97`.
- Provider-down degraded result should still return HTTP 200 with `AMBIGUOUS_INTENT`, `riskTier: 'LOW'`, `confirmationType: 'NONE'`, and no `confidence`.
