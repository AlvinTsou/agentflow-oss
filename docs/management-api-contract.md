# Management API Contract

This document defines the data contract for the local AgentFlow management UI.
The CLI writes local JSON files, and the local Hono server exposes these shapes
over HTTP for dashboard use.

Security boundary:

- The management server is intended for loopback use and binds to `127.0.0.1`
  by default.
- CORS is allowlisted for trusted local development origins by default.
- There is no built-in authentication. Do not expose the server publicly without
  an external access-control layer.

## Sprint Summary

`GET /api/sprints`

Reads from `~/.agentflow/sprint-index.jsonl` plus each sprint's `state.json`
when available.

```json
{
  "sprintId": "SPRINT_001",
  "recipeName": "sdd",
  "sprintDir": "/path/to/sprint",
  "phase": "completed",
  "currentStepIdx": 5,
  "completedSteps": ["discuss", "explore"],
  "startedAt": "2026-06-19T00:00:00.000Z",
  "lastEventTs": "2026-06-19T00:05:00.000Z",
  "totalTokens": 12345,
  "totalCostUsd": 0.42,
  "readiness": "ready"
}
```

## Sprint Events

`GET /api/sprints/:id/events`

Reads from `<sprintDir>/events.jsonl`. The event stream remains the primary
timeline for state transitions, approval decisions, route audit metadata, and
failure diagnostics.

Required fields:

- `ts`
- `type`
- `step`
- `iteration`
- `attempt`
- `score`
- `tokens`
- `costUsd`
- `msg`
- `route`

## Streaming Checkpoints

`GET /api/sprints/:id/checkpoints`

Reads from `<sprintDir>/streaming-checkpoints.jsonl`. Each checkpoint records a
completed Quality Loop phase output. A later streaming provider integration can
append finer-grained token deltas, but this phase-level record is already enough
for dashboard progress, partial-output inspection, and recovery diagnostics.

```json
{
  "version": 1,
  "ts": "2026-06-19T00:05:00.000Z",
  "sprintId": "SPRINT_001",
  "step": "develop",
  "iteration": "T3",
  "phase": "review",
  "attempt": 2,
  "provider": "claude",
  "score": 9,
  "tokens": 4200,
  "costUsd": 0.18,
  "durationMs": 2500,
  "artifactPath": "04-develop/T3/reviews/review_v2.md",
  "outputPreview": "short text preview",
  "outputSha256": "..."
}
```

## Control Actions

`POST /api/sprints/:id/actions`

The web layer maps user actions to typed web-originated events and appends them
to `events.jsonl` rather than mutating engine internals directly.

```json
{
  "action": "approve",
  "step": "review",
  "note": "PM approved"
}
```

Supported action names:

- `approve`
- `request-changes`
- `force-pass`
- `resume`
- `pin-iter`

The server appends corresponding web-originated events to `events.jsonl`.
Execution still remains coordinated through the existing CLI/runner paths.
