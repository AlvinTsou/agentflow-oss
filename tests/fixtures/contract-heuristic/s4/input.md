# S4 intent
```typescript
export interface WorkflowContext {
  actorRole: 'EDITOR' | 'REVIEWER' | 'ADMIN';
  workspaceId: string;
}
export interface ParseIntentResponse {
  intent: string;
  confidence: number;
}
```
