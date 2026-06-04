<!--agentflow
{
  "step": "review",
  "sprint": "maintainer-s1-core-module-1780292658248",
  "score": 8,
  "attempts": 1,
  "provider": "codex",
  "generated_at": "2026-06-01T06:12:29.276Z"
}
-->
## Verdict
REQUEST CHANGES. T1-T4 satisfy their planned acceptance criteria, but T5’s CI gate can pass for unrelated TypeScript failures and its `tsconfig.ci-gate.json` likely introduces a `rootDir` error for the fixture.

## Findings
- T5 [blocking] `tsconfig.ci-gate.json` extends the main config where `"rootDir": "./src"`, while including `fixtures/missing-tier.ts` outside `src`. This likely produces `TS6059` in addition to, or before, the intended missing `RESUME_JOB` exhaustiveness error. The gate should override `rootDir` or use a dedicated config so the intentional failure is specifically the missing tier.
- T5 [blocking] `scripts/ci-gate.sh` accepts any non-zero `tsc` exit as success. That means syntax errors, broken imports, missing config files, or the `rootDir` problem above would all pass the gate. The acceptance criteria require confirming the fixture is producing the expected compile error, so the script should assert the output contains the `RESUME_JOB` missing-property diagnostic.
- T5 [nit] `ci-gate.sh` uses `packages/core-schema/tsconfig.ci-gate.json`, which only works when run from the monorepo root. If the script is invoked from `packages/core-schema`, it fails path resolution. Not forbidden by the ticket, but brittle for a package-local script.

## Test sketch
- T1:
  - `WorkflowActionSchema.safeParse({ type: 'PAUSE_JOB', resourceId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })` should return `success: true` with the same `type` and `resourceId`.
  - `WorkflowActionSchema.safeParse({ type: 'ADD_ITEM', resourceId: validUuid, playerId: validUuid, seat: 3 })` should return `success: true` and fill `addons: 1`.
  - `WorkflowActionSchema.safeParse({ type: 'REMOVE_ITEM', resourceId: validUuid, playerId: validUuid, seat: 5, confidence: 0.91 })` should strip `confidence`.

- T2:
  - In `case 'PAUSE_JOB'`, `intent.resourceId` should compile while `intent.reason` and `intent.playerId` should fail.
  - In `case 'ADD_ITEM'`, `intent.playerId`, `intent.seat`, and `intent.addons` should compile.

- T3:
  - `RISK_LEVEL['REMOVE_ITEM']` should be exactly `'HIGH'`.
  - `RISK_LEVEL[intent.type]` for `intent: WorkflowAction` should type as `'LOW' | 'MEDIUM' | 'HIGH'` without casts.

- T4:
  - A function accepting `RiskLevel` should accept `'LOW'`, `'MEDIUM'`, and `'HIGH'`.
  - The same function should reject `'CRITICAL'` as a TypeScript error.

- T5:
  - `tsc -p packages/core-schema/tsconfig.json --noEmit` should exit `0` and not compile `fixtures/missing-tier.ts`.
  - `tsc -p packages/core-schema/tsconfig.ci-gate.json --noEmit` should exit non-zero because `RESUME_JOB` is missing from `_broken`, and the gate script should verify that exact failure rather than any generic non-zero exit.
