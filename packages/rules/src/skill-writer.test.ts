import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveSkillsDir,
  extractSkillName,
  writeSkillFile,
  removeSkillFile,
} from "./skill-writer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sample action-bundle artifact content with YAML frontmatter.
 */
function makeArtifactContent(name: string, description: string, body: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// resolveSkillsDir
// ---------------------------------------------------------------------------

describe("resolveSkillsDir", () => {
  it("returns the default ~/.openclaw/skills/ path when no custom dir is provided", () => {
    const result = resolveSkillsDir();
    expect(result).toContain(".openclaw");
    expect(result).toContain("skills");
    // Should be an absolute path
    expect(result.startsWith("/") || /^[A-Z]:\\/i.test(result)).toBe(true);
  });

  it("returns the custom directory when provided", () => {
    const custom = "/tmp/my-custom-skills";
    const result = resolveSkillsDir(custom);
    expect(result).toBe(custom);
  });

  it("returns the default when undefined is explicitly passed", () => {
    const result = resolveSkillsDir(undefined);
    expect(result).toContain(".openclaw");
    expect(result).toContain("skills");
  });
});

// ---------------------------------------------------------------------------
// extractSkillName
// ---------------------------------------------------------------------------

describe("extractSkillName", () => {
  it("extracts the name from valid frontmatter", () => {
    const content = makeArtifactContent("my-cool-skill", "Does cool things", "The body text");
    expect(extractSkillName(content)).toBe("my-cool-skill");
  });

  it("extracts name with leading/trailing whitespace trimmed", () => {
    const content = "---\nname:   spaced-skill   \ndescription: test\n---\n\nbody";
    expect(extractSkillName(content)).toBe("spaced-skill");
  });

  it("handles names with special characters", () => {
    const content = makeArtifactContent("web-search-v2", "Search the web", "body");
    expect(extractSkillName(content)).toBe("web-search-v2");
  });

  it("throws when no frontmatter is present", () => {
    expect(() => extractSkillName("Just some text without frontmatter")).toThrow(
      "No YAML frontmatter found",
    );
  });

  it("throws when frontmatter has no name field", () => {
    const content = "---\ndescription: no name here\n---\n\nbody";
    expect(() => extractSkillName(content)).toThrow("No 'name' field found");
  });

  it("throws when name field is empty", () => {
    const content = "---\nname:   \ndescription: empty name\n---\n\nbody";
    expect(() => extractSkillName(content)).toThrow("Empty skill name");
  });

  it("throws when only one --- delimiter exists", () => {
    const content = "---\nname: incomplete\nsome text";
    expect(() => extractSkillName(content)).toThrow("No YAML frontmatter found");
  });
});

// ---------------------------------------------------------------------------
// writeSkillFile
// ---------------------------------------------------------------------------

describe("writeSkillFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "easyclaw-skill-writer-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates the skill directory and SKILL.md file", () => {
    const content = makeArtifactContent("test-skill", "A test skill", "Do something");
    const outputPath = writeSkillFile("test-skill", content, tempDir);

    expect(outputPath).toBe(join(tempDir, "test-skill", "SKILL.md"));
    expect(existsSync(outputPath)).toBe(true);

    const written = readFileSync(outputPath, "utf-8");
    expect(written).toBe(content);
  });

  it("creates nested directories recursively", () => {
    const nestedDir = join(tempDir, "deep", "nested", "skills");
    const content = makeArtifactContent("nested-skill", "Nested", "body");
    const outputPath = writeSkillFile("nested-skill", content, nestedDir);

    expect(outputPath).toBe(join(nestedDir, "nested-skill", "SKILL.md"));
    expect(existsSync(outputPath)).toBe(true);
  });

  it("overwrites an existing SKILL.md file", () => {
    const skillName = "overwrite-skill";
    const original = makeArtifactContent(skillName, "Original", "Original body");
    const updated = makeArtifactContent(skillName, "Updated", "Updated body");

    // Write the original
    writeSkillFile(skillName, original, tempDir);

    // Overwrite with updated content
    const outputPath = writeSkillFile(skillName, updated, tempDir);

    const written = readFileSync(outputPath, "utf-8");
    expect(written).toBe(updated);
    expect(written).not.toBe(original);
  });

  it("returns an absolute path", () => {
    const content = makeArtifactContent("abs-path-skill", "Test", "body");
    const outputPath = writeSkillFile("abs-path-skill", content, tempDir);

    expect(outputPath.startsWith("/") || /^[A-Z]:\\/i.test(outputPath)).toBe(true);
  });

  it("uses default skills dir when no custom dir is provided", () => {
    // We don't actually write to the default dir in tests — just verify the
    // returned path includes the default directory structure.
    // To avoid polluting the real filesystem, we test only the path resolution.
    const defaultDir = resolveSkillsDir();
    expect(defaultDir).toContain(".openclaw");
    expect(defaultDir).toContain("skills");
  });
});

// ---------------------------------------------------------------------------
// removeSkillFile
// ---------------------------------------------------------------------------

describe("removeSkillFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "easyclaw-skill-writer-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("removes the SKILL.md file and returns true", () => {
    const content = makeArtifactContent("remove-me", "To be removed", "body");
    const outputPath = writeSkillFile("remove-me", content, tempDir);

    expect(existsSync(outputPath)).toBe(true);

    const result = removeSkillFile(outputPath);

    expect(result).toBe(true);
    expect(existsSync(outputPath)).toBe(false);
  });

  it("removes the empty parent directory after removing the file", () => {
    const content = makeArtifactContent("cleanup-skill", "Cleanup test", "body");
    const outputPath = writeSkillFile("cleanup-skill", content, tempDir);
    const parentDir = join(tempDir, "cleanup-skill");

    expect(existsSync(parentDir)).toBe(true);

    removeSkillFile(outputPath);

    expect(existsSync(parentDir)).toBe(false);
  });

  it("does not remove parent directory if it still contains other files", () => {
    const content = makeArtifactContent("keep-dir-skill", "Keep dir", "body");
    const outputPath = writeSkillFile("keep-dir-skill", content, tempDir);
    const parentDir = join(tempDir, "keep-dir-skill");

    // Add an extra file to the skill directory
    writeFileSync(join(parentDir, "extra.txt"), "should not be removed");

    removeSkillFile(outputPath);

    // The file was removed
    expect(existsSync(outputPath)).toBe(false);
    // But the directory and extra file remain
    expect(existsSync(parentDir)).toBe(true);
    expect(existsSync(join(parentDir, "extra.txt"))).toBe(true);
  });

  it("returns false when the file does not exist", () => {
    const result = removeSkillFile(join(tempDir, "nonexistent", "SKILL.md"));
    expect(result).toBe(false);
  });

  it("returns false for a completely bogus path", () => {
    const result = removeSkillFile("/tmp/does-not-exist-at-all-12345/SKILL.md");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: write → extract → remove round-trip
// ---------------------------------------------------------------------------

describe("skill-writer integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "easyclaw-skill-writer-integ-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("full round-trip: extract name, write file, read back, remove", () => {
    const content = makeArtifactContent(
      "round-trip-skill",
      "Integration test skill",
      "This skill does integration testing",
    );

    // 1. Extract name
    const name = extractSkillName(content);
    expect(name).toBe("round-trip-skill");

    // 2. Write to disk
    const outputPath = writeSkillFile(name, content, tempDir);
    expect(existsSync(outputPath)).toBe(true);

    // 3. Read back and verify
    const onDisk = readFileSync(outputPath, "utf-8");
    expect(onDisk).toBe(content);

    // 4. Remove
    const removed = removeSkillFile(outputPath);
    expect(removed).toBe(true);
    expect(existsSync(outputPath)).toBe(false);

    // Parent directory should also be gone (was empty)
    expect(existsSync(join(tempDir, "round-trip-skill"))).toBe(false);
  });

  it("overwrite then remove workflow", () => {
    const name = "overwrite-cycle";
    const v1 = makeArtifactContent(name, "Version 1", "body v1");
    const v2 = makeArtifactContent(name, "Version 2", "body v2");

    // Write v1
    const path1 = writeSkillFile(name, v1, tempDir);
    expect(readFileSync(path1, "utf-8")).toBe(v1);

    // Overwrite with v2
    const path2 = writeSkillFile(name, v2, tempDir);
    expect(path2).toBe(path1); // same path
    expect(readFileSync(path2, "utf-8")).toBe(v2);

    // Remove
    expect(removeSkillFile(path2)).toBe(true);
    expect(existsSync(path2)).toBe(false);
  });
});
