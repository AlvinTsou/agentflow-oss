import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import os from "node:os";

export interface SprintOutcomeRecord {
  sprintId: string;
  recipeName: string;
  sprintDir: string;
  completedAt: string;
  passed: boolean;
  totalTokens: number;
  totalCostUsd: number;
  readiness?: string;
  reviewVerdict?: string | null;
  blockingCount?: number;
}

export class SprintIndex {
  private readonly filepath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.filepath = customPath;
    } else {
      const dir = join(os.homedir(), ".agentflow");
      mkdirSync(dir, { recursive: true });
      this.filepath = join(dir, "sprint-index.jsonl");
    }
  }

  record(record: SprintOutcomeRecord): void {
    // Ensure parent directory exists
    const dir = dirname(this.filepath);
    mkdirSync(dir, { recursive: true });
    
    const line = JSON.stringify(record) + "\n";
    appendFileSync(this.filepath, line, "utf-8");
  }
}
