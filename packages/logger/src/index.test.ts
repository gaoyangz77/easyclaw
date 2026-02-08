import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLogger, enableFileLogging, _resetFileLogging, LOG_DIR } from "./index.js";

function createTempDir(): string {
  const dir = join(tmpdir(), `logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("createLogger", () => {
  it("creates a logger with the given name", () => {
    const log = createLogger("test");
    expect(log).toBeDefined();
    expect(log.settings.name).toBe("test");
  });

  it("LOG_DIR points to ~/.easyclaw/logs", () => {
    expect(LOG_DIR).toContain(".easyclaw");
    expect(LOG_DIR).toContain("logs");
  });
});

describe("file logging", () => {
  let tempDir: string;

  beforeEach(() => {
    _resetFileLogging();
    tempDir = createTempDir();
  });

  afterEach(() => {
    _resetFileLogging();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes log lines to easyclaw.log after enableFileLogging", () => {
    enableFileLogging({ logDir: tempDir });
    const log = createLogger("test-file");

    log.info("hello from test");

    const logPath = join(tempDir, "easyclaw.log");
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("[test-file]");
    expect(content).toContain("hello from test");
  });

  it("retroactively attaches to loggers created before enableFileLogging", () => {
    const log = createLogger("early-logger");

    enableFileLogging({ logDir: tempDir });
    log.info("retroactive message");

    const logPath = join(tempDir, "easyclaw.log");
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("[early-logger]");
    expect(content).toContain("retroactive message");
  });

  it("does not write to file when file logging is not enabled", () => {
    const log = createLogger("silent-logger");
    log.info("should not appear on disk");

    const logPath = join(tempDir, "easyclaw.log");
    expect(existsSync(logPath)).toBe(false);
  });

  it("rotates when log file exceeds maxFileSize", () => {
    enableFileLogging({ logDir: tempDir, maxFileSize: 200 });
    const log = createLogger("rotate-test");

    for (let i = 0; i < 20; i++) {
      log.info(`line ${i} with some padding to fill the file quickly`);
    }

    const logPath = join(tempDir, "easyclaw.log");
    const prevPath = join(tempDir, "easyclaw.log.1");

    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(prevPath)).toBe(true);
  });

  it("total disk usage stays bounded", () => {
    const maxSize = 500;
    enableFileLogging({ logDir: tempDir, maxFileSize: maxSize });
    const log = createLogger("bound-test");

    for (let i = 0; i < 100; i++) {
      log.info(`entry ${i}: ${"x".repeat(50)}`);
    }

    const logPath = join(tempDir, "easyclaw.log");
    const prevPath = join(tempDir, "easyclaw.log.1");

    let totalSize = 0;
    if (existsSync(logPath)) totalSize += statSync(logPath).size;
    if (existsSync(prevPath)) totalSize += statSync(prevPath).size;

    // Bounded by ~2x maxSize + one check interval of writes
    expect(totalSize).toBeLessThan(maxSize * 4);
  });

  it("formats log lines with timestamp, level, and name", () => {
    enableFileLogging({ logDir: tempDir });
    const log = createLogger("fmt-test");

    log.warn("something went wrong", "detail");

    const content = readFileSync(join(tempDir, "easyclaw.log"), "utf-8");
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).toMatch(/WARN/);
    expect(content).toContain("[fmt-test]");
    expect(content).toContain("something went wrong");
  });
});
