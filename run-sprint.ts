import { loadProjectEnv } from "./src/util/load-env.js";
loadProjectEnv();
import { join } from "node:path";
import { runSprint } from "./src/workflow/sprint-engine.js";
import { recipe } from "./recipes/mini/recipe.js";

async function main() {
  const sprintId = `mini-${Date.now()}`;
  const sprintDir = join(process.cwd(), "sprints", sprintId);

  console.log(`[run-sprint] recipe=${recipe.name} sprintId=${sprintId}`);
  console.log(`[run-sprint] sprintDir=${sprintDir}`);
  console.log(`[run-sprint] steps=${recipe.steps.map((s) => s.name).join(" -> ")}\n`);

  const result = await runSprint({
    recipe,
    sprintDir,
    sprintId,
  });

  console.log("\n[run-sprint] === SUMMARY ===");
  for (const s of result.perStep) {
    console.log(`  ${s.step.padEnd(6)} score=${s.score} attempts=${s.attempts} tokens=${s.tokens}`);
  }
  console.log(
    `  TOTAL tokens=${result.meter.totalTokens} cost=$${result.meter.totalCostUsd.toFixed(4)}`
  );
  console.log(`  summary -> ${join(sprintDir, "summary.json")}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[run-sprint] fatal:", err);
  process.exit(1);
});
