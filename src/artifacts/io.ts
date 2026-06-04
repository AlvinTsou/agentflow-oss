import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Provider } from "../middleman/provider.js";

export interface ArtifactFrontmatter {
  step: string;
  sprint: string;
  score: number;
  attempts: number;
  provider: Provider;
  generated_at: string;
  [k: string]: unknown;
}

export interface Artifact {
  frontmatter: ArtifactFrontmatter;
  body: string;
}

const META_OPEN = "<!--agentflow";
const META_CLOSE = "-->";

export function serializeArtifact(artifact: Artifact): string {
  const meta = JSON.stringify(artifact.frontmatter, null, 2);
  return `${META_OPEN}\n${meta}\n${META_CLOSE}\n${artifact.body.trim()}\n`;
}

export function parseArtifact(raw: string): Artifact {
  if (!raw.startsWith(META_OPEN)) {
    throw new Error("Artifact missing agentflow frontmatter block");
  }
  const closeIdx = raw.indexOf(META_CLOSE);
  if (closeIdx === -1) {
    throw new Error("Artifact frontmatter block unterminated");
  }
  const metaText = raw.slice(META_OPEN.length, closeIdx).trim();
  let frontmatter: ArtifactFrontmatter;
  try {
    frontmatter = JSON.parse(metaText) as ArtifactFrontmatter;
  } catch (err) {
    throw new Error(`Artifact frontmatter is not valid JSON: ${(err as Error).message}`);
  }
  const body = raw.slice(closeIdx + META_CLOSE.length).trim();
  return { frontmatter, body };
}

export function writeArtifact(filePath: string, artifact: Artifact): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeArtifact(artifact), "utf-8");
}

export function readArtifact(filePath: string): Artifact {
  const raw = readFileSync(filePath, "utf-8");
  return parseArtifact(raw);
}
