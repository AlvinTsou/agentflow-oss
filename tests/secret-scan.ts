import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const THIS_FILE = path.relative(ROOT_DIR, new URL(import.meta.url).pathname);

const FORBIDDEN_FILENAMES = [
  /\.env.*/i,
  /secret/i,
  /credential/i,
  /private[-_]?key/i,
];

const FORBIDDEN_CONTENT_PATTERNS = [
  { pattern: new RegExp(["/Users", "/alvintsou"].join(""), "gi"), name: "local absolute user path" },
  { pattern: new RegExp(["Poker", "Room"].join(""), "gi"), name: "private project name" },
  { pattern: new RegExp(String.raw`\b${["voice", "-s"].join("")}\d`, "gi"), name: "private sprint name prefix" },
  { pattern: /\b(sk-(?!abcdefghijklmnopqrstuvwxyz)[a-zA-Z0-9]{20,})\b/g, name: "OpenAI/Anthropic API key value" },
  { pattern: /\b(AIza[a-zA-Z0-9_-]{35})\b/g, name: "Google API key value" },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36})\b/g, name: "GitHub PAT value" },
];

const EXCLUDED_PATHS = [
  /node_modules/,
  /\.git/,
  /dist/,
  /pnpm-lock\.yaml/,
];

const FILENAME_ALLOWLIST = new Set([THIS_FILE]);

let hasErrors = false;

function scanDirectory(dir: string): void {
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const relativePath = path.relative(ROOT_DIR, fullPath);
    if (EXCLUDED_PATHS.some((regex) => regex.test(relativePath))) continue;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDirectory(fullPath);
      continue;
    }

    if (!FILENAME_ALLOWLIST.has(relativePath)) {
      for (const regex of FORBIDDEN_FILENAMES) {
        if (regex.test(file)) {
          console.error(`ERROR: forbidden filename "${relativePath}" matches ${regex}`);
          hasErrors = true;
        }
      }
    }

    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    for (const item of FORBIDDEN_CONTENT_PATTERNS) {
      item.pattern.lastIndex = 0;
      if (item.pattern.test(content)) {
        console.error(`ERROR: forbidden content "${item.name}" detected in "${relativePath}"`);
        hasErrors = true;
      }
    }
  }
}

console.log(`Starting secret and privacy scan at ${ROOT_DIR}...`);
scanDirectory(ROOT_DIR);

if (hasErrors) {
  console.error("Scan failed. Remove forbidden filenames or content before publishing.");
  process.exit(1);
}

console.log("Scan passed. No secrets or private keywords detected.");
