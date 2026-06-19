import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
