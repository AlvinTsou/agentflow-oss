# Architecture Overview

This document describes the internal architecture of agentflow-oss: how the
source is organized, what the core abstractions are, and how data flows
through the system during a sprint.

## Directory Structure

```
agentflow-oss/
  src/
    middleman/       Provider abstraction and policy layer
    workflow/        Sprint engine, quality loop, state, config, readiness
    recipe/          Recipe type definitions (StepDef, Recipe, ForEachConfig)
    artifacts/       Artifact IO (frontmatter-based markdown files)
    feedback/        Feedback ingestion from .agentflow-feedback/ directory
    util/            Environment loading and shared utilities
  recipes/
    mini/            4-step self-test recipe
    research/        6-step structured research report
    sdd/             9-step spec-driven development
  tests/
    fixtures/        Test data for offline tests
  docs/              Documentation
```

## Core Concepts

### Sprint

A sprint is a single execution of a recipe against an INPUT.md file. Each
sprint has a unique ID, a state file (`state.json`), an event log
(`events.jsonl`), and a set of output artifacts. Sprints are the top-level
unit of work.

### Step

A step is one stage within a recipe. Each step defines:

- A **role** (e.g., produce, review, wrap).
- A **prompt template** that is rendered with context from prior steps.
- An optional **provider override** to route this step to a specific model.
- An optional **forEach configuration** to fan out over a list of items.
- **Quality thresholds** that determine when the step output is acceptable.

### Recipe

A recipe is an ordered sequence of steps, defined as a directory under
`recipes/`. Each recipe specifies the full pipeline from input to final
artifacts. The three built-in recipes are:

| Recipe | Steps | Description |
|--------|-------|-------------|
| mini | 4 | Installation self-test |
| research | 6 | Structured research report |
| sdd | 9 | Spec-driven development |

Recipes are loaded by the config loader at sprint start and are immutable
during execution.

### Quality Loop

Every step goes through a produce/review/fix cycle:

```
    +----------+     +---------+     +-------+
    | Produce  | --> | Review  | --> |  Fix  |
    +----------+     +---------+     +-------+
         ^                |               |
         |                v               |
         |          Score >= target? ------+
         |               |
         |              No
         |               |
         +--- repeat (up to maxRepeats) --+
```

1. **Produce.** The step prompt is sent to the configured provider. The
   response becomes the draft artifact.
2. **Review.** The draft is sent to the review provider (which may be a
   different model) for scoring. The reviewer outputs a numeric score
   and textual feedback.
3. **Fix.** If the score is below the target threshold, the draft and
   review feedback are sent back to the produce provider for revision.

This cycle repeats up to `maxRepeats` times. If the target score is not
reached after all iterations, the step is marked as needing human review
(the maintainer can use `ag approve` or `ag force-pass` to advance).

### Provider

A provider is a model backend: Claude, Codex, OpenAI-compatible, OpenRouter,
or Gemini. Each provider implements a common interface for sending prompts
and receiving completions. Providers are stateless -- all state lives in the
sprint engine.

### Middleman

The Middleman is the central routing and policy layer for all model calls.
It:

1. Resolves which provider to use (explicit override > config default).
2. Applies **policy checks**: secret redaction, token estimation.
3. Dispatches the request to the selected provider.
4. Returns the response to the workflow engine.

The Middleman ensures that no model call bypasses the policy layer,
regardless of which provider is selected.

### Readiness

After a sprint completes all steps, the readiness pipeline analyzes the
review and wrap artifacts to extract **carry-overs**:

| Type | Meaning |
|------|---------|
| **blocking** | Must be resolved before the sprint output is considered shippable |
| **deferred** | Acknowledged but intentionally deferred to a future sprint |
| **nit** | Minor observation, does not block readiness |

The readiness report aggregates all carry-overs and produces a pass/fail
determination. Blocking carry-overs must be resolved (via `ag resolve`)
before the sprint is marked ready.

### Contract Gate

An INPUT.md file can include `agentflow-contract` fenced code blocks that
define mandatory literals or fields that must appear in step output:

````markdown
```agentflow-contract
must-contain: "## API Design"
must-contain: "## Error Handling"
```
````

The contract gate checks each step's output against these requirements. If
a contract is violated, the step fails and enters the fix cycle.

### Feedback

The feedback system ingests structured feedback from the `.agentflow-feedback/`
directory. Feedback types include:

- `comment` -- General commentary on a step.
- `change-request` -- Request for specific changes.
- `approval` -- Explicit approval of a step.
- `request-changes` -- Formal request-changes signal.
- `force-pass` -- Override to advance a stuck step.

Feedback can target a specific step, a specific iteration within a forEach
step, or apply to the entire sprint. Resolved feedback (with a `resolvedAt`
timestamp) is filtered out during ingestion.

## Data Flow

The following diagram shows how data flows through agentflow-oss during a
sprint:

```
INPUT.md
  |
  v
Config Loader --> loads recipe, config, provider settings
  |
  v
Sprint Engine --> creates sprint ID, initializes state
  |
  v
For each step in recipe:
  |
  +---> Prompt Renderer --> renders template with prior artifacts
  |       |
  |       v
  |     Middleman --> policy check --> provider call --> response
  |       |
  |       v
  |     Quality Loop --> review --> score check --> fix if needed
  |       |
  |       v
  |     Artifact IO --> writes output artifact (frontmatter markdown)
  |       |
  |       v
  |     Contract Gate --> validates output against contracts
  |       |
  |       v
  |     Git Checkpoint --> commits + tags step output
  |       |
  |       v
  |     State Store --> persists step result to state.json + events.jsonl
  |
  v
Readiness Pipeline --> parses review/wrap artifacts for carry-overs
  |
  v
Readiness Report --> blocking / deferred / nit summary
```

## State Management

Each sprint maintains two files for state persistence:

### state.json

A JSON file containing the current sprint state:

- Sprint ID and metadata.
- Current step index.
- Per-step results (status, score, artifact paths).
- Overall sprint status (running, paused, completed, failed).
- Timestamp of last update.

This file is the source of truth for resuming a sprint after interruption.

### events.jsonl

A newline-delimited JSON log of all state transitions:

- Step started / completed / failed.
- Quality loop iterations (produce, review, fix).
- Score updates.
- Human gate events (approve, request-changes, force-pass).
- Feedback ingestion events.

The event log is append-only and is used for replay (`ag replay`) and
debugging. It is never modified after writing.

## Git Checkpoint

When git checkpoint is enabled (`"git": { "checkpoint": true }` in config),
agentflow-oss creates a local git repository for each sprint:

1. **Repository initialization.** A bare repo is created in the sprint
   output directory.
2. **Per-step commits.** After each step completes, all artifacts are
   committed with a message describing the step.
3. **Tags.** Each step commit is tagged with `{tagPrefix}{step-number}`
   (e.g., `ag-01`, `ag-02`).

This provides a full audit trail of how the sprint output evolved through
each step, and allows maintainers to diff between steps or roll back to
a specific point.
