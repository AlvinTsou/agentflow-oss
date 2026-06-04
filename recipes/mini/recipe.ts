import type { Recipe } from "../../src/recipe/types.js";

/**
 * Mini self-test recipe — INTENTIONALLY TypeScript-only.
 *
 * This 4-step recipe (spec → usage → tkt → dev) is the engine's self-test;
 * its job is to exercise the workflow runtime end-to-end against a real LLM
 * in ~$0.4. Parameterising the language (like SDD's `createSDDRecipe`) would
 * add noise without value — the recipe's worth is in proving the ENGINE
 * works, not in language coverage. Multi-language coverage is SDD's domain.
 *
 * If a future Phase needs a non-TS self-test, prefer adding a second mini
 * recipe (e.g. `recipes/mini-rust/`) over parameterising this one.
 */

const SCORE_JSON_INSTRUCTION = `Output ONLY a single-line JSON object, no prose, no fences:
{"score": <0-10>, "passed": [<C-ids>], "failed": [<C-ids>], "notes": "<one short sentence>"}`;

export const recipe: Recipe = {
  name: "mini-money-formatter",
  description:
    "4-step synthetic pipeline that designs and implements a MoneyFormatter module. Used to validate the AgentFlow engine end-to-end.",
  steps: [
    {
      name: "spec",
      description: "Markdown specification for a MoneyFormatter TS module",
      provider: "claude",
      producePrompt: `
Write a Markdown specification for a TypeScript module called MoneyFormatter.
It must export four functions:
  - formatMoney(n: number): string
  - parseMoney(s: string): number
  - roundMoney(n: number, digits: number): number
  - abbreviateMoney(n: number): string  // returns "$1.23K", "$1.23M", "$1.23B", "$1.23T"

For EACH function, write three subsections in this order:
  ### Signature      (a fenced TypeScript code block with the signature)
  ### Examples       (3-4 bullets: \`formatMoney(1234) -> "$1,234.00"\` style)
  ### Behavior       (one paragraph covering normal + edge cases: NaN, Infinity, negative, zero, precision)

Output ONLY the markdown body. No code fences around the whole document.
      `.trim(),
      rubric: `
You are a strict spec reviewer. Score the Markdown spec 0-10.

Rubric (10 pts):
  C1 [3] All four functions are documented
  C2 [3] Each function has Signature + Examples + Behavior subsections
  C3 [2] Edge cases explicitly covered: NaN, Infinity, negative
  C4 [2] Signatures are valid TypeScript

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
    },
    {
      name: "usage",
      description: "Real-world usage scenarios per function, derived from spec",
      provider: "claude",
      producePrompt: (ctx) => `
Given this specification:

${ctx.priorArtifacts.spec!.body}

Write a Markdown document showing REALISTIC usage scenarios for each of the four
functions. For each function, write:

  ## <functionName>
  - **Scenario 1**: <named context, e.g. "Discord bot daily P&L summary">
    - Input:  <concrete value>
    - Expected output: <exact string>
  - **Scenario 2**: ...
  - **Scenario 3**: ...

Use concrete, named contexts (not abstract "user does X"). Include at least one
edge-case scenario per function (negative, NaN, large number, precision).

Output ONLY the markdown body.
      `.trim(),
      rubric: `
Score 0-10 the usage doc:

Rubric (10 pts):
  C1 [4] All four functions have at least 3 scenarios each
  C2 [3] Scenarios are concrete and named (not abstract)
  C3 [3] Expected outputs are exact strings (not approximations)

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
    },
    {
      name: "tkt",
      description: "Lossless decomposition into 4 atomic implementation tickets",
      provider: "claude",
      producePrompt: (ctx) => `
Given this spec and usage:

==== SPEC ====
${ctx.priorArtifacts.spec!.body}

==== USAGE ====
${ctx.priorArtifacts.usage!.body}

Decompose into EXACTLY FOUR atomic implementation tickets, one per function.

For each ticket, write:
  ## T<n>: <FunctionName>
  - **Function**: signature
  - **Acceptance criteria**: bulleted list, EVERY criterion derived from spec OR usage. Be explicit; do not lose information.
  - **Out of scope**: bullet list of things this ticket does NOT need to do.

Output ONLY the markdown body.
      `.trim(),
      rubric: `
Score 0-10 the ticket decomposition:

Rubric (10 pts):
  C1 [4] Exactly 4 tickets, one per function in the spec
  C2 [3] Acceptance criteria are explicit and bulleted
  C3 [3] Acceptance criteria reference behaviour from BOTH spec AND usage (lossless)

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
    },
    {
      name: "dev",
      description: "Implement ticket T1 (formatMoney). T2..T4 intentionally skipped — mini exercises the single-pass path; SDD recipe exercises the forEach path.",
      provider: "claude",
      producePrompt: (ctx) => `
Implement ticket T1 (formatMoney) using these tickets and spec as authoritative
references:

==== TICKETS ====
${ctx.priorArtifacts.tkt!.body}

==== SPEC ====
${ctx.priorArtifacts.spec!.body}

Output ONLY the TypeScript code for the formatMoney function. No prose. No
markdown fences. No JSDoc unless strictly needed. Must satisfy every acceptance
criterion listed for T1.
      `.trim(),
      rubric: (ctx) => `
You are reviewing a formatMoney implementation against the authoritative
ticket T1 below. The ticket lists every acceptance criterion; do not invent
or skip any.

==== TICKET T1 (authoritative) ====
${ctx.priorArtifacts.tkt!.body}
==== END ====

Rubric (10 pts):
  C1 [3] Signature exactly matches: export function formatMoney(n: number): string
  C2 [4] Every acceptance criterion from T1 is satisfied. Mentally trace each
        example in T1 (input -> expected output) against the code. If ANY
        example would not match, C2 fails — no partial credit.
  C3 [1] No console.log, no side effects, pure function
  C4 [2] Code is readable and free of obvious bugs

${SCORE_JSON_INSTRUCTION}
      `.trim(),
      targetScore: 9,
      maxRepeat: 3,
    },
  ],
};
