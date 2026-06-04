# S1 shared contract
```ts
export const RISK_LEVEL = {
  ADVANCE_STAGE: 'MEDIUM',
} as const satisfies Record<WorkflowAction['type'], 'LOW' | 'MEDIUM' | 'HIGH'>;
```
