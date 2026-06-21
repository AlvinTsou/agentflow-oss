/**
 * Phase 7.3 — per-sprint `agentflow.config.json` loader + validator.
 *
 * One file at `<sprintDir>/agentflow.config.json`, JSONC (// and / * * /
 * comments stripped before JSON.parse). Schema covers per-step
 * targetScore / maxRepeat / onMaxRepeat / skipStep / provider / model /
 * gateRequired plus top-level `recipe`, `language`, `gate.defaultMode`,
 * and `forEach.<step>.pinIters`. Recipe-level defaults apply for any
 * field the config doesn't set; config wins when both present.
 *
 * The engine loads + validates this file on every runSprint() entry
 * (init AND resume) so user edits between `ag init` and `ag run` reach
 * the executing loop, and so resumes after a config edit pick up the
 * new values. The resolved view is snapshotted into
 * `state.recipeOptions.effectiveConfig` for audit.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Provider } from "../middleman/provider.js";
import type { Recipe } from "../recipe/types.js";
import type { MiddlemanPolicy } from "../middleman/policy.js";

export type GateDefaultMode = "auto" | "human-in-the-loop";

export type ConfigOnMaxRepeat = "abort" | "force-pass" | "human-intervene";

/** Per-phase override exposed in config — review phase only (Slice scope). */
export interface ConfigPerPhase {
  review?: { provider?: Provider; model?: string };
}

export interface ConfigStep {
  skipStep?: boolean;
  targetScore?: number;
  maxRepeat?: number;
  onMaxRepeat?: ConfigOnMaxRepeat;
  provider?: Provider;
  model?: string;
  gateRequired?: boolean;
  /**
   * Phase 7.4 — inject `.agentflow-feedback/` feedback into this step's
   * producePrompt + rubric. Default true; set false to keep human
   * context out of dev / forEach-style steps where prose feedback
   * could confuse the producer.
   */
  consumeFeedback?: boolean;
  /** Per-phase review provider/model override (review phase only). */
  perPhase?: ConfigPerPhase;
}

export interface ConfigForEachStep {
  pinIters?: Record<string, string>;
}

export interface AgentFlowConfig {
  recipe?: string;
  language?: string;
  gate?: { defaultMode?: GateDefaultMode };
  steps?: Record<string, ConfigStep>;
  forEach?: Record<string, ConfigForEachStep>;
  policy?: MiddlemanPolicy;
  /** Phase B-6 Self-Feeding Loops config */
  selfFeeding?: {
    enabled?: boolean;
    maxFollowUps?: number;
  };
}

const KNOWN_PROVIDERS: ReadonlySet<Provider> = new Set([
  "claude",
  "codex",
  "openai-compatible",
  "openrouter",
  "gemini",
  "gemini-oauth",
  "antigravity",
]);

const ON_MAX_REPEAT_VALUES: ReadonlyArray<ConfigOnMaxRepeat> = [
  "abort",
  "force-pass",
  "human-intervene",
];

const GATE_DEFAULT_MODE_VALUES: ReadonlyArray<GateDefaultMode> = [
  "auto",
  "human-in-the-loop",
];

/**
 * Strip `//` and `/ * * /` comments so JSON.parse succeeds on JSONC.
 * String-aware: never strips inside a "..." literal. Does NOT support
 * trailing commas — keep the config terse, no dangling separators.
 */
export function stripJsonComments(s: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  let escape = false;
  while (i < s.length) {
    const c = s[i]!;
    if (inStr) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inStr = false;
      }
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Validate parsed config against the recipe's step set. Unknown step
 * names are a hard error (almost always a typo). Unknown TOP-LEVEL keys
 * are tolerated for forward compat. The recipe-name mismatch is a
 * warning printed to stderr, not an error — sprints can legitimately be
 * re-run with a different recipe name in the file (e.g. variant lock).
 */
export function validateConfig(raw: unknown, recipe: Recipe): AgentFlowConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("agentflow.config.json root must be a JSON object.");
  }
  const cfg = raw as Record<string, unknown>;
  const result: AgentFlowConfig = {};

  if ("recipe" in cfg) {
    if (typeof cfg.recipe !== "string") {
      throw new ConfigError(`"recipe" must be a string (got ${typeof cfg.recipe}).`);
    }
    result.recipe = cfg.recipe;
    if (cfg.recipe !== recipe.name) {
      console.warn(
        `[config-loader] config.recipe="${cfg.recipe}" but engine recipe is "${recipe.name}" — using the engine's recipe.`,
      );
    }
  }

  if ("language" in cfg) {
    if (typeof cfg.language !== "string") {
      throw new ConfigError(`"language" must be a string.`);
    }
    result.language = cfg.language;
  }

  if ("gate" in cfg) {
    const g = cfg.gate;
    if (g === null || typeof g !== "object" || Array.isArray(g)) {
      throw new ConfigError(`"gate" must be an object.`);
    }
    const gateCfg = g as Record<string, unknown>;
    const out: { defaultMode?: GateDefaultMode } = {};
    if ("defaultMode" in gateCfg) {
      const mode = gateCfg.defaultMode;
      if (!GATE_DEFAULT_MODE_VALUES.includes(mode as GateDefaultMode)) {
        throw new ConfigError(
          `"gate.defaultMode" must be one of ${GATE_DEFAULT_MODE_VALUES.join(" | ")} (got ${JSON.stringify(mode)}).`,
        );
      }
      out.defaultMode = mode as GateDefaultMode;
    }
    result.gate = out;
  }

  const stepNames = new Set(recipe.steps.map((s) => s.name));

  if ("steps" in cfg) {
    const s = cfg.steps;
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new ConfigError(`"steps" must be an object.`);
    }
    const outSteps: Record<string, ConfigStep> = {};
    for (const [stepName, stepRaw] of Object.entries(s as Record<string, unknown>)) {
      if (!stepNames.has(stepName)) {
        throw new ConfigError(
          `"steps.${stepName}" is not a known step in recipe "${recipe.name}" (known: ${[...stepNames].join(", ")}).`,
        );
      }
      if (stepRaw === null || typeof stepRaw !== "object" || Array.isArray(stepRaw)) {
        throw new ConfigError(`"steps.${stepName}" must be an object.`);
      }
      outSteps[stepName] = validateStepConfig(stepName, stepRaw as Record<string, unknown>);
    }
    result.steps = outSteps;
  }

  if ("forEach" in cfg) {
    const f = cfg.forEach;
    if (f === null || typeof f !== "object" || Array.isArray(f)) {
      throw new ConfigError(`"forEach" must be an object.`);
    }
    const outFe: Record<string, ConfigForEachStep> = {};
    for (const [stepName, feRaw] of Object.entries(f as Record<string, unknown>)) {
      if (!stepNames.has(stepName)) {
        throw new ConfigError(
          `"forEach.${stepName}" is not a known step in recipe "${recipe.name}".`,
        );
      }
      if (feRaw === null || typeof feRaw !== "object" || Array.isArray(feRaw)) {
        throw new ConfigError(`"forEach.${stepName}" must be an object.`);
      }
      const feCfg = feRaw as Record<string, unknown>;
      const feOut: ConfigForEachStep = {};
      if ("pinIters" in feCfg) {
        const p = feCfg.pinIters;
        if (p === null || typeof p !== "object" || Array.isArray(p)) {
          throw new ConfigError(`"forEach.${stepName}.pinIters" must be an object.`);
        }
        const pinOut: Record<string, string> = {};
        for (const [iterId, spec] of Object.entries(p as Record<string, unknown>)) {
          if (typeof spec !== "string") {
            throw new ConfigError(
              `"forEach.${stepName}.pinIters.${iterId}" must be a string like "provider" or "provider:model".`,
            );
          }
          pinOut[iterId] = spec;
        }
        feOut.pinIters = pinOut;
      }
      outFe[stepName] = feOut;
    }
    result.forEach = outFe;
  }

  if ("policy" in cfg) {
    result.policy = validatePolicyConfig(cfg.policy);
  }

  if ("selfFeeding" in cfg) {
    const sf = cfg.selfFeeding;
    if (sf === null || typeof sf !== "object" || Array.isArray(sf)) {
      throw new ConfigError(`"selfFeeding" must be an object.`);
    }
    const sfCfg = sf as Record<string, unknown>;
    const outSf: { enabled?: boolean; maxFollowUps?: number } = {};
    if ("enabled" in sfCfg) {
      if (typeof sfCfg.enabled !== "boolean") {
        throw new ConfigError(`"selfFeeding.enabled" must be a boolean.`);
      }
      outSf.enabled = sfCfg.enabled;
    }
    if ("maxFollowUps" in sfCfg) {
      if (typeof sfCfg.maxFollowUps !== "number" || !Number.isInteger(sfCfg.maxFollowUps) || sfCfg.maxFollowUps < 0) {
        throw new ConfigError(`"selfFeeding.maxFollowUps" must be a non-negative integer.`);
      }
      outSf.maxFollowUps = sfCfg.maxFollowUps;
    }
    result.selfFeeding = outSf;
  }

  return result;
}

function validatePolicyConfig(raw: unknown): MiddlemanPolicy {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`"policy" must be an object.`);
  }
  const policyCfg = raw as Record<string, unknown>;
  const out: MiddlemanPolicy = {};

  if ("profile" in policyCfg) {
    const prof = policyCfg.profile;
    if (prof !== "default" && prof !== "strict" && prof !== "off") {
      throw new ConfigError(`"policy.profile" must be one of "default" | "strict" | "off".`);
    }
    out.profile = prof;
  }

  if ("redactSecrets" in policyCfg) {
    if (typeof policyCfg.redactSecrets !== "boolean") {
      throw new ConfigError(`"policy.redactSecrets" must be a boolean.`);
    }
    out.redactSecrets = policyCfg.redactSecrets;
  }

  if ("blockSecrets" in policyCfg) {
    if (typeof policyCfg.blockSecrets !== "boolean") {
      throw new ConfigError(`"policy.blockSecrets" must be a boolean.`);
    }
    out.blockSecrets = policyCfg.blockSecrets;
  }

  if ("maxEstimatedTokens" in policyCfg) {
    if (typeof policyCfg.maxEstimatedTokens !== "number" || !Number.isFinite(policyCfg.maxEstimatedTokens)) {
      throw new ConfigError(`"policy.maxEstimatedTokens" must be a number.`);
    }
    out.maxEstimatedTokens = policyCfg.maxEstimatedTokens;
  }

  if ("customRedactions" in policyCfg) {
    const cr = policyCfg.customRedactions;
    if (!Array.isArray(cr)) {
      throw new ConfigError(`"policy.customRedactions" must be an array.`);
    }
    const outCr: Array<{ kind: string; pattern: string; replacement?: string }> = [];
    for (let idx = 0; idx < cr.length; idx++) {
      const item = cr[idx];
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new ConfigError(`"policy.customRedactions[${idx}]" must be an object.`);
      }
      const crItem = item as Record<string, unknown>;
      if (!("kind" in crItem) || typeof crItem.kind !== "string") {
        throw new ConfigError(`"policy.customRedactions[${idx}].kind" must be a string.`);
      }
      if (!("pattern" in crItem) || typeof crItem.pattern !== "string") {
        throw new ConfigError(`"policy.customRedactions[${idx}].pattern" must be a string.`);
      }
      const validItem: { kind: string; pattern: string; replacement?: string } = {
        kind: crItem.kind,
        pattern: crItem.pattern,
      };
      if ("replacement" in crItem) {
        if (typeof crItem.replacement !== "string") {
          throw new ConfigError(`"policy.customRedactions[${idx}].replacement" must be a string.`);
        }
        validItem.replacement = crItem.replacement;
      }
      outCr.push(validItem);
    }
    out.customRedactions = outCr;
  }

  return out;
}

function validateStepConfig(stepName: string, raw: Record<string, unknown>): ConfigStep {
  const out: ConfigStep = {};
  if ("skipStep" in raw) {
    if (typeof raw.skipStep !== "boolean") {
      throw new ConfigError(`"steps.${stepName}.skipStep" must be a boolean.`);
    }
    out.skipStep = raw.skipStep;
  }
  if ("targetScore" in raw) {
    if (typeof raw.targetScore !== "number" || !Number.isFinite(raw.targetScore)) {
      throw new ConfigError(`"steps.${stepName}.targetScore" must be a finite number.`);
    }
    out.targetScore = raw.targetScore;
  }
  if ("maxRepeat" in raw) {
    if (typeof raw.maxRepeat !== "number" || !Number.isInteger(raw.maxRepeat) || raw.maxRepeat < 1) {
      throw new ConfigError(`"steps.${stepName}.maxRepeat" must be a positive integer.`);
    }
    out.maxRepeat = raw.maxRepeat;
  }
  if ("onMaxRepeat" in raw) {
    if (!ON_MAX_REPEAT_VALUES.includes(raw.onMaxRepeat as ConfigOnMaxRepeat)) {
      throw new ConfigError(
        `"steps.${stepName}.onMaxRepeat" must be one of ${ON_MAX_REPEAT_VALUES.join(" | ")}.`,
      );
    }
    out.onMaxRepeat = raw.onMaxRepeat as ConfigOnMaxRepeat;
  }
  if ("provider" in raw) {
    if (!KNOWN_PROVIDERS.has(raw.provider as Provider)) {
      throw new ConfigError(
        `"steps.${stepName}.provider" must be one of ${[...KNOWN_PROVIDERS].join(" | ")} (got ${JSON.stringify(raw.provider)}).`,
      );
    }
    out.provider = raw.provider as Provider;
  }
  if ("model" in raw) {
    if (typeof raw.model !== "string") {
      throw new ConfigError(`"steps.${stepName}.model" must be a string.`);
    }
    out.model = raw.model;
  }
  if ("gateRequired" in raw) {
    if (typeof raw.gateRequired !== "boolean") {
      throw new ConfigError(`"steps.${stepName}.gateRequired" must be a boolean.`);
    }
    out.gateRequired = raw.gateRequired;
  }
  if ("consumeFeedback" in raw) {
    if (typeof raw.consumeFeedback !== "boolean") {
      throw new ConfigError(`"steps.${stepName}.consumeFeedback" must be a boolean.`);
    }
    out.consumeFeedback = raw.consumeFeedback;
  }
  if ("perPhase" in raw) {
    const pp = raw.perPhase;
    if (typeof pp !== "object" || pp === null) {
      throw new ConfigError(`"steps.${stepName}.perPhase" must be an object.`);
    }
    const unsupported = Object.keys(pp as Record<string, unknown>).filter((k) => k !== "review");
    if (unsupported.length > 0) {
      throw new ConfigError(
        `"steps.${stepName}.perPhase" supports only "review" (got ${unsupported.map((k) => JSON.stringify(k)).join(", ")}).`,
      );
    }
    const review = (pp as { review?: unknown }).review;
    if (review !== undefined) {
      if (typeof review !== "object" || review === null) {
        throw new ConfigError(`"steps.${stepName}.perPhase.review" must be an object.`);
      }
      const r = review as { provider?: unknown; model?: unknown };
      const outReview: { provider?: Provider; model?: string } = {};
      if (r.provider !== undefined) {
        if (!KNOWN_PROVIDERS.has(r.provider as Provider)) {
          throw new ConfigError(
            `"steps.${stepName}.perPhase.review.provider" must be one of ${[...KNOWN_PROVIDERS].join(" | ")} (got ${JSON.stringify(r.provider)}).`,
          );
        }
        outReview.provider = r.provider as Provider;
      }
      if (r.model !== undefined) {
        if (typeof r.model !== "string") {
          throw new ConfigError(`"steps.${stepName}.perPhase.review.model" must be a string.`);
        }
        outReview.model = r.model;
      }
      out.perPhase = { review: outReview };
    }
  }
  return out;
}

/**
 * Read + parse + validate `<sprintDir>/agentflow.config.json`. Returns
 * `null` when the file is absent (engine falls back to recipe defaults).
 */
export function loadConfig(sprintDir: string, recipe: Recipe): AgentFlowConfig | null {
  const path = join(sprintDir, "agentflow.config.json");
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (err) {
    throw new ConfigError(
      `agentflow.config.json failed to parse: ${(err as Error).message}`,
    );
  }
  return validateConfig(parsed, recipe);
}

/**
 * Resolved per-step view used by the engine loop. `gateRequired` carries
 * the step-explicit value OR the seeded value from `gate.defaultMode`.
 */
export interface EffectiveStep {
  skipStep: boolean;
  targetScore?: number;
  maxRepeat?: number;
  onMaxRepeat?: ConfigOnMaxRepeat;
  provider?: Provider;
  model?: string;
  gateRequired: boolean;
  /** Phase 7.4 — defaults to true; config opt-out per step. */
  consumeFeedback: boolean;
  perPhase?: ConfigPerPhase;
}

export interface EffectiveConfig {
  recipe: string;
  language?: string;
  gateDefaultMode: GateDefaultMode;
  steps: Record<string, EffectiveStep>;
  forEach: Record<string, ConfigForEachStep>;
  policy?: MiddlemanPolicy;
  selfFeeding?: {
    enabled: boolean;
    maxFollowUps: number;
  };
}

/**
 * Resolve the engine's effective view over (recipe defaults, config
 * overrides, gate.defaultMode seeding). Snapshotted into
 * `state.recipeOptions.effectiveConfig` so a reader can reconstruct
 * what governed each step without re-running the merge.
 */
export function resolveEffectiveConfig(
  recipe: Recipe,
  config: AgentFlowConfig | null,
): EffectiveConfig {
  const gateDefaultMode: GateDefaultMode = config?.gate?.defaultMode ?? "auto";
  const defaultGateRequired = gateDefaultMode === "human-in-the-loop";
  const steps: Record<string, EffectiveStep> = {};
  for (const step of recipe.steps) {
    const ov = config?.steps?.[step.name];
    steps[step.name] = {
      skipStep: ov?.skipStep ?? false,
      ...(ov?.targetScore !== undefined ? { targetScore: ov.targetScore } : {}),
      ...(ov?.maxRepeat !== undefined ? { maxRepeat: ov.maxRepeat } : {}),
      ...(ov?.onMaxRepeat !== undefined ? { onMaxRepeat: ov.onMaxRepeat } : {}),
      ...(ov?.provider !== undefined ? { provider: ov.provider } : {}),
      ...(ov?.model !== undefined ? { model: ov.model } : {}),
      gateRequired: ov?.gateRequired ?? defaultGateRequired,
      consumeFeedback: ov?.consumeFeedback ?? true,
      ...(ov?.perPhase !== undefined ? { perPhase: ov.perPhase } : {}),
    };
  }

  const selfFeeding = {
    enabled: config?.selfFeeding?.enabled ?? recipe.selfFeeding?.enabled ?? false,
    maxFollowUps: config?.selfFeeding?.maxFollowUps ?? recipe.selfFeeding?.maxFollowUps ?? 3,
  };

  return {
    recipe: recipe.name,
    ...(config?.language !== undefined ? { language: config.language } : {}),
    gateDefaultMode,
    steps,
    forEach: config?.forEach ?? {},
    ...(config?.policy !== undefined ? { policy: config.policy } : {}),
    selfFeeding,
  };
}
