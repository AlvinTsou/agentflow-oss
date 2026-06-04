/**
 * INPUT-fidelity contract gate (Slice 1) — pure functions.
 *
 * Parses `agentflow-contract` fenced blocks from an INPUT.md body and checks a
 * step's output for the presence of every mandated literal / field token.
 * Conservative & missing-only: a token counts as present if it appears as a
 * complete token anywhere in the output (table, code, or prose). No semantic
 * equivalence, no alias recognition. Errs toward false-negative (won't flag)
 * because the downstream clamp is harsh.
 */

export interface Contract {
  literals: Map<string, string[]>;
  fields: Map<string, string[]>;
}

export interface ContractCheck {
  status: "OK" | "MISMATCH" | "NONE";
  missingLiterals: string[];
  missingFields: string[];
}

const BLOCK_RE = /```agentflow-contract\s*\n([\s\S]*?)```/g;
const LINE_RE = /^(literals|fields)\s+(\S+)\s*:\s*(.+)$/;

export function parseContractBlocks(inputMd: string): Contract {
  const literals = new Map<string, string[]>();
  const fields = new Map<string, string[]>();
  for (const block of inputMd.matchAll(BLOCK_RE)) {
    const body = block[1] ?? "";
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = LINE_RE.exec(line);
      if (!m) continue; // tolerant: skip malformed line, never void the block
      const kind = m[1] as "literals" | "fields";
      const name = m[2]!;
      const values = m[3]!
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      if (values.length === 0) continue;
      const target = kind === "literals" ? literals : fields;
      const prev = target.get(name) ?? [];
      // same-name union merge, de-duplicated, insertion order preserved
      target.set(name, Array.from(new Set([...prev, ...values])));
    }
  }
  return { literals, fields };
}

export function escapeRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPresent(token: string, output: string): boolean {
  // complete-token / complete-identifier match; metachars escaped, word
  // Boundaries prevent substring false-matches (e.g. TASK_FAILED_X).
  return new RegExp(`\\b${escapeRegExp(token)}\\b`).test(output);
}

export function checkContract(contract: Contract, output: string): ContractCheck {
  const allLiterals = Array.from(new Set([...contract.literals.values()].flat()));
  const allFields = Array.from(new Set([...contract.fields.values()].flat()));
  if (allLiterals.length === 0 && allFields.length === 0) {
    return { status: "NONE", missingLiterals: [], missingFields: [] };
  }
  const missingLiterals = allLiterals.filter((t) => !isPresent(t, output));
  const missingFields = allFields.filter((t) => !isPresent(t, output));
  const status =
    missingLiterals.length === 0 && missingFields.length === 0 ? "OK" : "MISMATCH";
  return { status, missingLiterals, missingFields };
}

// ---- Slice 2: heuristic extraction (warning-only; never clamps) ----
// Scans only `ts` / `typescript` fences. Conservative by design: extracts
// members of >=2-member string-literal unions, and leading `identifier:` field
// names inside interface / type-object blocks. Best-effort regex (not a TS
// parser) — under/over-extraction is acceptable because the result is advisory.

const TS_FENCE_RE = /```(?:ts|typescript)\b[^\n]*\n([\s\S]*?)```/gi;
// A run of >=2 string literals joined by `|`, optionally preceded by `name:` / `name =`.
const UNION_RE =
  /(?:\b(\w+)\s*\??\s*[:=]\s*)?((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(?:\s*\|\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"))+)/g;
// Individual string literals within a union run (capture inner text).
const STR_RE = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
// An interface / type-object block; body captured up to a line-leading `}`.
const IFACE_RE = /(?:interface\s+(\w+)[^\n{]*|type\s+(\w+)\s*=)\s*\{([\s\S]*?)\n\s*\}/g;
// A field line: leading identifier before an optional `?` and a colon.
const FIELD_RE = /^[ \t]*(\w+)\s*\??\s*:/gm;

function mergeInto(map: Map<string, string[]>, name: string, values: string[]): void {
  if (values.length === 0) return;
  const prev = map.get(name) ?? [];
  map.set(name, Array.from(new Set([...prev, ...values])));
}

export function extractHeuristicContract(inputMd: string): Contract {
  const literals = new Map<string, string[]>();
  const fields = new Map<string, string[]>();

  let tsBody = "";
  for (const fence of inputMd.matchAll(TS_FENCE_RE)) tsBody += `${fence[1] ?? ""}\n`;
  if (tsBody.length === 0) return { literals, fields };

  // literals: members of >=2-member string-literal unions
  for (const u of tsBody.matchAll(UNION_RE)) {
    const name = u[1] ?? "<union>";
    const run = u[2] ?? "";
    const members: string[] = [];
    for (const s of run.matchAll(STR_RE)) members.push(s[1] ?? s[2] ?? "");
    if (members.length >= 2) mergeInto(literals, name, members);
  }

  // fields: leading `identifier:` members of interface / type-object blocks
  for (const block of tsBody.matchAll(IFACE_RE)) {
    const name = block[1] ?? block[2] ?? "<type>";
    const body = block[3] ?? "";
    const fs: string[] = [];
    for (const f of body.matchAll(FIELD_RE)) fs.push(f[1]!);
    mergeInto(fields, name, fs);
  }

  return { literals, fields };
}
