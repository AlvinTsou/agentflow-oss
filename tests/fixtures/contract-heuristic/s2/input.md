# S2 audit — ActionStatus contract
```ts
export interface WorkflowAuditEntry {
  actorRole: 'EDITOR' | 'REVIEWER' | 'ADMIN';
  actionStatus: 'OK' | 'DUPLICATE' | 'TASK_FAILED' | 'MODEL_FAILED' | 'EXECUTION_FAILED' | 'REJECTED' | 'CONFIRMATION_REQUIRED' | 'CANCELLED';
  workspaceId: string;
}
```
