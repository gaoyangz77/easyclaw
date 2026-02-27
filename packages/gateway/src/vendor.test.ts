import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  resolveVendorDir,
  resolveVendorEntryPath,
  resolveVendorVersion,
  assertVendorExists,
  getGatewayCommand,
} from "./vendor.js";

// The vendor directory relative to this test file (packages/gateway/src/)
// is at ../../../vendor/openclaw. We compute it here for assertions.
const expectedVendorDir = join(import.meta.dirname, "../../../vendor/openclaw");

describe("resolveVendorDir", () => {
  it("returns a path ending in vendor/openclaw when no override is given", () => {
    const dir = resolveVendorDir();
    expect(dir).toMatch(/vendor[/\\]openclaw$/);
  });

  it("returns the override path when provided", () => {
    const dir = resolveVendorDir("/tmp/test-vendor");
    expect(dir).toBe(resolve("/tmp/test-vendor"));
  });

  it("resolves relative override paths to absolute", () => {
    const dir = resolveVendorDir("relative/path");
    expect(dir).toBe(resolve("relative/path"));
  });
});

describe("resolveVendorEntryPath", () => {
  it("returns a path ending in openclaw.mjs", () => {
    const entryPath = resolveVendorEntryPath();
    expect(entryPath).toMatch(/openclaw\.mjs$/);
  });

  it("uses custom vendor dir when provided", () => {
    const entryPath = resolveVendorEntryPath("/tmp/custom-vendor");
    expect(entryPath).toBe(join(resolve("/tmp/custom-vendor"), "openclaw.mjs"));
  });
});

describe("resolveVendorVersion", () => {
  it("returns a version string from the vendor package.json", () => {
    const version = resolveVendorVersion();
    // The version should be a non-empty string matching a date-based format
    expect(version).toBeTruthy();
    expect(typeof version).toBe("string");
    expect(version).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}$/);
  });

  it("throws when vendor dir does not exist", () => {
    expect(() => resolveVendorVersion("/nonexistent/path")).toThrow(
      /package\.json not found/,
    );
  });
});

describe("assertVendorExists", () => {
  it("does not throw when vendor exists", () => {
    expect(() => assertVendorExists()).not.toThrow();
  });

  it("throws when vendor directory does not exist", () => {
    expect(() => assertVendorExists("/nonexistent/vendor")).toThrow(
      /vendor directory not found/,
    );
  });
});

describe("getGatewayCommand", () => {
  it("returns node as the command", () => {
    const cmd = getGatewayCommand();
    expect(cmd.command).toBe("node");
  });

  it("returns args with entry path and gateway subcommand", () => {
    const cmd = getGatewayCommand();
    expect(cmd.args).toHaveLength(2);
    expect(cmd.args[0]).toMatch(/openclaw\.mjs$/);
    expect(cmd.args[1]).toBe("gateway");
  });

  it("the entry path in args points to an existing file", () => {
    const cmd = getGatewayCommand();
    expect(existsSync(cmd.args[0])).toBe(true);
  });

  it("throws when vendor does not exist", () => {
    expect(() => getGatewayCommand("/nonexistent/vendor")).toThrow();
  });
});
