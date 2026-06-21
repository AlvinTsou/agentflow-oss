import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

export interface StreamingCheckpoint {
  version: 1;
  ts: string;
  sprintId: string;
  step: string;
  iteration?: string;
  phase: "produce" | "review" | "fix";
  attempt: number;
  provider: string;
  score?: number;
  tokens: number;
  costUsd: number;
  durationMs: number;
  artifactPath: string;
  outputPreview: string;
  outputSha256: string;
}

export type NewStreamingCheckpoint = Omit<StreamingCheckpoint, "version" | "ts" | "outputPreview" | "outputSha256"> & {
  ts?: string;
  output: string;
};

export function streamingCheckpointPath(sprintDir: string): string {
  return join(sprintDir, "streaming-checkpoints.jsonl");
}

export function appendStreamingCheckpoint(
  sprintDir: string,
  checkpoint: NewStreamingCheckpoint,
): StreamingCheckpoint {
  const record: StreamingCheckpoint = {
    version: 1,
    ts: checkpoint.ts ?? new Date().toISOString(),
    sprintId: checkpoint.sprintId,
    step: checkpoint.step,
    ...(checkpoint.iteration ? { iteration: checkpoint.iteration } : {}),
    phase: checkpoint.phase,
    attempt: checkpoint.attempt,
    provider: checkpoint.provider,
    ...(checkpoint.score !== undefined ? { score: checkpoint.score } : {}),
    tokens: checkpoint.tokens,
    costUsd: checkpoint.costUsd,
    durationMs: checkpoint.durationMs,
    artifactPath: checkpoint.artifactPath,
    outputPreview: checkpoint.output.slice(0, 2000),
    outputSha256: createHash("sha256").update(checkpoint.output).digest("hex"),
  };

  const path = streamingCheckpointPath(sprintDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
  return record;
}

export function readStreamingCheckpoints(sprintDir: string): StreamingCheckpoint[] {
  const path = streamingCheckpointPath(sprintDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StreamingCheckpoint);
}

export function truncateStreamingCheckpoints(
  sprintDir: string,
  recipe: { steps: { name: string }[] },
  targetStepIdx: number,
  keptIterations?: string[],
): void {
  const checkpoints = readStreamingCheckpoints(sprintDir);
  if (checkpoints.length === 0) return;

  const allowedSteps = new Set<string>();
  for (let i = 0; i < targetStepIdx; i++) {
    if (recipe.steps[i]) {
      allowedSteps.add(recipe.steps[i]!.name);
    }
  }

  const targetStepName = recipe.steps[targetStepIdx]?.name;
  const keptIters = new Set(keptIterations ?? []);

  const filtered = checkpoints.filter((cp) => {
    if (allowedSteps.has(cp.step)) {
      return true;
    }
    if (cp.step === targetStepName && cp.iteration && keptIters.has(cp.iteration)) {
      return true;
    }
    return false;
  });

  const path = streamingCheckpointPath(sprintDir);
  const content = filtered.map((c) => JSON.stringify(c)).join("\n") + (filtered.length > 0 ? "\n" : "");
  writeFileSync(path, content, "utf-8");
}

export function reconstructHistoryFromCheckpoints(
  sprintDir: string,
  stepName: string,
  iteration?: string,
): {
  history: any[];
  latestCheckpoint?: any;
} {
  const checkpoints = readStreamingCheckpoints(sprintDir);
  const stepCps = checkpoints.filter(
    (cp) => cp.step === stepName && cp.iteration === iteration,
  );

  if (stepCps.length === 0) {
    return { history: [] };
  }

  const history: any[] = [];
  for (const cp of stepCps) {
    let output = cp.outputPreview;
    const fullPath = join(sprintDir, cp.artifactPath);
    if (existsSync(fullPath)) {
      try {
        output = readFileSync(fullPath, "utf-8");
      } catch {}
    }
    history.push({
      phase: cp.phase,
      attempt: cp.attempt,
      score: cp.score,
      step: {
        output,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: cp.tokens,
        costUsd: cp.costUsd,
        durationMs: cp.durationMs,
      },
    });
  }

  const latestCp = stepCps[stepCps.length - 1]!;
  let latestOutput = latestCp.outputPreview;
  const latestFullPath = join(sprintDir, latestCp.artifactPath);
  if (existsSync(latestFullPath)) {
    try {
      latestOutput = readFileSync(latestFullPath, "utf-8");
    } catch {}
  }

  return {
    history,
    latestCheckpoint: {
      ...latestCp,
      output: latestOutput,
    },
  };
}
