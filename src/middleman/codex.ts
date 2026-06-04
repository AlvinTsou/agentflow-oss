import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_LIMIT, type StepResult } from "./claude.js";
import { StepTimeoutError } from "./errors.js";

export const REASONING_CAP_THRESHOLD_TOKENS = 60_000;

const REASONING_ORDER: Record<"low" | "medium" | "high" | "xhigh", number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
};

/** Returns whichever of `effort` and `cap` represents LESS reasoning. */
export function clampReasoningEffort(
  effort: "low" | "medium" | "high" | "xhigh" | undefined,
  cap: "low" | "medium" | "high",
): "low" | "medium" | "high" | "xhigh" {
  const baseline = effort ?? "high";
  return REASONING_ORDER[baseline] <= REASONING_ORDER[cap] ? baseline : cap;
}

/** Crude ~4-char-per-token estimate. Underestimates code; that's fine — we
 * only need a rough trigger for the cap. */
export function estimatePromptTokens(prompt: string): number {
  return Math.floor(prompt.length / 4);
}

export interface CodexOptions {
  /** Model override. Codex CLI default is gpt-5.5. */
  model?: string;
  /** Lower reasoning effort to slash token cost. Default in CLI = "high". */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  /**
   * When the estimated input prompt exceeds an internal threshold
   * (currently 60K tokens, well below the 80K circuit breaker), clamps
   * `reasoningEffort` so it never exceeds this cap. Below the threshold, the
   * original `reasoningEffort` setting is used.
   *
   * Use to declare "this step should auto-degrade reasoning when input is
   * large" without recipe code estimating tokens itself.
   */
  reasoningEffortMaxFor80kInput?: "low" | "medium" | "high";
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Optional ms timeout. */
  timeoutMs?: number;
}

export async function runCodexStep(
  prompt: string,
  options: CodexOptions = {}
): Promise<StepResult> {
  const start = Date.now();
  const tmp = mkdtempSync(join(tmpdir(), "agentflow-codex-"));
  const outFile = join(tmp, "last.txt");

  let resolvedEffort = options.reasoningEffort;
  if (options.reasoningEffortMaxFor80kInput) {
    const estimated = estimatePromptTokens(prompt);
    if (estimated > REASONING_CAP_THRESHOLD_TOKENS) {
      const capped = clampReasoningEffort(resolvedEffort, options.reasoningEffortMaxFor80kInput);
      if (capped !== resolvedEffort) {
        process.stderr.write(
          `[codex] reasoning capped to ${capped} (estimated ${estimated} tokens > ${REASONING_CAP_THRESHOLD_TOKENS})\n`,
        );
      }
      resolvedEffort = capped;
    }
  }

  const args = [
    "exec",
    "--skip-git-repo-check",
    "-o",
    outFile,
  ];
  if (options.model) {
    args.push("-m", options.model);
  }
  if (resolvedEffort) {
    args.push("-c", `model_reasoning_effort="${resolvedEffort}"`);
  }
  args.push(prompt);

  let captured = "";

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const proc = spawn("codex", args, {
        cwd: options.cwd ?? process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let timedOut = false;
      const onData = (d: Buffer) => {
        if (!timedOut) captured += d.toString();
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      proc.on("error", (err) => {
        if (!timedOut) reject(err);
      });
      proc.on("exit", (code) => {
        if (!timedOut) resolve(code ?? -1);
      });
      if (options.timeoutMs) {
        setTimeout(() => {
          timedOut = true;
          proc.stdout.removeListener("data", onData);
          proc.stderr.removeListener("data", onData);
          proc.kill("SIGTERM");
          reject(new StepTimeoutError("codex", Date.now() - start));
        }, options.timeoutMs).unref();
      }
    });

    if (exitCode !== 0) {
      throw new Error(
        `codex exec failed (exit ${exitCode}). Last output:\n${captured.slice(-800)}`
      );
    }

    const output = readFileSync(outFile, "utf-8").trim();
    const m = captured.match(/tokens used\s+([\d,]+)/i);
    if (!m) {
      throw new Error(
        `codex token usage line not found in output — circuit breaker cannot be ` +
        `enforced. Last 400 chars:\n${captured.slice(-400)}`
      );
    }
    const totalTokens = Number(m[1].replace(/,/g, ""));

    if (totalTokens > TOKEN_LIMIT) {
      throw new Error(
        `Circuit breaker: codex step used ${totalTokens} tokens (> ${TOKEN_LIMIT}).`
      );
    }

    return {
      output,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens,
      durationMs: Date.now() - start,
      costUsd: 0,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
