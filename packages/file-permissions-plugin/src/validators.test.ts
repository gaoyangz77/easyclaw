/**
 * Tests for file permission validators
 */

import { describe, it, expect } from "vitest";
import { parseFilePermissions, isPathAllowed, extractFilePaths } from "./validators.js";
import { join } from "node:path";
import { homedir } from "node:os";

describe("parseFilePermissions", () => {
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

  it("should handle empty string", () => {
    const result = parseFilePermissions("");
    expect(result.read).toHaveLength(0);
    expect(result.write).toHaveLength(0);
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
