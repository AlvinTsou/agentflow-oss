import { loadProjectEnv } from "./src/util/load-env.js";
loadProjectEnv();
import { getProvider } from "./src/middleman/router.js";
import type { Provider } from "./src/middleman/provider.js";

interface ParsedSmokeTestArgs {
  provider: Provider;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model?: string;
  timeoutMs?: number;
}

function printHelp(): never {
  console.error(
    `Usage: pnpm ag smoke-test <provider> [opts]\n` +
      `  <provider>             One of: openai-compatible | claude | gemini | openrouter | codex\n` +
      `\n` +
      `Options:\n` +
      `  --baseUrl <url>        Base URL for gateway (openai-compatible / openrouter)\n` +
      `  --apiKey <key>         API key credential\n` +
      `  --apiKeyEnv <name>     Name of env variable containing the API key (e.g. CUSTOM_API_KEY)\n` +
      `  --model <name>         Model identifier to verify connectivity for (required for openai-compatible)\n` +
      `  --timeoutMs <ms>       Request timeout in milliseconds (default: 5000)\n`
  );
  process.exit(2);
}

function parseArgs(argv: string[]): ParsedSmokeTestArgs {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
  }
  const provider = argv[0] as Provider;
  const out: ParsedSmokeTestArgs = { provider };

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseUrl") out.baseUrl = argv[++i];
    else if (a === "--apiKey") out.apiKey = argv[++i];
    else if (a === "--apiKeyEnv") out.apiKeyEnv = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--timeoutMs") {
      const v = argv[++i];
      if (v) out.timeoutMs = parseInt(v, 10);
    } else {
      console.error(`Unknown option: ${a}`);
      printHelp();
    }
  }

  return out;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  console.log(`Starting pre-flight gateway smoke test for provider: ${parsed.provider}`);

  const providerInstance = getProvider(parsed.provider);
  if (!providerInstance) {
    console.error(`Error: Provider "${parsed.provider}" not found.`);
    process.exit(1);
  }

  if (!providerInstance.smokeTest) {
    console.error(`Error: Provider "${parsed.provider}" does not support pre-flight smoke testing.`);
    process.exit(1);
  }

  const result = await providerInstance.smokeTest({
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    apiKeyEnv: parsed.apiKeyEnv,
    model: parsed.model,
    timeoutMs: parsed.timeoutMs,
  });

  if (result.success) {
    console.log(`\n✓ SMOKE TEST SUCCESS: ${result.message}`);
    process.exit(0);
  } else {
    console.error(`\n✗ SMOKE TEST FAILED: ${result.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
