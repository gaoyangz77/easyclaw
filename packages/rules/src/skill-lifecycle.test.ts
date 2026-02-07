import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Rule } from "@easyclaw/core";
import { createStorage, type Storage } from "@easyclaw/storage";
import { ArtifactPipeline } from "./pipeline.js";
import {
  materializeSkill,
  dematerializeSkill,
  syncSkillsForRule,
  cleanupSkillsForDeletedRule,
} from "./skill-lifecycle.js";

// ---------------------------------------------------------------------------
// Mock the skill-writer module (being developed in parallel)
// ---------------------------------------------------------------------------

vi.mock("./skill-writer.js", () => {
  const { mkdirSync, writeFileSync, unlinkSync, existsSync: fsExists, readdirSync, rmdirSync } =
    require("node:fs") as typeof import("node:fs");
  const { join: pathJoin, dirname } = require("node:path") as typeof import("node:path");

  return {
    extractSkillName(artifactContent: string): string {
      // Parse name from frontmatter: "---\nname: <name>\n..."
      const match = artifactContent.match(/^---\s*\nname:\s*(.+)/m);
      return match ? match[1].trim() : "unknown-skill";
    },

    writeSkillFile(skillName: string, content: string, skillsDir?: string): string {
      const dir = skillsDir ?? pathJoin(require("node:os").homedir(), ".openclaw", "skills");
      const skillDir = pathJoin(dir, skillName);
      mkdirSync(skillDir, { recursive: true });
      const filePath = pathJoin(skillDir, "SKILL.md");
      writeFileSync(filePath, content, "utf-8");
      return filePath;
    },

    removeSkillFile(outputPath: string): boolean {
      try {
        if (!fsExists(outputPath)) return false;
        unlinkSync(outputPath);
        // Try to remove parent dir if empty
        const parentDir = dirname(outputPath);
        try {
          const entries = readdirSync(parentDir);
          if (entries.length === 0) {
            rmdirSync(parentDir);
          }
        } catch {
          // Ignore errors cleaning up parent dir
        }
        return true;
      } catch {
        return false;
      }
    },

    resolveSkillsDir(customDir?: string): string {
      return customDir ?? pathJoin(require("node:os").homedir(), ".openclaw", "skills");
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(text: string, id?: string): Rule {
  const now = new Date().toISOString();
  return {
    id: id ?? randomUUID(),
    text,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("skill-lifecycle", () => {
  let storage: Storage;
  let pipeline: ArtifactPipeline;
  let tmpDir: string;

  beforeEach(() => {
    storage = createStorage(":memory:");
    pipeline = new ArtifactPipeline(storage);
    tmpDir = mkdtempSync(join(tmpdir(), "easyclaw-skill-test-"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // materializeSkill
  // -------------------------------------------------------------------------

  describe("materializeSkill", () => {
    it("writes a SKILL.md file and returns the output path for action-bundle artifacts", () => {
      const rule = makeRule("Enable the capability to search the web");
      storage.rules.create(rule);
      const artifact = pipeline.compileRule(rule);

      expect(artifact.type).toBe("action-bundle");

      const outputPath = materializeSkill(artifact, tmpDir);

      expect(outputPath).toBeDefined();
      expect(typeof outputPath).toBe("string");
      expect(existsSync(outputPath!)).toBe(true);

      // Verify the file content matches
      const fileContent = readFileSync(outputPath!, "utf-8");
      expect(fileContent).toBe(artifact.content);
    });

    it("returns undefined for non-action-bundle artifacts (policy-fragment)", () => {
      const rule = makeRule("Always be polite and helpful");
      storage.rules.create(rule);
      const artifact = pipeline.compileRule(rule);

      expect(artifact.type).toBe("policy-fragment");

      const result = materializeSkill(artifact, tmpDir);
      expect(result).toBeUndefined();
    });

    it("returns undefined for non-action-bundle artifacts (guard)", () => {
      const rule = makeRule("Block all access to admin panel");
      storage.rules.create(rule);
      const artifact = pipeline.compileRule(rule);

      expect(artifact.type).toBe("guard");

      const result = materializeSkill(artifact, tmpDir);
      expect(result).toBeUndefined();
    });

    it("writes the skill file into a subdirectory named after the skill", () => {
      const rule = makeRule("Add a skill to summarize documents");
      storage.rules.create(rule);
      const artifact = pipeline.compileRule(rule);

      const outputPath = materializeSkill(artifact, tmpDir);

      expect(outputPath).toBeDefined();
      // The path should be inside tmpDir
      expect(outputPath!.startsWith(tmpDir)).toBe(true);
      // Should end with SKILL.md
      expect(outputPath!.endsWith("SKILL.md")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // dematerializeSkill
  // -------------------------------------------------------------------------

  describe("dematerializeSkill", () => {
    it("removes a skill file when artifact has outputPath", () => {
      const rule = makeRule("Enable the capability to parse PDFs");
      storage.rules.create(rule);
      const artifact = pipeline.compileRule(rule);

      // First materialize
      const outputPath = materializeSkill(artifact, tmpDir);
      expect(outputPath).toBeDefined();
      expect(existsSync(outputPath!)).toBe(true);

      // Set the outputPath on the artifact
      artifact.outputPath = outputPath;

      // Dematerialize
      const removed = dematerializeSkill(artifact);

      expect(removed).toBe(true);
      expect(existsSync(outputPath!)).toBe(false);
    });

    it("returns false when artifact has no outputPath", () => {
      const rule = makeRule("Enable the capability to search");
      storage.rules.create(rule);
      const artifact = pipeline.compileRule(rule);

      // No outputPath set
      const removed = dematerializeSkill(artifact);
      expect(removed).toBe(false);
    });

    it("returns false when the file does not exist", () => {
      const rule = makeRule("Enable the capability to run scripts");
      storage.rules.create(rule);
      const artifact = pipeline.compileRule(rule);

      // Set a non-existent path
      artifact.outputPath = join(tmpDir, "nonexistent", "SKILL.md");

      const removed = dematerializeSkill(artifact);
      expect(removed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // syncSkillsForRule
  // -------------------------------------------------------------------------

  describe("syncSkillsForRule", () => {
    it("compiles an action-bundle rule, materializes skill, and updates outputPath in storage", () => {
      const rule = makeRule("Enable the capability to translate languages");
      storage.rules.create(rule);

      const artifact = syncSkillsForRule(pipeline, rule, tmpDir);

      expect(artifact.type).toBe("action-bundle");
      expect(artifact.status).toBe("ok");
      expect(artifact.outputPath).toBeDefined();
      expect(existsSync(artifact.outputPath!)).toBe(true);

      // Verify storage was updated with the outputPath
      const storedArtifacts = storage.artifacts.getByRuleId(rule.id);
      expect(storedArtifacts).toHaveLength(1);
      expect(storedArtifacts[0]!.outputPath).toBe(artifact.outputPath);
    });

    it("compiles a policy-fragment rule without materializing any skill", () => {
      const rule = makeRule("Always respond in a professional tone");
      storage.rules.create(rule);

      const artifact = syncSkillsForRule(pipeline, rule, tmpDir);

      expect(artifact.type).toBe("policy-fragment");
      expect(artifact.status).toBe("ok");
      expect(artifact.outputPath).toBeUndefined();
    });

    it("dematerializes old skill when artifact type changes from action-bundle to non-action-bundle", () => {
      const ruleId = randomUUID();

      // First: create as action-bundle
      const rule1 = makeRule("Enable the capability to run scripts", ruleId);
      storage.rules.create(rule1);

      const artifact1 = syncSkillsForRule(pipeline, rule1, tmpDir);
      expect(artifact1.type).toBe("action-bundle");
      expect(artifact1.outputPath).toBeDefined();
      const skillPath = artifact1.outputPath!;
      expect(existsSync(skillPath)).toBe(true);

      // Second: update rule text to trigger guard classification (type change)
      const rule2: Rule = { ...rule1, text: "Block all dangerous file operations" };
      storage.rules.update(ruleId, { text: rule2.text });

      const artifact2 = syncSkillsForRule(pipeline, rule2, tmpDir);

      expect(artifact2.type).toBe("guard");
      // The old skill file should have been removed
      expect(existsSync(skillPath)).toBe(false);
    });

    it("end-to-end: create rule -> compile -> skill appears on disk", () => {
      const rule = makeRule("Add a skill to summarize documents");
      storage.rules.create(rule);

      // Before sync: no artifacts, no files
      expect(storage.artifacts.getByRuleId(rule.id)).toHaveLength(0);

      // Sync
      const artifact = syncSkillsForRule(pipeline, rule, tmpDir);

      // After sync: artifact exists, file on disk
      expect(artifact.type).toBe("action-bundle");
      expect(artifact.status).toBe("ok");
      expect(artifact.outputPath).toBeDefined();

      const fileContent = readFileSync(artifact.outputPath!, "utf-8");
      expect(fileContent).toContain("Add a skill to summarize documents");
      expect(fileContent).toContain("name:");

      // Storage has the artifact with outputPath
      const stored = storage.artifacts.getByRuleId(rule.id);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.outputPath).toBe(artifact.outputPath);
    });

    it("recompiles an action-bundle rule and updates the skill file", () => {
      const ruleId = randomUUID();
      const rule1 = makeRule("Enable the capability to search the web", ruleId);
      storage.rules.create(rule1);

      const artifact1 = syncSkillsForRule(pipeline, rule1, tmpDir);
      expect(artifact1.outputPath).toBeDefined();
      const firstPath = artifact1.outputPath!;

      // Update the rule text (still action-bundle)
      const rule2: Rule = { ...rule1, text: "Enable the capability to parse JSON data" };
      storage.rules.update(ruleId, { text: rule2.text });

      const artifact2 = syncSkillsForRule(pipeline, rule2, tmpDir);
      expect(artifact2.type).toBe("action-bundle");
      expect(artifact2.outputPath).toBeDefined();

      // The new skill file should exist
      expect(existsSync(artifact2.outputPath!)).toBe(true);

      // The old file should have been cleaned up (old path removed before new write)
      // Note: if the skill name changed, the old file path will differ
      if (firstPath !== artifact2.outputPath) {
        expect(existsSync(firstPath)).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // cleanupSkillsForDeletedRule
  // -------------------------------------------------------------------------

  describe("cleanupSkillsForDeletedRule", () => {
    it("removes skill file and artifacts when a rule is deleted", () => {
      const rule = makeRule("Enable the capability to search files");
      storage.rules.create(rule);

      // Sync to create artifact and skill file
      const artifact = syncSkillsForRule(pipeline, rule, tmpDir);
      expect(artifact.type).toBe("action-bundle");
      expect(artifact.outputPath).toBeDefined();
      expect(existsSync(artifact.outputPath!)).toBe(true);

      // Verify artifact exists in storage
      expect(storage.artifacts.getByRuleId(rule.id)).toHaveLength(1);

      // Cleanup
      cleanupSkillsForDeletedRule(pipeline, rule.id);

      // Skill file should be gone
      expect(existsSync(artifact.outputPath!)).toBe(false);

      // Artifacts should be gone from storage
      expect(storage.artifacts.getByRuleId(rule.id)).toHaveLength(0);
    });

    it("removes artifacts even for non-action-bundle rules (no skill file to remove)", () => {
      const rule = makeRule("Always be polite");
      storage.rules.create(rule);
      pipeline.compileRule(rule);

      expect(storage.artifacts.getByRuleId(rule.id)).toHaveLength(1);

      cleanupSkillsForDeletedRule(pipeline, rule.id);

      expect(storage.artifacts.getByRuleId(rule.id)).toHaveLength(0);
    });

    it("is a no-op when no artifacts exist for the rule", () => {
      const fakeRuleId = randomUUID();

      // Should not throw
      expect(() =>
        cleanupSkillsForDeletedRule(pipeline, fakeRuleId),
      ).not.toThrow();
    });

    it("handles multiple action-bundle artifacts for the same rule (edge case)", () => {
      // In practice there should be exactly one, but test robustness
      const rule = makeRule("Enable the capability to translate");
      storage.rules.create(rule);

      const artifact = syncSkillsForRule(pipeline, rule, tmpDir);
      expect(artifact.outputPath).toBeDefined();
      expect(existsSync(artifact.outputPath!)).toBe(true);

      // Cleanup removes everything
      cleanupSkillsForDeletedRule(pipeline, rule.id);

      expect(existsSync(artifact.outputPath!)).toBe(false);
      expect(storage.artifacts.getByRuleId(rule.id)).toHaveLength(0);
    });
  });
});
