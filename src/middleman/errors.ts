export type Provider =
  | "claude"
  | "codex"
  | "openai-compatible"
  | "openrouter"
  | "gemini"
  | "gemini-oauth"
  | "antigravity";

export class StepTimeoutError extends Error {
  readonly provider: Provider;
  readonly elapsedMs: number;
  constructor(provider: Provider, elapsedMs: number) {
    super(`${provider} step timed out after ${elapsedMs}ms`);
    this.name = "StepTimeoutError";
    this.provider = provider;
    this.elapsedMs = elapsedMs;
  }
}

export class ScoreParseError extends Error {
  readonly rawReview: string;
  readonly attempt: number;
  constructor(rawReview: string, attempt: number) {
    const preview = rawReview.slice(0, 200).replace(/\s+/g, " ");
    super(
      `Could not parse score from review (attempt ${attempt}). ` +
      `First 200 chars: "${preview}"`
    );
    this.name = "ScoreParseError";
    this.rawReview = rawReview;
    this.attempt = attempt;
  }
}
