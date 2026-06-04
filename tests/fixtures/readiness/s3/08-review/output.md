<!--agentflow
{
  "step": "review",
  "sprint": "maintainer-s3-stt-1780308919954",
  "score": 9,
  "attempts": 1,
  "provider": "codex",
  "generated_at": "2026-06-01T10:41:18.857Z"
}
-->
## Verdict

REQUEST CHANGES. Most ticket bodies are present, but T7/T8 have blocking behavioral and contract gaps around provider error boundaries, dependency wiring, public exports, and “synchronous” payload-size semantics.

## Findings

- T4 [blocking] `TaskPayloadTooLargeError` does not repair the prototype chain with `Object.setPrototypeOf`; depending on TS target/runtime, `e instanceof TaskPayloadTooLargeError` can fail despite the acceptance criteria requiring it.

- T7 [blocking] The 25 MB guard is inside an `async` method, so `throw new TaskPayloadTooLargeError()` produces a rejected `Promise` rather than a synchronously thrown exception at call time. The ticket explicitly requires synchronous throw before I/O.

- T7 [blocking] `WorkerTaskProvider` requires an `'WORKER_CLIENT'` injection token, but the T7 implementation section does not show `WorkflowModule` registering that token. T5’s module only registers `WorkerTaskProvider` and `TASK_PROVIDER`, so the app would fail DI unless T8’s later module replaces it.

- T7 [nit] `private readonly config: ConfigService` is injected but unused in the class. That matches the injected signature, but it does not demonstrate credential sourcing by `ConfigService` in this implementation section.

- T8 [blocking] The T8 implementation introduces `src/workflow-api/task.types.ts` duplicating T1-T6 definitions, but does not show these exports being re-exported from `src/workflow-api/index.ts`. T1-T6 require public barrel exports from the workflow module.

- T8 [blocking] `TaskProviderError` and `TaskPayloadTooLargeError` in `task.types.ts` do not repair the prototype chain. The controller relies on `instanceof` checks for both, so HTTP 413/502 mapping can fail under affected TS targets.

- T8 [blocking] `WorkflowModule` registers `{ provide: TASK_PROVIDER, useClass: WorkerTaskProvider }` but does not also register `WorkerTaskProvider` itself. That is fine for controller injection via `TASK_PROVIDER`, but it does not satisfy T5’s explicit expected providers-array shape if that criterion is interpreted literally alongside the earlier implementation.

- T8 [blocking] `AuditService` is stubbed in `src/audit/audit.service.ts`. The ticket says Sprint 2 owns the implementation, so a local stub can conflict with the real Sprint 2 contract if it already exists. This needs verification against the actual codebase rather than accepting the stub as final.

- T8 [nit] `PayloadExceptionFilter` maps all non-size Payload errors to `{ code: 'PAYLOAD_ERROR' }`, which is outside the listed acceptance criteria but probably acceptable unless the API error-code surface is intended to be closed.

## Test sketch

- T1:
  - `const x: SupportedPayloadType = 'application/json'` should compile.
  - `const x: SupportedPayloadType = 'application/xml'` should fail with not assignable to `'application/json'`.

- T2:
  - `{ transcript: '', durationMs: 0 }` should satisfy `TaskResult`.
  - `{ transcript: 'fold', confidence: 0, durationMs: 400 }` should satisfy `TaskResult` with `confidence` present.

- T3:
  - `new TaskProviderError('worker', 'Upstream rate limit exceeded')` should have `.name === 'TaskProviderError'`, `.providerName === 'worker'`, and the same `.message`.
  - `err instanceof Error` and `err instanceof TaskProviderError` should both be true.

- T4:
  - `new TaskPayloadTooLargeError().message` should equal exactly `'Buffer exceeds 25 MB limit'`.
  - `new TaskPayloadTooLargeError() instanceof TaskPayloadTooLargeError` must be true; current implementation may not guarantee this for all TS targets.

- T5:
  - `String(TASK_PROVIDER)` should expose the runtime symbol description `Symbol(TaskProvider)`.
  - A test module should be able to override `{ provide: TASK_PROVIDER, useClass: FakeTaskProvider }` and have `WorkflowController` receive the fake.

- T6:
  - `processTask(Buffer.alloc(0), 'application/json', undefined)` is valid at the interface level.
  - Passing `'application/xml'` as the MIME argument should be a compile-time error.

- T7:
  - Mock Worker returns `{ text: 'check', duration: 0.5 }`; expected result is `{ transcript: 'check', durationMs: 500 }` with no `confidence` key.
  - `Buffer.byteLength === 26_214_401` should throw/reject `TaskPayloadTooLargeError` before `worker.payload.transcriptions.create` is called.
  - `languageHint === undefined` should omit `language` from SDK params; `'en'` should include `language: 'en'`.

- T8:
  - Missing `payload` file should return HTTP 400 `{ code: 'MISSING_PAYLOAD_FIELD' }` and no audit write.
  - Wrong MIME like `text/plain` should return HTTP 415 `{ code: 'UNSUPPORTED_MEDIA_TYPE' }` and no audit write.
  - Provider success `{ transcript: 'call', durationMs: 610 }` should return HTTP 200 `{ transcript: 'call', durationMs: 610 }` with no `confidence`.
  - Provider throws `TaskProviderError`; expected HTTP 502 `{ code: 'TASK_PROVIDER_ERROR' }` plus fire-and-forget audit row with `actionStatus: 'TASK_FAILED'`.
