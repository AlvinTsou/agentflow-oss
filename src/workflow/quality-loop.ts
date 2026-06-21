import { runStep, type StepResult } from "../middleman/claude.js";
import { ScoreParseError } from "../middleman/errors.js";
import type { PreReviewResult } from "../recipe/types.js";

export type StepRunner = (prompt: string) => Promise<StepResult>;

export interface QualityLoopConfig {
  producePrompt: string;
  reviewPromptFor: (output: string) => string;
  fixPromptFor: (output: string, reviewReport: string) => string;
  /**
   * Parse score 0-10 from review text. Return `null` to signal the review
   * text was malformed (regex miss, no JSON, etc.) — quality-loop will then
   * throw `ScoreParseError` rather than silently treating it as score=0.
   */
  parseScore: (reviewReport: string) => number | null;
  targetScore?: number;
  maxRepeat?: number;
  onPhase?: (event: PhaseEvent) => void | Promise<void>;
  /**
   * Skip the initial `produce` step and seed the loop with this text.
   * Useful for testing the Review/Fix path in isolation or for
   * re-entering the loop on a pre-existing artifact.
   */
  seedOutput?: string;
  /** Override step runner per phase. Default: Claude SDK (`runStep`). */
  producer?: StepRunner;
  reviewer?: StepRunner;
  fixer?: StepRunner;
  /**
   * Secondary reviewer used only when the primary review output cannot be
   * parsed by `parseScore` (returns null). Lets a Claude review path recover
   * from a malformed JSON emission by re-asking Codex. Primary's failed
   * output is still emitted as a phase event (score undefined, fallback=false)
   * before the fallback call.
   */
  reviewFallback?: StepRunner;
  /**
   * Optional callback invoked with each produce output before that round's
   * review. Returns a string injected into the reviewer prompt as a
   * `<!-- guard_report -->...<!-- /guard_report -->` block. Sprint-engine
   * partially-applies StepContext when wiring this up.
   */
  preReview?: (output: string) => string | PreReviewResult | Promise<string | PreReviewResult>;
  /** Optional checkpoint to seed the loop and resume from a specific phase/attempt */
  seedCheckpoint?: {
    phase: "produce" | "review" | "fix";
    attempt: number;
    output: string;
    score?: number;
    history: PhaseEvent[];
  };
}

export interface PhaseEvent {
  phase: "produce" | "review" | "fix";
  attempt: number;
  score?: number;
  step: StepResult;
  /** True when this event is the fallback reviewer recovering from a primary parse-failure. */
  fallback?: boolean;
}

export interface QualityLoopResult {
  passed: boolean;
  finalOutput: string;
  finalScore: number;
  attempts: number;
  totalTokens: number;
  totalCostUsd: number;
  history: PhaseEvent[];
  /** Guard result (PreReviewResult) for the SHIPPED artifact (finalOutput).
   *  undefined when no preReview hook ran or it returned a plain string. */
  finalGuard?: PreReviewResult;
}

export async function qualityLoop(cfg: QualityLoopConfig): Promise<QualityLoopResult> {
  const targetScore = cfg.targetScore ?? 9;
  const maxRepeat = cfg.maxRepeat ?? 3;
  const producer = cfg.producer ?? runStep;
  const reviewer = cfg.reviewer ?? runStep;
  const fixer = cfg.fixer ?? runStep;

  const history: PhaseEvent[] = cfg.seedCheckpoint ? [...cfg.seedCheckpoint.history] : [];
  let totalTokens = 0;
  let totalCost = 0;

  for (const ev of history) {
    totalTokens += ev.step.totalTokens;
    totalCost += ev.step.costUsd;
  }

  let attempt = 1;
  let lastScore = 0;
  let bestScore = 0;
  let bestOutput = "";
  let bestGuard: PreReviewResult | undefined;
  let bestSet = false;

  if (cfg.seedCheckpoint) {
    for (const ev of history) {
      if (ev.phase === "review" && ev.score !== undefined) {
        const score = ev.score;
        const prodEv = history.find(
          (h) =>
            (h.phase === "produce" && h.attempt === ev.attempt) ||
            (h.phase === "fix" && h.attempt === ev.attempt)
        );
        const prodOutput = prodEv ? prodEv.step.output : (cfg.seedOutput ?? "");
        if (!bestSet || score > bestScore) {
          bestSet = true;
          bestScore = score;
          bestOutput = prodOutput;
        }
      }
    }
  }

  const record = async (ev: PhaseEvent) => {
    history.push(ev);
    totalTokens += ev.step.totalTokens;
    totalCost += ev.step.costUsd;
    await cfg.onPhase?.(ev);
  };

  let produce: StepResult;
  let review: StepResult | undefined;

  if (cfg.seedCheckpoint) {
    attempt = cfg.seedCheckpoint.attempt;
    
    if (cfg.seedCheckpoint.phase === "produce" || cfg.seedCheckpoint.phase === "fix") {
      produce = {
        output: cfg.seedCheckpoint.output,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        costUsd: 0,
      };
      if (bestOutput === "") {
        bestOutput = produce.output;
      }
    } else {
      const lastProduceEv = history.find(
        (h) =>
          (h.phase === "produce" && h.attempt === attempt) ||
          (h.phase === "fix" && h.attempt === attempt)
      );
      const lastProduceOutput = lastProduceEv ? lastProduceEv.step.output : "";
      
      produce = {
        output: lastProduceOutput,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        costUsd: 0,
      };
      if (bestOutput === "") {
        bestOutput = lastProduceOutput;
      }
      
      review = {
        output: cfg.seedCheckpoint.output,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        costUsd: 0,
      };

      if (attempt < maxRepeat) {
        produce = await fixer(cfg.fixPromptFor(produce.output, review.output));
        attempt++;
        await record({ phase: "fix", attempt, step: produce });
      } else {
        return {
          passed: false,
          finalOutput: bestOutput,
          finalScore: bestScore,
          attempts: attempt,
          totalTokens,
          totalCostUsd: totalCost,
          history,
          finalGuard: bestGuard,
        };
      }
    }
  } else {
    if (cfg.seedOutput !== undefined) {
      produce = {
        output: cfg.seedOutput,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        costUsd: 0,
      };
      bestOutput = cfg.seedOutput;
    } else {
      produce = await producer(cfg.producePrompt);
      await record({ phase: "produce", attempt: 1, step: produce });
      bestOutput = produce.output;
    }
  }

  while (attempt <= maxRepeat) {
    const baseReviewPrompt = cfg.reviewPromptFor(produce.output);
    let reviewPrompt = baseReviewPrompt;
    let scoreCap: number | undefined;
    let guardResult: PreReviewResult | undefined;
    if (cfg.preReview) {
      const guard = await cfg.preReview(produce.output);
      const guardReport = typeof guard === "string" ? guard : guard.report;
      if (typeof guard !== "string") {
        scoreCap = guard.scoreCap;
        guardResult = guard;
      }
      if (guardReport && guardReport.trim().length > 0) {
        reviewPrompt = `${baseReviewPrompt}\n\n<!-- guard_report -->\n${guardReport}\n<!-- /guard_report -->`;
      }
    }
    // Run the primary reviewer. Recover via the cross-model fallback on EITHER
    // a throw (timeout / non-zero exit) OR an unparseable score. A codex primary
    // has no fallback, so its failure stays fatal.
    let review!: StepResult;
    let parsed: number | null = null;
    let caught: unknown;
    let caughtError = false;
    try {
      review = await reviewer(reviewPrompt);
      parsed = cfg.parseScore(review.output);
    } catch (err) {
      caught = err;
      caughtError = true;
    }

    if ((caughtError || parsed === null) && cfg.reviewFallback) {
      // Emit the failed primary review (only when we actually got one — a
      // thrown primary leaves `review` unset) so the trace shows the attempt.
      if (!caughtError) {
        await record({ phase: "review", attempt, step: review });
      }
      const fallback = await cfg.reviewFallback(reviewPrompt);
      const fallbackParsed = cfg.parseScore(fallback.output);
      if (fallbackParsed === null) {
        throw new ScoreParseError(fallback.output, attempt);
      }
      review = fallback;
      parsed = fallbackParsed;
      lastScore = parsed;
      if (scoreCap !== undefined && lastScore > scoreCap) lastScore = scoreCap;
      await record({ phase: "review", attempt, score: lastScore, step: review, fallback: true });
    } else if (caughtError) {
      throw caught; // no fallback available -> the reviewer throw is fatal
    } else if (parsed === null) {
      throw new ScoreParseError(review.output, attempt);
    } else {
      lastScore = parsed;
      if (scoreCap !== undefined && lastScore > scoreCap) lastScore = scoreCap;
      await record({ phase: "review", attempt, score: lastScore, step: review });
    }

    if (!bestSet || lastScore > bestScore) {
      bestSet = true;
      bestScore = lastScore;
      bestOutput = produce.output;
      bestGuard = guardResult;
    }

    if (lastScore >= targetScore) {
      return {
        passed: true,
        finalOutput: produce.output,
        finalScore: lastScore,
        attempts: attempt,
        totalTokens,
        totalCostUsd: totalCost,
        history,
        // pass: the current attempt IS the shipped artifact (not best-so-far).
        finalGuard: guardResult,
      };
    }

    if (attempt === maxRepeat) break;

    produce = await fixer(cfg.fixPromptFor(produce.output, review.output));
    attempt++;
    await record({ phase: "fix", attempt, step: produce });
  }

  return {
    passed: false,
    finalOutput: bestOutput,
    finalScore: bestScore,
    attempts: attempt,
    totalTokens,
    totalCostUsd: totalCost,
    history,
    finalGuard: bestGuard,
  };
}
