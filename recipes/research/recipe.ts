import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Recipe,
  StepContext,
  ForEachItem,
  StepProviderOverride,
} from "../../src/recipe/types.js";
import { applyProviderOverride } from "../../src/recipe/types.js";
import type { Provider } from "../../src/middleman/provider.js";

/**
 * 6-step Research recipe — produces a structured research report from a
 * free-form research brief. Demonstrates that AgentFlow's recipe DSL is
 * not accidentally over-fit to SDD: same engine, different artifact
 * shape (a report, not code).
 *
 * Input contract:
 *   `<sprintDir>/INPUT.md` — the research question in the user's own
 *   words. Anything from one sentence to a short brief.
 *
 * Phases:
 *   1-2 Explore & Scope:    Frame · Plan
 *   3   Investigate forEach: one iter per sub-question parsed from Plan
 *   4-6 Synthesise & Gate:  Synthesize · Critique · Finalize
 *
 * Plan-step output format (parsed by the Investigate forEach.source):
 *   ## Q<n> [exploratory|normative]: <human label>
 *     - <bullets>
 *
 * The `[exploratory]` vs `[normative]` tag is the routing knob:
 * exploratory sub-questions go to gemini-3.1-flash-lite (cheap survey
 * of context), normative ones stay on Claude (precise claims grounded
 * in the frame's success criteria).
 *
 * targetScore policy:
 *   - Soft steps (frame, finalize):  8 (directional correctness)
 *   - Plan, investigate iters, synthesize: 9 (canonical default)
 *   - Critique (meta-rubric):         7 (same rationale as SDD review)
 */

const SCORE_JSON_INSTRUCTION = `Output ONLY a single-line JSON object, no prose, no fences:
{"score": <0-10>, "passed": [<C-ids>], "failed": [<C-ids>], "notes": "<one short sentence>"}`;

function readInput(sprintDir: string): string {
  const path = join(sprintDir, "INPUT.md");
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    throw new Error(
      `Research recipe requires <sprintDir>/INPUT.md describing the research question. Missing: ${path}`,
    );
  }
}

export type ResearchSubQuestionTag = "exploratory" | "normative";

export interface ResearchSubQuestionData {
  tag: ResearchSubQuestionTag;
  body: string;
}

/**
 * Parses `## Q<n> [exploratory|normative]: <label>` headers out of the
 * plan-step artifact body. Each ForEachItem.data carries the tag plus
 * the per-Q markdown body (header + bullets).
 *
 * Exported for direct testing.
 */
export function parseSubQuestionsFromBody(planBody: string): ForEachItem[] {
  const items: ForEachItem[] = [];
  const headerRe = /^##\s+(Q\d+)\s*\[(exploratory|normative)\]:\s*(.*)$/;
  let current:
    | { id: string; label?: string; tag: ResearchSubQuestionTag; lines: string[] }
    | null = null;
  for (const line of planBody.split("\n")) {
    const m = line.match(headerRe);
    if (m) {
      if (current) {
        const data: ResearchSubQuestionData = {
          tag: current.tag,
          body: current.lines.join("\n"),
        };
        items.push({ id: current.id, label: current.label, data });
      }
      current = {
        id: m[1]!,
        label: m[3]?.trim() || undefined,
        tag: m[2] as ResearchSubQuestionTag,
        lines: [line],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    const data: ResearchSubQuestionData = {
      tag: current.tag,
      body: current.lines.join("\n"),
    };
    items.push({ id: current.id, label: current.label, data });
  }
  return items;
}

/**
 * Inlines every Investigate iteration body for downstream synthesis.
 * Tag info is intentionally NOT emitted here — the engine's standard
 * frontmatter doesn't carry the [exploratory|normative] annotation
 * (that lives in `ctx.priorArtifacts.plan.body`'s Q-headers). Synthesis
 * / critique / finalize prompts already inline the PLAN, so the tag is
 * one re-read away when needed.
 */
function formatInvestigateIterations(ctx: StepContext): string {
  const iters = ctx.priorIterations.investigate ?? {};
  const ids = Object.keys(iters);
  if (ids.length === 0) return "(no investigate iterations found)";
  return ids
    .map((id) => {
      const a = iters[id]!;
      const meta = `score=${a.frontmatter.score}, attempts=${a.frontmatter.attempts}${a.frontmatter.forced ? ", forced" : ""}`;
      return `### ${id} (${meta})\n\n${a.body}`;
    })
    .join("\n\n---\n\n");
}

export interface ResearchRecipeOptions {
  /**
   * Per-step provider overrides. Mirror SDDRecipeOptions.stepProviders
   * for Phase 5 lite-preset wiring; the engine applies these via
   * `applyProviderOverride` at recipe-build time, same auto-drop rules.
   */
  stepProviders?: Partial<Record<ResearchStepName, StepProviderOverride>>;
  /**
   * Static per-sub-question pin for the investigate forEach. Wins over
   * the recipe's default `[exploratory] -> gemini` routing for matching
   * Q-ids. Serializable — `run-research.ts` can snapshot it into
   * `state.recipeOptions` for resume parity.
   */
  pinIters?: Partial<Record<string, StepProviderOverride>>;
}

export type ResearchStepName =
  | "frame"
  | "plan"
  | "investigate"
  | "synthesize"
  | "critique"
  | "finalize";

/**
 * Default per-sub-question routing: `[exploratory]` -> Gemini Flash-Lite,
 * `[normative]` -> undefined (= step-level default, which is Claude).
 * Exported for offline testing.
 */
export function defaultProviderForSubQuestion(
  item: ForEachItem,
): StepProviderOverride | undefined {
  const data = item.data as ResearchSubQuestionData | undefined;
  if (data?.tag === "exploratory") {
    return { provider: "gemini" as Provider, model: "gemini-3.1-flash-lite" };
  }
  return undefined;
}

function applyStepOverride(
  step: ResearchStepDef,
  override: StepProviderOverride | undefined,
): ResearchStepDef {
  if (!override) return step;
  const { provider, options } = applyProviderOverride(step.provider, step.runOptions, override);
  return { ...step, provider, runOptions: options };
}

// Local alias: ResearchStepDef is a Recipe step with a `name` typed to
// the literal step-name union. We narrow via cast inside the recipe
// constructor; the engine sees it as a normal StepDef.
type ResearchStepDef = Recipe["steps"][number];

export function createResearchRecipe(opts: ResearchRecipeOptions = {}): Recipe {
  const overrides = opts.stepProviders ?? {};
  const baseRecipe: Recipe = {
  name: "research",
  description:
    "Research recipe — 6 steps producing a structured research report. Takes a free-form question at <sprintDir>/INPUT.md and produces a critiqued findings document with full audit trail.",
  steps: [
    // ─────────────────────────────────────────────────────────────────────
    // Phase 1: Explore & Scope
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "frame",
      description: "Refine the raw research brief into a scoped research question.",
      provider: "claude",
      producePrompt: (ctx) => `
You are a research lead turning a rough question into something a small
team can actually investigate. Read the brief and produce a scoped
research frame.

==== RAW BRIEF (from <sprintDir>/INPUT.md) ====
${readInput(ctx.sprintDir)}
==== END ====

Produce a markdown document with these sections (in order):

  ## Research question
  One or two sentences. The single, well-scoped question this work answers.

  ## Why it matters
  One paragraph. What decision or downstream action this informs.

  ## In scope
  Bullet list. The angles this research WILL cover.

  ## Out of scope
  Bullet list. Adjacent angles deliberately excluded.

  ## Success criteria
  Bullet list. Concrete tests a reader could apply to judge whether the
  final report answered the question well.

  ## Open assumptions
  Bullet list. Anything the brief is silent on that this research will
  proceed under unless contradicted.

Output ONLY the markdown body.
      `.trim(),
      rubric: `
You are a strict reviewer scoring a research frame. The point is
directional correctness — clarity and scope.

Rubric (10 pts):
  C1 [3] All six sections present (Research question, Why it matters,
        In scope, Out of scope, Success criteria, Open assumptions)
  C2 [3] Research question is a single, answerable question — not a
        topic header ("on X") or a multi-question bundle.
  C3 [2] In scope vs Out of scope are non-empty and meaningfully distinct.
  C4 [2] Success criteria are concrete (a reader could verify them) —
        not vague like "comprehensive coverage".

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 8,
      maxRepeat: 3,
    },

    {
      name: "plan",
      description: "Decompose the framed question into 3-7 tagged sub-questions.",
      provider: "claude",
      producePrompt: (ctx) => `
You have a scoped research frame (below). Decompose the research
question into 3-7 sub-questions an investigator can tackle independently.
Tag each sub-question:

  - [exploratory] — surveys context, history, ecosystem, positioning.
    Tolerant of best-effort summarisation.
  - [normative]   — requires precise claims grounded in the success
    criteria. Mistakes here invalidate the final report.

The investigate step routes [exploratory] tags through a cheaper model
and [normative] tags through the default — so be honest about which is
which.

==== FRAME ====
${ctx.priorArtifacts.frame!.body}
==== END ====

For each sub-question:

  ## Q<n> [<tag>]: <human-readable label>
  - **Angle**: one sentence on the angle this sub-question investigates.
  - **Deliverable**: one sentence on what the investigate step should
    produce for this sub-question (form: claims + evidence + confidence).
  - **Cross-references**: optional bullet list of other Q-ids this
    sub-question depends on or informs.

Output ONLY the markdown body. Use 3-7 sub-questions inclusive; fewer
than 3 is under-decomposed, more than 7 is over-decomposed.
      `.trim(),
      rubric: (ctx) => `
Score the sub-question decomposition.

==== FRAME (authoritative scope) ====
${ctx.priorArtifacts.frame!.body}
==== END ====

Rubric (10 pts):
  C1 [3] Between 3 and 7 sub-questions inclusive. Each header matches
        EXACTLY the regex \`^## Q\\d+ \\[(exploratory|normative)\\]: .+\$\`.
  C2 [3] Every In-scope angle from the FRAME is covered by at least
        one sub-question; no sub-question expands beyond the frame's
        scope.
  C3 [2] Each sub-question has Angle + Deliverable bullets (Cross-references
        optional).
  C4 [2] Tags are sensible: angles that survey context / positioning
        are [exploratory]; angles that produce precise claims tied to
        the frame's success criteria are [normative].

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
    },

    // ─────────────────────────────────────────────────────────────────────
    // Phase 2: Investigate (forEach over sub-questions)
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "investigate",
      description: "Investigate EVERY sub-question (Q1..Qn). Per-iter Quality Loop; [exploratory] routes to Gemini Flash-Lite.",
      provider: "claude",
      intent: "synthetic",
      forEach: {
        source: (ctx) => {
          const items = parseSubQuestionsFromBody(ctx.priorArtifacts.plan!.body);
          if (items.length === 0) {
            throw new Error(
              `Research investigate forEach: no '## Q<n> [exploratory|normative]: ...' sub-questions found in plan artifact.`,
            );
          }
          return items;
        },
        producePrompt: (ctx, item) => {
          const data = item.data as ResearchSubQuestionData;
          return `
You are investigating sub-question ${item.id} below. Stay scoped to THIS
sub-question — other sub-questions are out of scope for this iteration.

==== SUB-QUESTION ${item.id} [${data.tag}] (authoritative for this iteration) ====
${data.body}
==== END ====

==== FRAME (reference — for success-criteria + scope cross-check) ====
${ctx.priorArtifacts.frame!.body}
==== END ====

Produce a markdown document with these sections (in order):

  ## Claims
  Bullet list. Each claim is a single declarative sentence answering
  some part of this sub-question. Be specific — names, numbers,
  qualified statements. Avoid hedges that don't carry information.

  ## Supporting evidence
  Bullet list. For each claim above, one or more pieces of evidence —
  reasoning, named examples, observed behaviour. Group by claim with
  short headings if there are >3 claims.

  ## Counter-evidence / contradictions
  Bullet list. Cases where the supporting evidence is contested,
  partial, or has known exceptions. If none, write "No significant
  counter-evidence found, because <reason>" — never leave empty.

  ## Confidence
  ONE of: low / medium / high. One-sentence rationale that names the
  weakest claim.

  ## Out of scope for this sub-question
  Bullet list. Angles deliberately deferred to other sub-questions or
  out-of-scope per the FRAME.

Output ONLY the markdown body.
          `.trim();
        },
        rubric: (_ctx, item) => {
          const data = item.data as ResearchSubQuestionData;
          return `
You are reviewing the ${item.id} investigation against the authoritative
sub-question below. Stay scoped — claims about other sub-questions are
out of scope.

==== SUB-QUESTION ${item.id} [${data.tag}] (authoritative) ====
${data.body}
==== END ====

Rubric (10 pts):
  C1 [3] All five sections present (Claims, Supporting evidence,
        Counter-evidence / contradictions, Confidence, Out of scope).
  C2 [3] Claims are concrete — at least 3 bullets, each a single
        declarative sentence answering some part of the sub-question.
        Vague claims ("X is good") fail C2.
  C3 [2] Counter-evidence section is non-empty (either lists contested
        cases OR explicitly states "No significant counter-evidence
        found, because <reason>").
  C4 [2] Confidence is one of low/medium/high WITH a one-sentence
        rationale that names the weakest claim. Bare "Confidence: high"
        fails C4.

${SCORE_JSON_INSTRUCTION}
          `.trim();
        },
        targetScore: 9,
        maxRepeat: 3,
        providerForItem: defaultProviderForSubQuestion,
        providerForItemById: opts.pinIters,
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // Phase 3: Synthesize & Gate
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "synthesize",
      description: "Combine per-Q findings into a coherent overall answer.",
      provider: "claude",
      producePrompt: (ctx) => `
You have a research frame, a sub-question plan, and one investigation
per sub-question. Produce a synthesis that answers the FRAME's
research question end-to-end.

==== FRAME ====
${ctx.priorArtifacts.frame!.body}
==== END ====

==== PLAN ====
${ctx.priorArtifacts.plan!.body}
==== END ====

==== INVESTIGATIONS (one section per sub-question) ====
${formatInvestigateIterations(ctx)}
==== END ====

Produce a markdown document with these sections:

  ## Direct answer
  One paragraph. Answer the FRAME's research question. Reference
  sub-question ids in parens (e.g. "(Q1, Q3)") for traceability.

  ## Key claims
  Bullet list. The strongest claims supported across investigations.
  Each bullet ends with a parenthesised list of sub-question ids that
  support it.

  ## Tensions and trade-offs
  Bullet list. Where investigations disagreed, qualified each other,
  or surfaced trade-offs. Name the sub-questions involved.

  ## Confidence
  Per sub-question: \`Q<n> = low / medium / high\`. One-line summary
  of OVERALL confidence (weakest sub-question wins).

  ## What's still uncertain
  Bullet list. Open questions the research did not close, with one
  sentence each on what would close them.

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the synthesis. It must be grounded in the INVESTIGATIONS — no
claim that is absent from every per-Q artifact.

==== FRAME (authoritative scope) ====
${ctx.priorArtifacts.frame!.body}
==== END ====

==== INVESTIGATIONS (the only source the synthesis may discuss) ====
${formatInvestigateIterations(ctx)}
==== END ====

Rubric (10 pts):
  C1 [3] "Direct answer" answers the FRAME's research question and
        references at least two sub-question ids in parens.
  C2 [3] "Key claims" bullets each carry a parenthesised sub-question
        ref. Claims absent from EVERY investigation fail C2.
  C3 [2] "Tensions and trade-offs" names specific sub-questions and
        captures real disagreement (or, if none, says so honestly).
  C4 [2] Confidence section maps each sub-question id to a level AND
        gives an overall summary. Missing per-Q entries fail C4.

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
    },

    {
      name: "critique",
      description: "Cross-model critique of the synthesis grounded in per-Q investigations.",
      provider: "gemini",
      runOptions: { model: "gemini-3.1-flash-lite" },
      producePrompt: (ctx) => `
You are critiquing the synthesis below for groundedness and rigour.
Cross-check every claim against the INVESTIGATIONS — claims absent from
every per-Q artifact are hallucinations, regardless of how plausible
they sound.

==== INVESTIGATIONS (ground truth for what was actually researched) ====
${formatInvestigateIterations(ctx)}
==== END ====

==== SYNTHESIS (the document under critique) ====
${ctx.priorArtifacts.synthesize!.body}
==== END ====

Produce a markdown document with these sections:

  ## Verdict
  ONE of: APPROVE / APPROVE-WITH-CONDITIONS / REQUEST CHANGES / REJECT.
  One sentence rationale that references the synthesis's overall state
  (e.g. "Direct answer is grounded but Q4 confidence claim isn't
  supported by Q4's investigation.").

  ## Findings
  Bullet list. Every concrete issue, tagged [blocking] or [nit]. Group
  by sub-question id when applicable. Specific is the bar: "Q3 claims
  X but Q3's investigation only supports Y" beats "the synthesis is
  unclear".

  ## Hallucination check
  For each Key claim in the synthesis, name the supporting investigation
  artifact (Q<n>) or flag the claim as unsupported. Cross-iteration
  references are allowed when explicit (e.g. "claim about subscribe
  draws from Q3 + Q4").

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the critique itself — not the synthesis. The critical check is
that the critique is GROUNDED in the INVESTIGATIONS; structural
completeness alone does not pass.

==== INVESTIGATIONS (the only code-of-record the critique may discuss) ====
${formatInvestigateIterations(ctx)}
==== END ====

==== SYNTHESIS ====
${ctx.priorArtifacts.synthesize!.body}
==== END ====

Rubric (10 pts):
  C1 [2] Verdict is APPROVE / APPROVE-WITH-CONDITIONS / REQUEST CHANGES
        / REJECT with a one-sentence rationale that references the
        synthesis's state.
  C2 [3] Findings are tagged [blocking] vs [nit]. Each finding names a
        sub-question id and a concrete claim. Generic findings ("the
        synthesis is unclear") do not count.
  C3 [3] Hallucination check covers MOST Key claims (at least half).
        Each entry names the supporting Q<n> or flags the claim as
        unsupported. Inventing a Q-id that does not exist in
        INVESTIGATIONS fails C3.
  C4 [2] If a Key claim is unsupported by EVERY investigation, the
        critique must SAY SO — verdict lowered to REQUEST CHANGES (or
        worse) with a [blocking] finding. Silent APPROVE on an
        unsupported claim fails C4.

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 7,
      maxRepeat: 3,
    },

    {
      name: "finalize",
      description: "Produce the final archivable research report + audit trail.",
      provider: "claude",
      producePrompt: (ctx) => `
Produce a final research report suitable for archiving alongside the
artifacts. The report is the document a reader who never saw the
sprint should be able to consume standalone.

==== FRAME ====
${ctx.priorArtifacts.frame!.body}
==== END ====

==== PLAN ====
${ctx.priorArtifacts.plan!.body}
==== END ====

==== INVESTIGATIONS (one section per sub-question) ====
${formatInvestigateIterations(ctx)}
==== END ====

==== SYNTHESIS ====
${ctx.priorArtifacts.synthesize!.body}
==== END ====

==== CRITIQUE ====
${ctx.priorArtifacts.critique!.body}
==== END ====

Produce a markdown document with these sections:

  ## Executive summary
  ≤ 5 bullets. The headline answer + key supporting claims. No new
  material — only material already in SYNTHESIS or INVESTIGATIONS.

  ## Direct answer
  Lift from SYNTHESIS. Adjust for any [blocking] findings the critique
  raised: if a Key claim was flagged unsupported, soften or remove it.

  ## Key findings by sub-question
  For each Q<n> in INVESTIGATIONS, a one-paragraph summary of that
  sub-question's main findings + confidence. Reference the per-Q
  artifact path.

  ## Open questions and follow-up research
  Bullet list. Carries forward CRITIQUE's [blocking] findings still
  open + SYNTHESIS's "What's still uncertain" entries. Each item ends
  with one sentence on what would resolve it.

  ## Audit trail
  Bullet list pointing readers to: frame, plan, investigate (each
  Q-id), synthesize, critique, finalize. Use the recipe step names.

Output ONLY the markdown body.
      `.trim(),
      rubric: (ctx) => `
Score the final report. The report's job is HONESTY about what the
research established — no quiet expansion beyond SYNTHESIS, no claims
that contradict the CRITIQUE.

==== SYNTHESIS (authoritative for "what the research concluded") ====
${ctx.priorArtifacts.synthesize!.body}
==== END ====

==== CRITIQUE (authoritative for "where the synthesis was challenged") ====
${ctx.priorArtifacts.critique!.body}
==== END ====

Rubric (10 pts):
  C1 [3] Executive summary contains no claim absent from SYNTHESIS.
        Quiet expansion fails C1.
  C2 [2] If CRITIQUE raised a [blocking] finding, the report's Direct
        answer reflects it (softened, qualified, or removed). Ignoring
        a [blocking] finding fails C2.
  C3 [2] Key findings by sub-question covers every Q-id from
        INVESTIGATIONS — no silent drop.
  C4 [2] Open questions section lists CRITIQUE's still-open [blocking]
        findings AND SYNTHESIS's "still uncertain" entries. Empty
        section when CRITIQUE was REQUEST CHANGES fails C4.
  C5 [1] Audit trail names all 6 recipe steps; for investigate, lists
        each Q-id present in INVESTIGATIONS.

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 8,
      maxRepeat: 3,
    },
  ],
  };
  // Apply opts.stepProviders to each step. Investigate's forEach.providerForItem
  // and forEach.providerForItemById are set inside the step definition above
  // (recipe-level); opts.stepProviders applies to the step container itself
  // (default-provider swap for the step as a whole — useful for routing
  // synthesize or finalize to a cheaper model).
  return {
    ...baseRecipe,
    steps: baseRecipe.steps.map((step) =>
      applyStepOverride(step as ResearchStepDef, overrides[step.name as ResearchStepName]),
    ),
  };
}

/** Default Research recipe. */
export const recipe: Recipe = createResearchRecipe();
