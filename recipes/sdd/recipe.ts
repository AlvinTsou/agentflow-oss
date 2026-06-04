import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Recipe, StepContext, StepDef, ForEachItem } from "../../src/recipe/types.js";
import { applyProviderOverride, type StepProviderOverride as SharedStepProviderOverride } from "../../src/recipe/types.js";
import type { Provider, ProviderRunOptions } from "../../src/middleman/provider.js";
import { parseContractBlocks, checkContract, extractHeuristicContract } from "../../src/workflow/contract-gate.js";
import type { PreReviewResult } from "../../src/recipe/types.js";

/**
 * Re-export of the shared StepProviderOverride type so existing
 * SDD-recipe callers don't need to change their import path. The type
 * itself moved to `src/recipe/types.ts` in Phase 5 so the engine,
 * SDD recipe, and the new Research recipe all share one definition.
 */
export type StepProviderOverride = SharedStepProviderOverride;

/**
 * Programmatic check used as preReview hook on the wrap step. Compares the
 * T<N> tokens mentioned in the wrap output against the actual dev iteration
 * ids in priorIterations. Emits a structured report consumed by C5 of the
 * wrap rubric — the engine itself does not act on it.
 */
export function wrapTicketConsistencyGuard(ctx: StepContext, output: string): string {
  const devIters = Object.keys(ctx.priorIterations?.dev ?? {}).sort();
  const claimedMatches = output.matchAll(/\bT(\d+)\b/g);
  const claimed = Array.from(new Set(Array.from(claimedMatches, (m) => `T${m[1]}`))).sort();
  const actualSet = new Set(devIters);
  const claimedSet = new Set(claimed);
  const missing = devIters.filter((t) => !claimedSet.has(t));
  const phantom = claimed.filter((t) => !actualSet.has(t));
  const status = missing.length === 0 && phantom.length === 0 ? "OK" : "MISMATCH";

  return [
    `Guard report — wrap ticket consistency:`,
    `  actual dev iterations: [${devIters.join(", ")}]`,
    `  T<N> tokens claimed in wrap body: [${claimed.join(", ")}]`,
    `  missing_from_claims: [${missing.join(", ")}]`,
    `  phantom_claims: [${phantom.join(", ")}]`,
    `  STATUS: ${status}${status === "MISMATCH" ? " — rubric C5 requires score <= 4." : "."}`,
  ].join("\n");
}

/**
 * INPUT-fidelity contract guard. preReview hook reading the root INPUT.md.
 *
 * Explicit path (Slice 1): if INPUT has an `agentflow-contract` block, check the
 * step output contains every mandated literal/field as a complete token; on
 * MISMATCH return scoreCap 4 so the Quality Loop DETERMINISTICALLY clamps the
 * score (the LLM reviewer demonstrably misses this drift — S2/S4).
 *
 * Heuristic path (Slice 2): if there is NO explicit block, auto-extract contract
 * tokens from the INPUT's TS code fences (string-literal unions + interface
 * fields) and, if the output dropped any, return a NON-CLAMPING `WARN` (no
 * scoreCap). Advisory only — the report is injected for the reviewer's benefit.
 *
 * Explicit wins: when a block exists the heuristic does not run (no dedup/noise).
 */
export function contractGuard(ctx: StepContext, output: string): PreReviewResult {
  const guardName = "input-fidelity-contract";
  const input = readInput(ctx.sprintDir);

  const explicit = parseContractBlocks(input);
  const hasExplicit = explicit.literals.size > 0 || explicit.fields.size > 0;

  if (hasExplicit) {
    const r = checkContract(explicit, output);
    if (r.status !== "MISMATCH") {
      return {
        guardName,
        status: r.status,
        report: "Contract guard: all mandated literals/fields present. STATUS: OK.",
        source: "explicit",
        missingLiterals: r.missingLiterals,
        missingFields: r.missingFields,
      };
    }
    const report = [
      "Contract guard — INPUT-fidelity (literals/fields):",
      `  missing_literals: [${r.missingLiterals.join(", ")}]`,
      `  missing_fields: [${r.missingFields.join(", ")}]`,
      "  STATUS: MISMATCH — score deterministically clamped to <= 4.",
    ].join("\n");
    return { guardName, status: "MISMATCH", report, scoreCap: 4, source: "explicit", missingLiterals: r.missingLiterals, missingFields: r.missingFields };
  }

  // No explicit block — heuristic, warning-only.
  const heuristic = extractHeuristicContract(input);
  const r = checkContract(heuristic, output);
  if (r.status === "NONE") {
    return {
      guardName,
      status: "NONE",
      report: "Contract guard: no agentflow-contract block and no TS contract detected in INPUT — skipped.",
      source: "heuristic",
      missingLiterals: r.missingLiterals,
      missingFields: r.missingFields,
    };
  }
  if (r.status === "OK") {
    return {
      guardName,
      status: "OK",
      report: "Contract guard (heuristic): all detected literals/fields present. STATUS: OK.",
      source: "heuristic",
      missingLiterals: r.missingLiterals,
      missingFields: r.missingFields,
    };
  }
  // checkContract returned MISMATCH; on the heuristic path we map it to the
  // non-clamping WARN status (never surface r.status directly here).
  const report = [
    "Contract guard — heuristic INPUT-fidelity (TS unions/interfaces, NON-BLOCKING):",
    `  missing_literals: [${r.missingLiterals.join(", ")}]`,
    `  missing_fields: [${r.missingFields.join(", ")}]`,
    "  STATUS: WARN — heuristic only, NOT clamped. If these are real contract drops, add an agentflow-contract block to enforce.",
  ].join("\n");
  return { guardName, status: "WARN", report, source: "heuristic", missingLiterals: r.missingLiterals, missingFields: r.missingFields };
}

/**
 * 9-step Spec-Driven Development recipe (per AgentFlow guide section 4).
 *
 * Input contract:
 *   The user MUST place a markdown file at `<sprintDir>/INPUT.md` before
 *   the sprint starts. It should describe the problem in the user's own
 *   words — anything from one sentence to a short brief.
 *
 * Phases:
 *   1-3 Explore & Converge:   Discuss · Explore · Prototype
 *   4-6 Specify & Decompose:  Spec    · Usage   · Tkt
 *   7-9 Implement & Quality:  Dev     · Review  · Wrap
 *
 * Soft-step rubrics (Discuss / Explore / Prototype) accept directional
 * correctness instead of exact-match criteria — they're for converging on
 * shared understanding, not for generating final artifacts.
 *
 * The Review step (8) uses Codex (cross-model verified in Phase 0 POC).
 *
 * Tool access:
 *   - Dev step's producer + fixer get Read/Write/Bash so the agent can
 *     inspect files and run commands. The reviewer is intentionally tool-less
 *     (otherwise it would execute the code instead of grading it).
 *   - All other steps run tool-less.
 *
 * targetScore policy (deviates from canonical 9 — documented here):
 *   - Canonical default (any step omitting `targetScore`):  9
 *   - Soft steps (discuss / explore / prototype):           8
 *       Reason: these steps grade *directional correctness* on a free-form
 *       brief; the last point of strictness usually costs an extra fix loop
 *       without improving downstream artifact quality.
 *   - Review step (8):                                       7
 *       Reason: review is a meta-rubric (grading the review report's quality
 *       against IMPLEMENTATIONS), and Phase 1.9's forEach loosening of C2/C3
 *       made strict 8+ impractical. 7 is the empirical sweet spot from Run C.
 *   - Wrap step (9):                                         9
 *       Plus C5 hard-caps the score at 4 on guard MISMATCH (Phase 2.0 #3).
 *   - Dev forEach iters:                                     9 each
 */

const SCORE_JSON_INSTRUCTION = `Output ONLY a single-line JSON object, no prose, no fences:
{"score": <0-10>, "passed": [<C-ids>], "failed": [<C-ids>], "notes": "<one short sentence>"}`;

function readInput(sprintDir: string): string {
  const path = join(sprintDir, "INPUT.md");
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    throw new Error(
      `SDD recipe requires <sprintDir>/INPUT.md describing the problem. Missing: ${path}`,
    );
  }
}

/**
 * Extracts each `## T<n>: <label>` section from the tkt artifact body.
 * Returns one ForEachItem per ticket with the section's full markdown as `data`
 * (header + bullets), preserving the ticket's signature/criteria text for the
 * Dev step to inline.
 */
function parseTicketsFromBody(tktBody: string): ForEachItem[] {
  const items: ForEachItem[] = [];
  let current: { id: string; label?: string; lines: string[] } | null = null;
  const headerRe = /^##\s+(T\d+):\s*(.*)$/;
  for (const line of tktBody.split("\n")) {
    const m = line.match(headerRe);
    if (m) {
      if (current) {
        items.push({ id: current.id, label: current.label, data: current.lines.join("\n") });
      }
      current = { id: m[1]!, label: m[2]?.trim() || undefined, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    items.push({ id: current.id, label: current.label, data: current.lines.join("\n") });
  }
  return items;
}

/** Inlines every Dev iteration body for the Wrap step's "what shipped" check. */
function formatDevIterations(ctx: StepContext): string {
  const devIters = ctx.priorIterations.dev ?? {};
  const ids = Object.keys(devIters);
  if (ids.length === 0) return "(no dev iterations found)";
  return ids
    .map((id) => {
      const a = devIters[id]!;
      const meta = `score=${a.frontmatter.score}, attempts=${a.frontmatter.attempts}${a.frontmatter.forced ? ", forced" : ""}`;
      return `### ${id} (${meta})\n\n${a.body}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Names of the 9 SDD recipe steps. Used as keys in
 * `SDDRecipeOptions.stepProviders` so the type system catches typos
 * (e.g. "develop" instead of "dev") at recipe-build time.
 */
export type SDDStepName =
  | "discuss"
  | "explore"
  | "prototype"
  | "spec"
  | "usage"
  | "tkt"
  | "dev"
  | "review"
  | "wrap";

// StepProviderOverride is now exported from src/recipe/types.ts (Phase 5);
// the local re-export above (line ~13) keeps existing call sites working.

export interface SDDRecipeOptions {
  /**
   * Implementation language used in prototype, spec signatures, ticket
   * signatures, and dev step. Affects prompt phrasing and the fenced code
   * block tag. Default: "TypeScript".
   */
  language?: string;
  /**
   * Markdown fence tag for code blocks (e.g. "ts", "rust", "py"). Default
   * derived from `language` via a small lookup; pass explicitly to override.
   */
  languageFence?: string;
  /**
   * Back-compat sugar for `stepProviders.review.provider`. Default: "codex".
   * If `stepProviders.review` is ALSO set, the map entry wins (more general
   * lever). Pass "gemini" or "openrouter" to validate parity on the
   * cross-model gate. Codex-specific tuning is dropped automatically when
   * the effective provider is not "codex".
   */
  reviewProvider?: Provider;
  /** Back-compat sugar for `stepProviders.review.model`. */
  reviewModel?: string;
  /**
   * Back-compat sugar for `stepProviders.review.runOptions`. Use when the
   * override needs more than a model — e.g. providing an apiKeyEnv for a
   * self-hosted OpenAI-compatible endpoint.
   */
  reviewRunOptions?: ProviderRunOptions;
  /**
   * Per-step provider overrides. Generalises the legacy review-only swap
   * to any of the 9 SDD steps. Use to route low-risk steps (discuss /
   * explore / prototype / wrap / review) through a cheaper model while
   * keeping normative steps (spec / usage / tkt / dev) on Claude — the
   * `--lite-preset` shortcut in `run-sdd.ts` produces exactly this map.
   *
   * Precedence: a step's entry here wins over the legacy review-only
   * fields; unset entries leave the step on its recipe-level default.
   */
  stepProviders?: Partial<Record<SDDStepName, StepProviderOverride>>;
}

/**
 * Applies a per-step provider override to a recipe step, returning a new
 * StepDef. Thin wrapper over the shared `applyProviderOverride` helper
 * (Phase 5) — keeps the codex-tuning auto-drop rule centralised.
 */
function applyStepOverride(
  step: StepDef,
  override: StepProviderOverride | undefined,
): StepDef {
  if (!override) return step;
  const { provider, options } = applyProviderOverride(step.provider, step.runOptions, override);
  return { ...step, provider, runOptions: options };
}

/**
 * Merges legacy review-only options + the stepProviders map into a single
 * resolved-override map. Legacy fields contribute to the `review` entry
 * only; an explicit `stepProviders.review` entry wins over them when both
 * are set (it is the more general lever).
 */
function resolveStepOverrides(
  opts: SDDRecipeOptions,
): Partial<Record<SDDStepName, StepProviderOverride>> {
  const merged: Partial<Record<SDDStepName, StepProviderOverride>> = {
    ...(opts.stepProviders ?? {}),
  };
  const legacy: StepProviderOverride = {};
  if (opts.reviewProvider !== undefined) legacy.provider = opts.reviewProvider;
  if (opts.reviewModel !== undefined) legacy.model = opts.reviewModel;
  if (opts.reviewRunOptions !== undefined) legacy.runOptions = opts.reviewRunOptions;
  const hasLegacy =
    legacy.provider !== undefined ||
    legacy.model !== undefined ||
    legacy.runOptions !== undefined;
  if (hasLegacy && !merged.review) {
    merged.review = legacy;
  }
  return merged;
}

function defaultFenceFor(language: string): string {
  const k = language.toLowerCase();
  if (k === "typescript" || k === "ts") return "ts";
  if (k === "javascript" || k === "js") return "js";
  if (k === "rust" || k === "rs") return "rust";
  if (k === "python" || k === "py") return "python";
  if (k === "go" || k === "golang") return "go";
  return k;
}

export function createSDDRecipe(opts: SDDRecipeOptions = {}): Recipe {
  const language = opts.language ?? "TypeScript";
  const fence = opts.languageFence ?? defaultFenceFor(language);
  const overrides = resolveStepOverrides(opts);
  // Computed only for the review step's description string; the actual
  // provider routing comes from applyStepOverride at the bottom.
  const reviewProviderDisplay: Provider = overrides.review?.provider ?? "codex";
  const baseRecipe: Recipe = {
  name: "sdd",
  description:
    "Spec-Driven Development recipe — 9 steps in 3 phases. Takes a free-form problem brief at <sprintDir>/INPUT.md and produces a reviewed implementation with full audit trail.",
  steps: [
    // ─────────────────────────────────────────────────────────────────────
    // Phase 1: Explore & Converge
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "discuss",
      description: "Refine the raw problem brief into a clear, scoped problem statement.",
      provider: "claude",
      producePrompt: (ctx) => `
You are a senior engineer turning a rough problem brief into something a team
can actually work on. Read the brief and produce a refined problem statement.

==== RAW BRIEF (from <sprintDir>/INPUT.md) ====
${readInput(ctx.sprintDir)}
==== END ====

Produce a markdown document with these sections (in order):

  ## Problem
  Two or three sentences. What is broken, missing, or unclear today.

  ## Why now
  One or two sentences. Constraint, deadline, or motivation that makes this
  worth doing now instead of later.

  ## In scope
  Bullet list. The things this work WILL address.

  ## Out of scope
  Bullet list. Adjacent concerns this work will deliberately NOT touch.

  ## Success criteria
  Bullet list. Concrete, verifiable outcomes — how we'd know it's done.

  ## Open questions
  Bullet list. Anything the brief is silent on that needs answering.

Output ONLY the markdown body. No code fences around the whole document.
      `.trim(),
      rubric: `
You are a strict reviewer scoring a refined problem statement. The point of
this step is directional correctness — clarity and scope, not exhaustive
detail.

Rubric (10 pts):
  C1 [3] All six sections present (Problem, Why now, In scope, Out of scope,
        Success criteria, Open questions)
  C2 [3] Success criteria are concrete enough that someone else could verify
        them (not vague like "improve UX")
  C3 [2] In scope vs Out of scope are non-empty and meaningfully distinct
  C4 [2] No surprise expansion of the raw brief — additions are clarifications,
        not new features

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 8,
      maxRepeat: 3,
    },

    {
      name: "explore",
      description: "Agent-driven research: surface relevant code, constraints, dependencies.",
      provider: "claude",
      producePrompt: (ctx) => `
You have a refined problem statement (below). Produce a research note that
captures what an implementer would need to know before designing a solution.

==== PROBLEM ====
${ctx.priorArtifacts.discuss!.body}
==== END ====

Produce a markdown document with these sections:

  ## Relevant code / surfaces
  Files, modules, or APIs likely to be touched. Best guess is fine if you're
  inferring without a codebase.

  ## Existing patterns
  Conventions or prior art in this codebase / domain that this work should
  follow rather than re-invent.

  ## Constraints
  Hard limits to respect — performance, compatibility, data shape, third-party
  contracts, etc.

  ## Risks / unknowns
  Where the implementation could go sideways. Include unknowns from Discuss's
  Open questions, marked as such.

  ## Recommended direction
  One paragraph. Which way you'd lean and why, based on the above.

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the research note. This is a soft step — directional value matters more
than completeness.

==== PROBLEM (authoritative scope) ====
${ctx.priorArtifacts.discuss!.body}
==== END ====

Rubric (10 pts):
  C1 [3] All five sections present and substantive (not one-line placeholders)
  C2 [3] Findings are tied to the problem above, not generic boilerplate
  C3 [2] At least one concrete risk or unknown is named (not "TBD")
  C4 [2] Recommended direction takes a stance — does not punt with "depends"

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 8,
      maxRepeat: 3,
    },

    {
      name: "prototype",
      description: "Sketch a minimal validating prototype (in markdown, not real files).",
      provider: "claude",
      producePrompt: (ctx) => `
Sketch a minimal prototype that validates the recommended direction. This is
a thought-experiment prototype on paper — not real code in the repo yet.

==== PROBLEM ====
${ctx.priorArtifacts.discuss!.body}
==== END ====

==== RESEARCH ====
${ctx.priorArtifacts.explore!.body}
==== END ====

Produce a markdown document with:

  ## Approach
  One paragraph. The shape of the solution in plain words.

  ## Key code sketch
  ONE small ${language} snippet (fenced \`\`\`${fence} ... \`\`\`) — the smallest
  thing that demonstrates the approach works. Not a full implementation.
  Around 20-60 lines is ideal.

  ## What this validates
  Bullet list. Which open questions / risks from prior steps this resolves.

  ## What this defers
  Bullet list. Things deliberately left for Spec/Dev to handle. Edge cases,
  scale, etc.

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the prototype sketch. Directional correctness is the goal.

==== PROBLEM ====
${ctx.priorArtifacts.discuss!.body}
==== END ====

==== RESEARCH ====
${ctx.priorArtifacts.explore!.body}
==== END ====

Rubric (10 pts):
  C1 [3] Has all four sections (Approach, Key code sketch, Validates, Defers)
  C2 [3] The code sketch is concrete ${language} and would plausibly compile —
        not pseudocode or stubs only
  C3 [2] "Validates" links back to specific risks/unknowns from Research
  C4 [2] Stays minimal — does not balloon into a full implementation

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 8,
      maxRepeat: 3,
    },

    // ─────────────────────────────────────────────────────────────────────
    // Phase 2: Specify & Decompose
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "spec",
      description: "Formal specification derived from the validated prototype.",
      provider: "claude",
      producePrompt: (ctx) => `
Write a formal specification for the work, derived from the validated prototype
and prior context.

==== PROBLEM ====
${ctx.priorArtifacts.discuss!.body}
==== END ====

==== PROTOTYPE ====
${ctx.priorArtifacts.prototype!.body}
==== END ====

Produce a markdown spec with these sections:

  ## Overview
  One paragraph. What this delivers, end-to-end.

  ## Public interface
  Every function / module / endpoint that callers will use. For each:
    - **Signature** (fenced ${language} code block)
    - **Inputs**: types and meaning
    - **Outputs**: types and meaning
    - **Errors / edge cases**: NaN, empty, negative, missing, etc. — be explicit.

  ## Invariants
  Bullet list. Things that must always be true regardless of inputs.

  ## Non-goals
  Bullet list. Things this spec does NOT promise.

Output ONLY the markdown body. No top-level code fences.
      `.trim(),
      rubric: (ctx) => `
You are a strict spec reviewer.

==== PROBLEM (authoritative scope) ====
${ctx.priorArtifacts.discuss!.body}
==== END ====

Rubric (10 pts):
  C1 [3] Every "In scope" item from Problem is covered by the spec
  C2 [3] Public interface includes Signature + Inputs + Outputs + Errors for
        each item — no missing edge case sections
  C3 [2] Invariants are non-trivial (not restatements of types)
  C4 [2] Non-goals match the Problem's Out of scope

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
      preReview: contractGuard,
    },

    {
      name: "usage",
      description: "Concrete real-world usage scenarios for each public-interface item.",
      provider: "claude",
      producePrompt: (ctx) => `
Given the spec below, write realistic usage scenarios for each item in its
Public interface section.

==== SPEC ====
${ctx.priorArtifacts.spec!.body}
==== END ====

For each public item, write:

  ## <itemName>
  - **Scenario 1**: <named context, e.g. "Discord bot daily P&L summary">
    - Input:  <concrete value>
    - Expected output: <exact string or value>
  - **Scenario 2**: ...
  - **Scenario 3**: ...

Use concrete, named contexts (not abstract "user does X"). Include at least one
edge-case scenario per item (negative, NaN, large, empty, etc).

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the usage doc.

==== SPEC (authoritative interface list) ====
${ctx.priorArtifacts.spec!.body}
==== END ====

Rubric (10 pts):
  C1 [4] Every Public interface item from the spec has at least 3 scenarios
  C2 [3] Scenarios are concrete with named contexts (not abstract)
  C3 [3] Expected outputs are exact values/strings (not approximations or
        descriptions)

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
    },

    {
      name: "tkt",
      description: "Lossless decomposition into atomic implementation tickets.",
      preReview: contractGuard,
      provider: "claude",
      producePrompt: (ctx) => `
Decompose the spec + usage into atomic implementation tickets — one per
public-interface item from the spec.

==== SPEC ====
${ctx.priorArtifacts.spec!.body}
==== END ====

==== USAGE ====
${ctx.priorArtifacts.usage!.body}
==== END ====

For each ticket:
  ## T<n>: <ItemName>
  - **Signature** (fenced ${language} code block)
  - **Acceptance criteria**: bulleted list. EVERY criterion must be derivable
    from spec OR usage. Do not lose information.
  - **Out of scope**: bullet list of things this ticket does NOT do.

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the ticket decomposition for losslessness.

==== SPEC ====
${ctx.priorArtifacts.spec!.body}
==== END ====

==== USAGE ====
${ctx.priorArtifacts.usage!.body}
==== END ====

Rubric (10 pts):
  C1 [4] Exactly one ticket per public-interface item in the spec
  C2 [3] Acceptance criteria are explicit and bulleted
  C3 [3] Acceptance criteria reference behaviour from BOTH spec AND usage —
        no requirement silently dropped

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
    },

    // ─────────────────────────────────────────────────────────────────────
    // Phase 3: Implement & Quality-Gate
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "dev",
      description: "Implement EVERY ticket (T1..Tn) via forEach. Each iteration is its own Quality Loop.",
      provider: "claude",
      intent: "synthetic",
      // Dev defaults to TEXT-ONLY (no tools): the canonical AgentFlow design
      // is "agent outputs code, engine commits it" — tools aren't required to
      // produce an artifact. Wrappers that target a real codebase can
      // override perPhase to grant Read.
      forEach: {
        source: (ctx) => {
          const items = parseTicketsFromBody(ctx.priorArtifacts.tkt!.body);
          if (items.length === 0) {
            throw new Error(
              `SDD dev forEach: no '## T<n>: ...' tickets found in tkt artifact.`,
            );
          }
          return items;
        },
        producePrompt: (ctx, item) => `
Implement ticket ${item.id} below. Treat its acceptance criteria as authoritative —
every example listed must work.

==== TICKET ${item.id} (authoritative for this iteration) ====
${item.data as string}
==== END ====

==== SPEC (reference — for cross-checking signatures and shared invariants only) ====
${ctx.priorArtifacts.spec!.body}
==== END ====

Output ONLY the ${language} source for ${item.id}. No prose. No markdown fences.
No JSDoc unless strictly needed for non-obvious behaviour. Must satisfy every
acceptance criterion in ${item.id}.
        `.trim(),
        rubric: (_ctx, item) => `
You are reviewing the ${item.id} implementation against the authoritative ticket
below. Cross-check exclusively against ${item.id}; other tickets are out of scope.

==== TICKET ${item.id} (authoritative) ====
${item.data as string}
==== END ====

Rubric (10 pts):
  C1 [3] Signature exactly matches ${item.id}'s signature
  C2 [4] Every acceptance criterion in ${item.id} is satisfied. Mentally trace each
        example (input -> expected output) against the code. If ANY example
        would fail, C2 fails — no partial credit.
  C3 [1] No console.log, no side effects, pure where the spec calls for purity
  C4 [2] Code is readable and free of obvious bugs

${SCORE_JSON_INSTRUCTION}
        `.trim(),
        targetScore: 9,
        maxRepeat: 3,
      },
    },

    {
      name: "review",
      description: `Full-scope verification by ${reviewProviderDisplay} across every dev iteration (cross-model gate).`,
      provider: "codex",
      runOptions: { reasoningEffort: "medium", reasoningEffortMaxFor80kInput: "medium" },
      producePrompt: (ctx) => `
You are performing a final review on EVERY ticket implementation below.
Cross-check each one against its ticket. Use the TICKETS list to verify
that every ticket has an implementation.

==== TICKETS (decomposition; ground truth for what was planned) ====
${ctx.priorArtifacts.tkt!.body}
==== END ====

==== IMPLEMENTATIONS (one section per dev iteration) ====
${formatDevIterations(ctx)}
==== END ====

Produce a markdown review document with these sections:

  ## Verdict
  ONE of: APPROVE / REQUEST CHANGES / REJECT. One sentence rationale that
  references the overall implementation state (e.g. "All N tickets satisfy
  their acceptance criteria" or "T3 fails C2 because ...").

  ## Findings
  Bullet list. Every concrete issue found, each tagged [blocking] or [nit].
  Group by iteration id when applicable (e.g. "T3 [blocking] ...").

  ## Test sketch
  For each iteration, list a couple of representative inputs and expected
  outputs from THAT ticket's acceptance criteria that you mentally traced.

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the review report itself — not the implementations under review. The
critical check is that the review is GROUNDED in what each iteration's
implementation literally contains; structural completeness alone does not pass.

==== TICKETS (authoritative) ====
${ctx.priorArtifacts.tkt!.body}
==== END ====

==== IMPLEMENTATIONS (the only code the review may discuss) ====
${formatDevIterations(ctx)}
==== END ====

Rubric (10 pts):
  C1 [2] Verdict is APPROVE / REQUEST CHANGES / REJECT with a one-sentence
        rationale that references the overall implementation state.
  C2 [3] Findings are tagged [blocking] vs [nit] (or "no findings" with a
        verdict of APPROVE). Each finding is specific: it names a ticket id
        (e.g. "T3 ...") and a concrete claim. Generic / unfocused findings
        ("the code is unclear") do not count. A finding about a missing
        requirement (e.g. "T2 acceptance criterion X is not addressed")
        DOES count — review of forEach implementations naturally surfaces
        gaps relative to ticket criteria.
  C3 [3] Test sketch covers MOST iterations (at least half). Each trace
        names inputs and expected outputs from the corresponding ticket's
        acceptance criteria. Cross-iteration references are allowed when
        the trace explicitly says which iter provides the referenced
        function (e.g. "subscribe (defined in T3) then publish (defined in
        T4) ..."). A trace that invents a function nowhere in
        IMPLEMENTATIONS or TICKETS is hallucination — fail C3.
  C4 [2] If any ticket from TICKETS has NO iteration in IMPLEMENTATIONS,
        the review must SAY SO — verdict lowered to REQUEST CHANGES with a
        [blocking] finding, or explicit caveat in the rationale. Silent
        APPROVE on a partial implementation set fails C4.

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 7,
      maxRepeat: 3,
    },

    {
      name: "wrap",
      description: "Clean exit — produce the final sprint summary.",
      provider: "claude",
      producePrompt: (ctx) => `
Produce a final sprint summary suitable for archiving alongside the artifacts.

==== TICKETS (full decomposition) ====
${ctx.priorArtifacts.tkt!.body}
==== END ====

==== IMPLEMENTATIONS (every ticket that shipped, one section per iteration) ====
${formatDevIterations(ctx)}
==== END ====

==== REVIEW ====
${ctx.priorArtifacts.review!.body}
==== END ====

==== PROBLEM (for Success-criteria check ONLY — not for describing what shipped) ====
${ctx.priorArtifacts.discuss!.body}
==== END ====

Produce a markdown document with:

  ## What shipped
  One paragraph. Describe ONLY what the IMPLEMENTATIONS block above literally
  contains, ticket by ticket. DO NOT describe functions, modules, or behaviour
  outside that block. Call out which tickets were implemented and which were
  not (compare against the TICKETS list). If any iteration was force-passed
  (its score shows in the per-iter heading), flag that explicitly. The
  Problem statement describes the eventual goal — it is NOT what shipped.

  ## Success criteria check
  For each success criterion from the Problem statement, mark MET / PARTIAL /
  NOT MET with one short reason. Use the IMPLEMENTATIONS block as ground
  truth — a criterion that requires code not in any iteration is NOT MET
  (or PARTIAL if a foundational piece is present).

  ## Open follow-ups
  Bullet list. Every ticket from the TICKETS decomposition that has NO
  corresponding iteration in the IMPLEMENTATIONS block. Plus any carry-over
  from Review's findings.

  ## Audit trail
  Bullet list pointing readers to the step artifacts and git tags. Use the
  recipe step names: discuss, explore, prototype, spec, usage, tkt, dev,
  review, wrap. For dev, name each iteration id.

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the sprint summary. The summary's job is HONESTY about what shipped,
not selling the Problem's vision.

==== PROBLEM (authoritative success criteria) ====
${ctx.priorArtifacts.discuss!.body}
==== END ====

==== TICKETS (full decomposition — the ground truth for "what was planned") ====
${ctx.priorArtifacts.tkt!.body}
==== END ====

==== IMPLEMENTATIONS (the ground truth for "what shipped") ====
${formatDevIterations(ctx)}
==== END ====

Rubric (10 pts):
  C1 [3] "What shipped" describes ONLY what is in IMPLEMENTATIONS, ticket by
        ticket. If it claims any function/module/behaviour absent from the
        block, C1 fails — no partial credit. (This is the recipe's biggest
        known hallucination risk; be strict.)
  C2 [2] Success criteria check uses MET / PARTIAL / NOT MET correctly:
        criteria needing code absent from every iteration must be NOT MET.
  C3 [1] Open follow-ups explicitly name tickets that have NO iteration in
        IMPLEMENTATIONS (cross-check ids against TICKETS).
  C4 [1] Audit trail names all 9 recipe steps; for dev, each iteration id.
  C5 [2 pts] Ticket consistency — uses guard_report:
        - If guard_report STATUS = MISMATCH, this step scores at most 4 (hard cap on aggregate score, regardless of other criteria).
        - Every entry in "## What shipped" must correspond to one of guard_report's actual_dev_iterations; every actual_dev_iteration must appear somewhere in "## What shipped".
        - guard_report.missing_from_claims and guard_report.phantom_claims are authoritative for this criterion. Do not second-guess them.
  C6 [1] No generic boilerplate; wording is grounded in this sprint's
        specific artifacts.

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 8,
      maxRepeat: 3,
      preReview: wrapTicketConsistencyGuard,
    },
  ],
  };
  return {
    ...baseRecipe,
    steps: baseRecipe.steps.map((step) =>
      applyStepOverride(step, overrides[step.name as SDDStepName]),
    ),
  };
}

/** Default SDD recipe with language="TypeScript". */
export const recipe: Recipe = createSDDRecipe();
