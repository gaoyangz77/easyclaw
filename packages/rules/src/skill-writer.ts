import { mkdirSync, writeFileSync, unlinkSync, readdirSync, rmdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolveUserSkillsDir } from "@easyclaw/core/node";
import { createLogger } from "@easyclaw/logger";

const log = createLogger("rules:skill-writer");

/**
 * Resolve the skills directory path.
 * Returns the custom directory if provided, otherwise the default (~/.easyclaw/openclaw/skills/).
 */
export function resolveSkillsDir(customDir?: string): string {
  return customDir ?? resolveUserSkillsDir();
}

/**
 * Extract the skill name from YAML frontmatter in artifact content.
 *
 * Expects content in the format:
 * ```
 * ---
 * name: skill-name
 * description: ...
 * ---
 *
 * rule text
 * ```
 *
 * Throws if no valid `name:` field is found in the frontmatter.
 */
export function extractSkillName(artifactContent: string): string {
  const lines = artifactContent.split("\n");

  // Find frontmatter boundaries (lines that are exactly "---")
  let fmStart = -1;
  let fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      if (fmStart === -1) {
        fmStart = i;
      } else {
        fmEnd = i;
        break;
      }
    }
  }

  if (fmStart === -1 || fmEnd === -1) {
    throw new Error("No YAML frontmatter found in artifact content");
  }

  // Parse the frontmatter lines between the two "---" delimiters
  for (let i = fmStart + 1; i < fmEnd; i++) {
    const line = lines[i]!;
    const match = line.match(/^name:\s*(.+)$/);
    if (match) {
      const name = match[1]!.trim();
      if (name.length === 0) {
        throw new Error("Empty skill name in frontmatter");
      }
      return name;
    }
  }

  throw new Error("No 'name' field found in YAML frontmatter");
}

/**
 * Write a SKILL.md file to the filesystem.
 *
 * Creates the directory structure `{skillsDir}/{skillName}/SKILL.md`.
 * Parent directories are created recursively if they don't exist.
 * If the file already exists, it is overwritten.
 *
 * @param skillName - The skill name (used as the directory name)
 * @param content - The full SKILL.md content (frontmatter + body)
 * @param skillsDir - Optional custom skills directory (defaults to ~/.easyclaw/openclaw/skills/)
 * @returns The absolute path to the written SKILL.md file
 */
export function writeSkillFile(skillName: string, content: string, skillsDir?: string): string {
  const dir = resolveSkillsDir(skillsDir);
  const skillDir = join(dir, skillName);
  const filePath = join(skillDir, "SKILL.md");

  // Ensure the skill directory exists
  mkdirSync(skillDir, { recursive: true });

  // Write the SKILL.md file (overwrites if it already exists)
  writeFileSync(filePath, content, "utf-8");

  log.info(`Wrote SKILL.md → ${filePath}`);
  return filePath;
}

/**
 * Remove a SKILL.md file and its parent directory (if the directory is empty after removal).
 *
 * @param outputPath - The absolute path to the SKILL.md file
 * @returns true if the file was removed, false if it didn't exist
 */
export function removeSkillFile(outputPath: string): boolean {
  if (!existsSync(outputPath)) {
    log.info(`Skill file not found, nothing to remove: ${outputPath}`);
    return false;
  }

  unlinkSync(outputPath);
  log.info(`Removed skill file: ${outputPath}`);

  // Try to remove the parent directory if it is now empty
  const parentDir = dirname(outputPath);
  try {
    const remaining = readdirSync(parentDir);
    if (remaining.length === 0) {
      rmdirSync(parentDir);
      log.info(`Removed empty skill directory: ${parentDir}`);
    }
  } catch {
    // Ignore errors when trying to clean up the parent directory
    // (e.g., it may not exist or may have other files)
  }

  return true;
}
