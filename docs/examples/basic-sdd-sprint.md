# Spec-Driven Development (SDD) Sprint Walkthrough

This guide provides a detailed walkthrough of a sanitized, model-run Spec-Driven Development (`sdd`) sprint. It follows the 9-step recipe configured in `recipes/sdd/recipe.ts`.

---

## Sprint Overview

In this simulated sprint, we build a **Tiny In-Memory Key-Value Store with TTL (Time-To-Live)** in TypeScript. 

### The Input Brief (`INPUT.md`)
The sprint is initialized with this brief:
```markdown
# INPUT.md

Design a simple in-memory Key-Value store with TTL (Time-To-Live) support in TypeScript.

Requirements:
- Set key with optional TTL (in milliseconds).
- Get key (must return `null` if expired).
- Delete key.
- A `clean()` method to manually purge expired keys.
```

---

## 1. Explore & Converge (Steps 1-3)

These steps are designed to align the agent and maintainer on implementation choices without committing to concrete production code yet.

### Step 1: `discuss`
- **Goal**: Align on architecture, edge cases, and TTL deletion strategies.
- **Output**: `sprints/ttl-kv-sprint/artifacts/discuss.md`
- **Key Content**:
  > [!NOTE]
  > Discusses passive vs. active TTL deletion. Passive deletion checks expirations during `get()`. Active deletion runs a periodic `setInterval` background cleanup loop. Decided to implement **both** strategies for efficiency and memory hygiene.
- **Rubric Score**: `8/10` (Passed)

### Step 2: `explore`
- **Goal**: Survey existing implementation patterns (e.g., Map, expiration queues) and trade-offs.
- **Output**: `sprints/ttl-kv-sprint/artifacts/explore.md`
- **Key Content**:
  Analysis of standard JavaScript `Map` vs. binary heaps for sorting expiration timestamps. Concluded that a vanilla `Map` storing `{ value, expiresAt }` combined with a manual `clean()` iteration is optimal for a lightweight library.
- **Rubric Score**: `8/10` (Passed)

### Step 3: `prototype`
- **Goal**: Write a non-production draft of the core logic to prove the API viability.
- **Output**: `sprints/ttl-kv-sprint/artifacts/prototype.md`
- **Key Content**:
  ```typescript
  // Prototype sketch
  class TtlStorePrototype {
    private cache = new Map<string, { value: any; expiresAt: number | null }>();
    set(key: string, value: any, ttl?: number) {
      const expiresAt = ttl ? Date.now() + ttl : null;
      this.cache.set(key, { value, expiresAt });
    }
    get(key: string) {
      const entry = this.cache.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        return null;
      }
      return entry.value;
    }
  }
  ```
- **Rubric Score**: `8/10` (Passed)

---

## 2. Specify & Decompose (Steps 4-6)

These steps establish the formal interface contract and break the implementation down into reviewable units (tickets).

### Step 4: `spec`
- **Goal**: Define the exact TypeScript interface and class signature.
- **Output**: `sprints/ttl-kv-sprint/artifacts/spec.md`
- **Key Content**:
  ```typescript
  export interface StoreEntry<T> {
    value: T;
    expiresAt: number | null;
  }

  export class TtlStore<T> {
    constructor(cleanupIntervalMs?: number);
    set(key: string, value: T, ttlMs?: number): void;
    get(key: string): T | null;
    delete(key: string): boolean;
    clean(): void;
    close(): void; // Clears active interval background timers
  }
  ```
- **Rubric Score**: `9/10` (Passed)

### Step 5: `usage`
- **Goal**: Write sample code illustrating usage scenarios, import paths, and error handling.
- **Output**: `sprints/ttl-kv-sprint/artifacts/usage.md`
- **Key Content**:
  Provides copy-pasteable examples of setting keys with 100ms TTLs, retrieving active entries, waiting for expiration, and invoking the manual `clean()` method.
- **Rubric Score**: `9/10` (Passed)

### Step 6: `tkt`
- **Goal**: Decompose the task into isolated development tickets.
- **Output**: `sprints/ttl-kv-sprint/artifacts/tkt.md`
- **Key Content**:
  ```markdown
  ## T1: Basic CRUD operations and passive TTL check
  Implement `set()`, `get()`, and `delete()`. Ensure `get()` passively deletes expired entries.
  
  ## T2: Active cleanup background loops
  Implement `clean()` and the optional `cleanupIntervalMs` timer setup and `close()` method.
  ```
- **Rubric Score**: `9/10` (Passed)

---

## 3. Implement & Quality (Steps 7-9)

### Step 7: `dev` (forEach iteration)
The engine executes `T1` and `T2` as separate iterations. The agent has write access to the workspace.

#### Iteration `T1`
- **Task**: Implement CRUD and passive checks.
- **Agent Modification**: Creates `src/ttl-store.ts` and `tests/ttl-store.test.ts`.
- **Validation**: Runs local tests which pass.
- **Iteration Score**: `9/10` (Passed)

#### Iteration `T2`
- **Task**: Add background timer loop.
- **Agent Modification**: Modifies `src/ttl-store.ts` to support `setInterval` for automatic cleanup.
- **Validation**: Test suite expanded to mock timers and verify active cleanup.
- **Iteration Score**: `9/10` (Passed)

### Step 8: `review`
- **Goal**: An independent review step grades the implementation against specifications and provides structured code quality findings.
- **Output**: `sprints/ttl-kv-sprint/artifacts/review.md`
- **Key Content**:
  A structured code-review report. It finds that `close()` should be safely idempotent (calling it multiple times should not throw an error). It returns `VERDICT: APPROVE` with two minor recommendations (non-blocking).
- **Rubric Score**: `7/10` (Passed - Review is scored on a lower threshold of 7)

### Step 9: `wrap`
- **Goal**: Run final readiness checks and compile all carry-overs.
- **Output**: `sprints/ttl-kv-sprint/artifacts/wrap.md` and `sprints/ttl-kv-sprint/readiness-report.md`
- **Verification Engine**:
  - `wrapTicketConsistencyGuard` verifies that all iterations (`T1`, `T2`) are documented in the wrap body.
  - `contractGuard` verifies the output implements all TS interface fields defined in `INPUT.md` (or extracted heuristics).

#### Readiness Report (`readiness-report.md`)
```markdown
# Sprint Readiness Report — ttl-kv-sprint

## Verdict: READY

The sprint outputs are fully compiled, verified, and ready to be merged.

### Carry-overs

#### Deferred (Non-blocking)
- **T2**: Make `close()` idempotent. Ensure calling it twice does not trigger exceptions.

### Verifications
- **input-fidelity-contract**: PASS
- **wrap-ticket-consistency**: PASS (Found matching claims for T1, T2)
```

---

## Git Checkpoints
Throughout this sprint, `agentflow-oss` automatically managed git checkpoints. The history looks like:
```bash
$ git log --oneline
* 9a8b7c6 (tag: sprint-wrap-ttl-kv-sprint) docs: finalize sprint wrap-up
* 7f6e5d4 (tag: sprint-dev-T2-ttl-kv-sprint) feat: implement background cleanup loop
* 5d4c3b2 (tag: sprint-dev-T1-ttl-kv-sprint) feat: implement core store and passive ttl
* 3c2b1a0 (tag: sprint-init-ttl-kv-sprint) init: prepare sprint directory
```
