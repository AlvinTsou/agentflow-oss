import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { initSprintRepo } from "./sprint-repo.js";
import { gitCommit, gitTag, sprintInitTagName } from "./git-checkpoint.js";
import { renderCarryOverSection, type ReadinessReport } from "./readiness.js";
import { StateStore } from "./state-store.js";

export interface ReplanOptions {
  sprintDir: string;
  recipe: { name: string };
  sprintId: string;
  readiness: ReadinessReport;
  selfFeeding: { maxFollowUps: number };
}

export async function handleReplan(opts: ReplanOptions): Promise<{ sprintDir: string; sprintId: string } | null> {
  const { sprintDir, recipe, sprintId, readiness, selfFeeding } = opts;
  
  const parentDir = dirname(sprintDir);
  const parentName = basename(sprintDir);
  
  const match = parentName.match(/-followup-(\d+)$/);
  const depth = match ? parseInt(match[1]!, 10) : 0;
  const nextDepth = depth + 1;
  
  if (nextDepth > selfFeeding.maxFollowUps) {
    return null;
  }
  
  const baseName = match ? parentName.slice(0, -match[0].length) : parentName;
  const newSprintName = `${baseName}-followup-${nextDepth}`;
  const newSprintDir = join(parentDir, newSprintName);
  
  const baseSprintId = match ? sprintId.slice(0, -match[0].length) : sprintId;
  const newSprintId = `${baseSprintId}-followup-${nextDepth}`;
  
  if (!existsSync(newSprintDir)) {
    mkdirSync(newSprintDir, { recursive: true });
    initSprintRepo(newSprintDir);
  }
  
  // Load parent INPUT.md and strip any old carry-over sections
  let originalInput = readFileSync(join(sprintDir, "INPUT.md"), "utf-8");
  const carryOverHeader = "## Carry-over from prior round";
  const idx = originalInput.indexOf(carryOverHeader);
  if (idx !== -1) {
    originalInput = originalInput.slice(0, idx).trim();
  }
  
  const carryOverText = renderCarryOverSection(readiness, sprintId, { includeDeferred: true });
  const newInput = originalInput + (carryOverText ? "\n\n" : "") + (carryOverText || "");
  
  writeFileSync(join(newSprintDir, "INPUT.md"), newInput, "utf-8");
  
  // Copy agentflow.config.json
  const configPath = join(sprintDir, "agentflow.config.json");
  if (existsSync(configPath)) {
    const configJson = readFileSync(configPath, "utf-8");
    writeFileSync(join(newSprintDir, "agentflow.config.json"), configJson, "utf-8");
  }
  
  // State init
  const store = new StateStore(newSprintDir);
  const state = store.init(recipe.name, newSprintId);
  state.phase = "initialized";
  store.save(state);
  
  gitCommit(["."], `chore(agentflow): sprint ${newSprintId} init (self-feeding followup)`, newSprintDir);
  gitTag(sprintInitTagName(newSprintId), newSprintDir);
  
  return { sprintDir: newSprintDir, sprintId: newSprintId };
}
