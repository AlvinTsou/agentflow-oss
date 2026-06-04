import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load `.env` from `cwd` into `process.env` if the file exists.
 *
 * Uses Node 22's built-in `process.loadEnvFile`. Existing env vars are
 * NOT overwritten by .env values (Node's default is "don't clobber") --
 * so a key the user already exported in their shell still wins.
 *
 * No-op when `.env` is absent, so tests and CI keep working when they
 * inject credentials via the actual environment.
 *
 * Surfaced because Run H caught web-spawned `ag-resume` failing to
 * route the Gemini provider: `pnpm web` and the spawned resume child
 * inherited a shell env that did not have GEMINI_API_KEY, while the
 * key existed in the project `.env` file the test runs had been using.
 */
export function loadProjectEnv(cwd: string = process.cwd()): void {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // process.loadEnvFile throws on parse errors; we deliberately swallow
    // here -- the absence of a key surfaces later at provider-call time
    // with a clearer error than a malformed-env stack trace would give.
  }
}
