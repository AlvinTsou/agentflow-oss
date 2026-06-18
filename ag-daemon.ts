/**
 * ag-daemon — Event-driven trigger layer background worker.
 *
 * Usage: node --import tsx ag-daemon.ts [options]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { runSprint } from "./src/workflow/sprint-engine.js";
import { getRecipe } from "./src/recipe/registry.js";
import { initSprintRepo } from "./src/workflow/sprint-repo.js";
import { TriggerRunner, type TriggerDef } from "./src/workflow/trigger-registry.js";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let configPath = "triggers.json";
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--config" || arg === "-c") {
      const val = args[i + 1];
      if (!val) {
        console.error("Error: --config requires a file path value");
        process.exit(1);
      }
      configPath = val;
      i++;
    } else if (arg === "--dry-run" || arg === "-d") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node --import tsx ag-daemon.ts [options]\n\n" +
        "Options:\n" +
        "  -c, --config <path>   Path to triggers configuration file (default: triggers.json)\n" +
        "  -d, --dry-run         Enable dry run (shows logs but does not execute recipes)\n" +
        "  -h, --help            Show this help text"
      );
      process.exit(0);
    }
  }

  return { configPath: resolve(configPath), dryRun };
}

async function handleTrigger(trig: TriggerDef) {
  console.log(`[Daemon] Trigger "${trig.name}" fired. Loading recipe "${trig.recipe}"...`);
  
  // Resolve recipe
  const recipe = await getRecipe(trig.recipe);
  
  // Calculate sprint directory path
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultPattern = `sprints/trigger-${trig.recipe}-${trig.name}-${timestamp}`;
  const pattern = trig.sprintDirPattern || defaultPattern;
  const sprintDir = resolve(pattern);

  console.log(`[Daemon] Creating sprint directory at: ${sprintDir}`);
  mkdirSync(sprintDir, { recursive: true });
  initSprintRepo(sprintDir);

  // Write basic sprint configuration and input brief
  writeFileSync(
    join(sprintDir, "INPUT.md"),
    `# Automated Trigger: ${trig.name}\n\nRecipe: ${trig.recipe}\nTriggered at: ${new Date().toISOString()}`,
    "utf-8"
  );
  writeFileSync(
    join(sprintDir, "agentflow.config.json"),
    JSON.stringify({ recipe: trig.recipe, gate: { defaultMode: "auto" } }, null, 2),
    "utf-8"
  );

  const sprintId = `daemon-${trig.name}-${timestamp}`;
  console.log(`[Daemon] Executing sprint "${sprintId}"...`);
  
  try {
    const result = await runSprint({
      recipe,
      sprintDir,
      sprintId,
    });
    console.log(`[Daemon] Sprint "${sprintId}" completed. Passed: ${result.passed}`);
  } catch (err) {
    console.error(`[Daemon] Sprint "${sprintId}" failed:`, err);
  }
}

function main() {
  const { configPath, dryRun } = parseArgs(process.argv);

  if (!existsSync(configPath)) {
    console.error(`Error: Configuration file not found at ${configPath}`);
    process.exit(1);
  }

  let config: { triggers: TriggerDef[] };
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error(`Error parsing configuration file: ${(err as Error).message}`);
    process.exit(1);
  }

  if (!config.triggers || !Array.isArray(config.triggers)) {
    console.error("Error: Configuration must contain a triggers array");
    process.exit(1);
  }

  console.log(`[Daemon] Starting trigger daemon with ${config.triggers.length} triggers...`);
  if (dryRun) {
    console.log("[Daemon] Running in DRY-RUN mode");
  }

  const runner = new TriggerRunner(config.triggers, dryRun);
  runner.start(handleTrigger);

  // Handle clean shutdown
  process.on("SIGINT", () => {
    console.log("[Daemon] Shutting down...");
    runner.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("[Daemon] Shutting down...");
    runner.stop();
    process.exit(0);
  });
}

main();
