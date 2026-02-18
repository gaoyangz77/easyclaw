/**
 * Tests for file permission validators
 */

import { describe, it, expect } from "vitest";
import { parseFilePermissions, isPathAllowed, extractFilePaths, extractExecFilePaths } from "./validators.js";
import path, { join } from "node:path";
import { homedir } from "node:os";

describe("parseFilePermissions", () => {
  describe("legacy colon-delimited format", () => {
    it("should parse read permissions", () => {
      const result = parseFilePermissions("read:/path1:/path2");
      expect(result.read).toHaveLength(2);
      expect(result.write).toHaveLength(0);
    });

    it("should parse write permissions", () => {
      const result = parseFilePermissions("write:/path1:/path2");
      expect(result.read).toHaveLength(0);
      expect(result.write).toHaveLength(2);
    });

    it("should parse both read and write permissions", () => {
      const result = parseFilePermissions("read:/path1:/path2,write:/path3:/path4");
      expect(result.read).toHaveLength(2);
      expect(result.write).toHaveLength(2);
    });

    it("should handle whitespace", () => {
      const result = parseFilePermissions("  read:/path1:/path2  ,  write:/path3  ");
      expect(result.read).toHaveLength(2);
      expect(result.write).toHaveLength(1);
    });

    it("should expand tilde to home directory", () => {
      const result = parseFilePermissions("read:~/Documents");
      expect(result.read[0]).toBe(join(homedir(), "Documents"));
    });

    it("should ignore invalid formats", () => {
      const result = parseFilePermissions("invalid,read:/path1");
      expect(result.read).toHaveLength(1);
      expect(result.write).toHaveLength(0);
    });
  });

  describe("JSON format", () => {
    it("should parse JSON with readPaths and writePaths", () => {
      const json = JSON.stringify({
        workspacePath: "/home/user/project",
        readPaths: ["/home/user/docs", "/var/log"],
        writePaths: ["/home/user/project"],
      });
      const result = parseFilePermissions(json);
      expect(result.read).toHaveLength(2);
      // write includes workspacePath + writePaths
      expect(result.write).toHaveLength(2);
    });

    it("should include workspacePath as implicit write path", () => {
      const wsPath = "/home/user/workspace";
      const json = JSON.stringify({
        workspacePath: wsPath,
        readPaths: [],
        writePaths: [],
      });
      const result = parseFilePermissions(json);
      expect(result.write).toHaveLength(1);
      expect(result.write[0]).toBe(path.resolve(wsPath));
      // agent can read+write its own workspace even with empty user permissions
      expect(isPathAllowed(path.resolve(wsPath, "memory/note.md"), result, "read")).toBe(true);
      expect(isPathAllowed(path.resolve(wsPath, "memory/note.md"), result, "write")).toBe(true);
    });

    it("should allow all paths when fullAccess is true", () => {
      const json = JSON.stringify({
        fullAccess: true,
        readPaths: [],
        writePaths: [],
      });
      const result = parseFilePermissions(json);
      expect(result.fullAccess).toBe(true);
      expect(isPathAllowed("/any/path/on/disk", result, "read")).toBe(true);
      expect(isPathAllowed("/any/path/on/disk", result, "write")).toBe(true);
      expect(isPathAllowed("C:\\Windows\\System32\\file.txt", result, "write")).toBe(true);
    });

    it("should handle missing workspacePath gracefully", () => {
      const json = JSON.stringify({
        readPaths: ["/tmp/read"],
        writePaths: [],
      });
      const result = parseFilePermissions(json);
      expect(result.read).toHaveLength(1);
      expect(result.write).toHaveLength(0);
    });

    it("should expand tilde in JSON paths", () => {
      const json = JSON.stringify({
        readPaths: ["~/Documents"],
        writePaths: [],
      });
      const result = parseFilePermissions(json);
      expect(result.read[0]).toBe(join(homedir(), "Documents"));
    });

    it("should handle JSON with only readPaths", () => {
      const json = JSON.stringify({ readPaths: ["/tmp/read"] });
      const result = parseFilePermissions(json);
      expect(result.read).toHaveLength(1);
      expect(result.write).toHaveLength(0);
    });

    it("should handle JSON with only writePaths", () => {
      const json = JSON.stringify({ writePaths: ["/tmp/write"] });
      const result = parseFilePermissions(json);
      expect(result.read).toHaveLength(0);
      expect(result.write).toHaveLength(1);
    });

    it("should handle malformed JSON gracefully by falling through to legacy", () => {
      const result = parseFilePermissions("{bad json,read:/path1");
      expect(result.read).toHaveLength(1);
    });
  });

  it("should handle empty string", () => {
    const result = parseFilePermissions("");
    expect(result.read).toHaveLength(0);
    expect(result.write).toHaveLength(0);
  });
});

describe("isPathAllowed", () => {
  const permissions = parseFilePermissions("read:/tmp/read,write:/tmp/write");

  it("should allow read access to read-permitted paths", () => {
    expect(isPathAllowed("/tmp/read/file.txt", permissions, "read")).toBe(true);
  });

  it("should allow read access to write-permitted paths", () => {
    expect(isPathAllowed("/tmp/write/file.txt", permissions, "read")).toBe(true);
  });

  it("should deny read access to non-permitted paths", () => {
    expect(isPathAllowed("/tmp/other/file.txt", permissions, "read")).toBe(false);
  });

  it("should allow write access to write-permitted paths", () => {
    expect(isPathAllowed("/tmp/write/file.txt", permissions, "write")).toBe(true);
  });

  it("should deny write access to read-only paths", () => {
    expect(isPathAllowed("/tmp/read/file.txt", permissions, "write")).toBe(false);
  });

  it("should deny write access to non-permitted paths", () => {
    expect(isPathAllowed("/tmp/other/file.txt", permissions, "write")).toBe(false);
  });

  it("should allow exact path match", () => {
    expect(isPathAllowed("/tmp/read", permissions, "read")).toBe(true);
  });

  it("should allow nested paths", () => {
    expect(isPathAllowed("/tmp/read/subdir/file.txt", permissions, "read")).toBe(true);
  });

  it("should deny paths that are not under allowed directory", () => {
    expect(isPathAllowed("/tmp/readonly", permissions, "read")).toBe(false);
  });

  it("should handle relative paths by converting to absolute", () => {
    const relPermissions = parseFilePermissions(`write:${process.cwd()}`);
    expect(isPathAllowed("./file.txt", relPermissions, "write")).toBe(true);
  });

  describe("with JSON-parsed permissions", () => {
    const jsonPerms = parseFilePermissions(JSON.stringify({
      readPaths: ["/Users/test/Desktop/AMC", "/Users/test/Desktop/tdx accounting"],
      writePaths: ["/Users/test/Desktop/AMC"],
    }));

    it("should allow read in read paths", () => {
      expect(isPathAllowed("/Users/test/Desktop/AMC/file.txt", jsonPerms, "read")).toBe(true);
    });

    it("should allow read in paths with spaces", () => {
      expect(isPathAllowed("/Users/test/Desktop/tdx accounting/report.xlsx", jsonPerms, "read")).toBe(true);
    });

    it("should deny read outside allowed paths", () => {
      expect(isPathAllowed("/Users/test/Desktop/123/test file", jsonPerms, "read")).toBe(false);
    });

    it("should deny write to read-only paths", () => {
      expect(isPathAllowed("/Users/test/Desktop/tdx accounting/file.txt", jsonPerms, "write")).toBe(false);
    });

    it("should allow write to write paths", () => {
      expect(isPathAllowed("/Users/test/Desktop/AMC/file.txt", jsonPerms, "write")).toBe(true);
    });
  });
});

describe("extractFilePaths", () => {
  it("should extract file_path parameter", () => {
    const params = { file_path: "/tmp/file.txt" };
    const paths = extractFilePaths(params);
    expect(paths).toContain("/tmp/file.txt");
  });

  it("should extract path parameter", () => {
    const params = { path: "/tmp/file.txt" };
    const paths = extractFilePaths(params);
    expect(paths).toContain("/tmp/file.txt");
  });

  it("should extract multiple path parameters", () => {
    const params = { path: "/tmp/file1.txt", cwd: "/tmp/dir" };
    const paths = extractFilePaths(params);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("/tmp/file1.txt");
    expect(paths).toContain("/tmp/dir");
  });

  it("should ignore non-string parameters", () => {
    const params = { file_path: 123, other: true };
    const paths = extractFilePaths(params);
    expect(paths).toHaveLength(0);
  });

  it("should ignore empty string paths", () => {
    const params = { file_path: "  " };
    const paths = extractFilePaths(params);
    expect(paths).toHaveLength(0);
  });

  it("should handle params with no file paths", () => {
    const params = { model: "gpt-4", temperature: 0.7 };
    const paths = extractFilePaths(params);
    expect(paths).toHaveLength(0);
  });
});

describe("extractExecFilePaths", () => {
  it("should extract absolute paths from command string", () => {
    const params = { command: "cat /tmp/secret.txt" };
    const paths = extractExecFilePaths(params);
    expect(paths).toContain("/tmp/secret.txt");
  });

  it("should extract tilde paths from command string", () => {
    const params = { command: "cat ~/Desktop/123/test\\ file" };
    const paths = extractExecFilePaths(params);
    expect(paths).toContain("~/Desktop/123/test file");
  });

  it("should extract paths from quoted strings", () => {
    const params = { command: 'cat "/Users/test/Desktop/my file.txt"' };
    const paths = extractExecFilePaths(params);
    expect(paths).toContain("/Users/test/Desktop/my file.txt");
  });

  it("should extract paths from single-quoted strings", () => {
    const params = { command: "cat '/Users/test/Desktop/my file.txt'" };
    const paths = extractExecFilePaths(params);
    expect(paths).toContain("/Users/test/Desktop/my file.txt");
  });

  it("should extract multiple paths", () => {
    const params = { command: "cp /tmp/src.txt /tmp/dst.txt" };
    const paths = extractExecFilePaths(params);
    expect(paths).toContain("/tmp/src.txt");
    expect(paths).toContain("/tmp/dst.txt");
  });

  it("should return empty array for no paths", () => {
    const params = { command: "echo hello world" };
    const paths = extractExecFilePaths(params);
    expect(paths).toHaveLength(0);
  });

  it("should return empty array for non-string command", () => {
    const params = { command: 123 };
    const paths = extractExecFilePaths(params);
    expect(paths).toHaveLength(0);
  });

  it("should handle cmd parameter", () => {
    const params = { cmd: "cat /etc/passwd" };
    const paths = extractExecFilePaths(params);
    expect(paths).toContain("/etc/passwd");
  });

  it("should handle paths with escaped spaces", () => {
    const params = { command: "cat /Users/test/my\\ documents/file.txt" };
    const paths = extractExecFilePaths(params);
    expect(paths).toContain("/Users/test/my documents/file.txt");
  });
});
