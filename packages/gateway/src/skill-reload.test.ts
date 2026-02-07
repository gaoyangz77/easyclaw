import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  resolveSkillsDir,
  ensureSkillsDir,
  watchSkillsDir,
  isSkillFile,
} from "./skill-reload.js";

describe("skill-reload", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "easyclaw-skill-reload-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── resolveSkillsDir ────────────────────────────────────────────

  describe("resolveSkillsDir", () => {
    it("returns {stateDir}/skills when stateDir is provided", () => {
      const result = resolveSkillsDir("/custom/state");
      expect(result).toBe(join("/custom/state", "skills"));
    });

    it("defaults to ~/.openclaw/skills when no stateDir is given", () => {
      const result = resolveSkillsDir();
      expect(result).toBe(join(homedir(), ".openclaw", "skills"));
    });

    it("defaults to ~/.openclaw/skills when stateDir is undefined", () => {
      const result = resolveSkillsDir(undefined);
      expect(result).toBe(join(homedir(), ".openclaw", "skills"));
    });
  });

  // ── ensureSkillsDir ─────────────────────────────────────────────

  describe("ensureSkillsDir", () => {
    it("creates the skills directory if it does not exist", () => {
      const stateDir = join(tmpDir, "state");
      const skillsDir = ensureSkillsDir(stateDir);

      expect(skillsDir).toBe(join(stateDir, "skills"));
      expect(existsSync(skillsDir)).toBe(true);
    });

    it("returns the path without error when directory already exists", () => {
      const stateDir = join(tmpDir, "state");
      // Call twice — second call should not throw
      ensureSkillsDir(stateDir);
      const skillsDir = ensureSkillsDir(stateDir);

      expect(existsSync(skillsDir)).toBe(true);
    });

    it("creates intermediate parent directories", () => {
      const stateDir = join(tmpDir, "deeply", "nested", "state");
      const skillsDir = ensureSkillsDir(stateDir);

      expect(existsSync(skillsDir)).toBe(true);
    });
  });

  // ── isSkillFile ─────────────────────────────────────────────────

  describe("isSkillFile", () => {
    it("returns true for SKILL.md", () => {
      expect(isSkillFile("SKILL.md")).toBe(true);
    });

    it("returns true for prefixed SKILL.md files", () => {
      expect(isSkillFile("my-tool-SKILL.md")).toBe(true);
      expect(isSkillFile("deploy-SKILL.md")).toBe(true);
      expect(isSkillFile("auth_login-SKILL.md")).toBe(true);
    });

    it("returns false for non-skill markdown files", () => {
      expect(isSkillFile("README.md")).toBe(false);
      expect(isSkillFile("CHANGELOG.md")).toBe(false);
      expect(isSkillFile("notes.md")).toBe(false);
    });

    it("returns false for files with skill in wrong case", () => {
      expect(isSkillFile("skill.md")).toBe(false);
      expect(isSkillFile("Skill.md")).toBe(false);
    });

    it("returns false for files that contain SKILL but do not end with SKILL.md", () => {
      expect(isSkillFile("SKILL.txt")).toBe(false);
      expect(isSkillFile("SKILL.md.bak")).toBe(false);
      expect(isSkillFile("SKILL.json")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isSkillFile("")).toBe(false);
    });
  });

  // ── watchSkillsDir ──────────────────────────────────────────────

  describe("watchSkillsDir", () => {
    let watcher: FSWatcher | undefined;
    let skillsDir: string;

    beforeEach(() => {
      skillsDir = ensureSkillsDir(tmpDir);
    });

    afterEach(() => {
      if (watcher) {
        watcher.close();
        watcher = undefined;
      }
    });

    it("detects a new SKILL.md file", async () => {
      const events: Array<{ event: string; filename: string }> = [];

      watcher = watchSkillsDir(skillsDir, (event, filename) => {
        events.push({ event, filename });
      });

      // Small delay so the watcher is fully set up before we write
      await sleep(50);

      writeFileSync(join(skillsDir, "deploy-SKILL.md"), "# Deploy Skill\n");

      // Wait for the event to propagate
      await waitFor(() => events.length > 0, 500);

      expect(events.length).toBeGreaterThan(0);
      const skillEvents = events.filter((e) => e.filename === "deploy-SKILL.md");
      expect(skillEvents.length).toBeGreaterThan(0);
    });

    it("detects a modified SKILL.md file", async () => {
      const filePath = join(skillsDir, "edit-SKILL.md");
      writeFileSync(filePath, "# Original\n");

      const events: Array<{ event: string; filename: string }> = [];

      watcher = watchSkillsDir(skillsDir, (event, filename) => {
        events.push({ event, filename });
      });

      await sleep(50);

      // Modify the file
      writeFileSync(filePath, "# Updated content\n");

      await waitFor(() => events.length > 0, 500);

      expect(events.length).toBeGreaterThan(0);
      const skillEvents = events.filter((e) => e.filename === "edit-SKILL.md");
      expect(skillEvents.length).toBeGreaterThan(0);
    });

    it("detects a deleted SKILL.md file", async () => {
      const filePath = join(skillsDir, "remove-SKILL.md");
      writeFileSync(filePath, "# To be removed\n");

      const events: Array<{ event: string; filename: string }> = [];

      watcher = watchSkillsDir(skillsDir, (event, filename) => {
        events.push({ event, filename });
      });

      await sleep(50);

      // Delete the file
      unlinkSync(filePath);

      await waitFor(() => events.length > 0, 500);

      expect(events.length).toBeGreaterThan(0);
      const skillEvents = events.filter(
        (e) => e.filename === "remove-SKILL.md",
      );
      expect(skillEvents.length).toBeGreaterThan(0);
    });

    it("returns a valid FSWatcher that can be closed", () => {
      watcher = watchSkillsDir(skillsDir, () => {});

      expect(watcher).toBeDefined();
      expect(typeof watcher.close).toBe("function");

      // Closing should not throw
      watcher.close();
      watcher = undefined;
    });
  });
});

// ── helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until `predicate` returns true, or reject after `timeoutMs`.
 */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      }
    }, 20);
  });
}
