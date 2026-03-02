import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir as _resolveOpenClawStateDir } from "@easyclaw/core/node";
import { createLogger } from "@easyclaw/logger";

const log = createLogger("gateway:skill-reload");

/** Pattern that identifies a skill file: ends with SKILL.md (case-sensitive). */
const SKILL_FILE_RE = /SKILL\.md$/;

/**
 * Resolve the skills directory path.
 *
 * Uses the provided `stateDir` as the parent, or falls back to
 * `resolveOpenClawStateDir()` when none is given.
 *
 * Returns `{stateDir}/skills`.
 */
export function resolveSkillsDir(stateDir?: string): string {
  const base = stateDir ?? _resolveOpenClawStateDir();
  return join(base, "skills");
}

/**
 * Ensure the skills directory exists on disk.
 *
 * Creates it (and any intermediate parents) when missing.
 * Returns the absolute path of the skills directory.
 */
export function ensureSkillsDir(stateDir?: string): string {
  const dir = resolveSkillsDir(stateDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log.info(`Created skills directory at ${dir}`);
  }
  return dir;
}

/**
 * Watch the skills directory for filesystem changes.
 *
 * This is a thin wrapper around `fs.watch` that forwards
 * change events to the provided callback. Useful for gateway
 * integration where OpenClaw hot-reloads skills on file changes.
 *
 * @param skillsDir - Absolute path to the skills directory to watch.
 * @param onChange  - Callback invoked with (eventType, filename) on each change.
 * @returns The underlying `FSWatcher` instance (caller must close it).
 */
export function watchSkillsDir(
  skillsDir: string,
  onChange: (event: string, filename: string) => void,
): FSWatcher {
  log.info(`Watching skills directory: ${skillsDir}`);

  const watcher = watch(skillsDir, (eventType, filename) => {
    const name = filename ?? "";
    log.debug(`Skills dir change: ${eventType} ${name}`);
    onChange(eventType, name);
  });

  return watcher;
}

/**
 * Check whether the given filename matches the SKILL.md naming convention.
 *
 * Returns `true` for filenames ending with `SKILL.md` (e.g. `my-tool-SKILL.md`,
 * `SKILL.md`), and `false` for everything else.
 */
export function isSkillFile(filename: string): boolean {
  return SKILL_FILE_RE.test(filename);
}
