/**
 * Canonical runtime directory name for CLI feedback data.
 *
 * The engine, CLI gate, and ingest module all read/write feedback files
 * (issues.json, feedback.jsonl, edits.jsonl) under this directory inside
 * the sprint dir.
 *
 * Extracted as a constant so the path is never hardcoded inline.
 */
export const FEEDBACK_DIR = ".agentflow-feedback";
