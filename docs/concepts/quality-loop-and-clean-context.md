# Quality Loop & Clean-Context Explainer

This document provides a detailed technical explanation of how AgentFlow manages LLM contexts to keep them tidy, and how the Quality Loop manages token limits, retries, and error recovery during iterative refinement cycles.

---

## 1. Clean-Context Isolation (Keeping Context Tidy)

In traditional LLM agent chains, agents are often implemented as continuous chat sessions. This conversational model has several severe drawbacks when applied to software engineering:

*   **Prompt Drift:** Formatting quirks, style errors, or hallucinations from earlier steps pollute the model's instructions for later steps.
*   **Context Bloat:** Conversational history grows continuously, consuming massive tokens and increasing latency and cost.
*   **Attention Decay:** As prompt context sizes grow, LLMs struggle to focus on key constraints (often referred to as "loss in the middle").

AgentFlow enforces **Clean-Context Isolation** by decoupling the workflow state machine from the LLM provider session.

```text
Traditional Chat Loop:
[Brief] ──> [Step 1 Produce] ──> [Step 1 Review] ──> [Step 2 Produce (with Step 1 History)] ──> Bloated Context!

AgentFlow Clean-Context:
[Brief + Step 1 Output] ──> [Step 2 Produce System Prompt] ──> Clean, isolated execution prompt
```

### Prompt Isolation Design
Every step in an AgentFlow recipe starts with a **blank slate**:
1.  **Stateless API Calls:** The middleman makes stateless calls to the configured LLMs. It does not reuse chat thread IDs or keep conversational context on the server side.
2.  **Explicit Input/Output Mapping:** The prompt for a step is constructed dynamically in `src/workflow/sprint-engine.ts` using `resolveProducePrompt`. It contains *only*:
    *   The system prompt and instructions of the current step.
    *   The original `INPUT.md` user brief.
    *   Explicitly mapped output files from upstream steps (passed as context files or clean variables).
3.  **Intermediate Chat Deletion:** The intermediate prompts, reviews, and fixes from Step N-1 are completely omitted from the context of Step N. Only the finalized, accepted output of Step N-1 is forwarded.

---

## 2. Quality Loop Context & Retry Management

Within a single step, the engine executes a **Produce-Review-Fix** cycle (the **Quality Loop**) to verify that the output meets the target score bar. If we naively appended all logs of previous attempts inside this loop, the context window would balloon, leading to failure. 

To solve this, AgentFlow implements a **Bounded Context History** mechanism.

```text
Attempt 1 (Produce):
[Produce Prompt] ──> Output V1

Attempt 2 (Fix):
[Original Rubric] + [Output V1] + [Review V1] ──> Output V2

Attempt 3 (Fix):
[Original Rubric] + [Output V2] + [Review V2] ──> Output V3  (Attempt 1 history is discarded!)
```

### Bounded Context Strategy
During the fix phase, the prompt builder (`buildFixPrompt` in `sprint-engine.ts`) compiles instructions for the fixer model:
*   It includes the **original rubric** that must be satisfied.
*   It includes the **immediate previous attempt's output** (e.g. V1).
*   It includes the **immediate previous review report** (e.g. Review V1).
*   **Crucially, all earlier attempts (V0, V1 review, etc.) are discarded from the prompt.**

By limiting the history to the **last attempt only**, the prompt context size remains constant (bounded) regardless of whether the engine is on retry 2, 3, or more. This prevents rate-limit issues, keeps token usage predictable, and prevents the fixer model from getting confused by outdated feedback logs.

---

## 3. Quality Loop Robustness Safeguards

Iterative LLM refinement is not always monotonic. A model attempting to fix a small issue highlighted by a reviewer can accidentally regress other parts of the document, leading to lower scores on later attempts. 

AgentFlow implements two major safeguards to ensure loop stability.

### Best-So-Far Retention
If a step exhausts its `maxRepeat` budget without hitting the `targetScore`, the engine does not simply return the last (potentially degraded) output. Instead, it scans the history of the loop and rolls back the workspace to the **highest-scoring attempt** (`bestOutput`).

This guarantees that the workflow always outputs the highest quality artifact produced during its execution cycle, protecting the codebase against refinement regressions.

### Cross-Model Review Fallback
Reviewers must emit a structured format containing a parsable score (typically an integer between 0 and 10). If a reviewer outputs corrupt JSON, a malformed response, or encounters a rate-limit error, the Quality Loop is at risk of crashing.

AgentFlow handles this using a **cross-model fallback runner**:
1.  The engine attempts to parse the score from the primary reviewer's output via `parseScore`.
2.  If the output is unparseable (returns `null`), the engine logs the event, but instead of failing, it immediately dispatches the same review prompt to a secondary `reviewFallback` provider (usually a highly reliable frontier model like Codex).
3.  The fallback reviewer's output is parsed to salvage the Quality Loop run.

---

## 4. Summary of Benefits

| Feature | How It Works | Benefit |
|---|---|---|
| **Clean-Context** | Stateless API calls + explicit step input mapping. | Prevents prompt drift, avoids context window bloat, and reduces cost. |
| **Bounded History** | `buildFixPrompt` only includes the immediate previous output + review. | Bounded token consumption per step, preventing API rate-limit and context errors during retries. |
| **Best-So-Far** | Scan loop history and retain the highest-scoring attempt. | Prevents refinement regression during fix cycles. |
| **Cross-Model Fallback** | Fall back to Codex if primary reviewer's score is unparseable. | Prevents formatting anomalies from crashing long-running workflows. |
