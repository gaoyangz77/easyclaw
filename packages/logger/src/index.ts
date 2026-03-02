import { Logger } from "tslog";
import {
  mkdirSync,
  appendFileSync,
  statSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { resolveLogDir } from "@easyclaw/core/node";

export const LOG_DIR = resolveLogDir();

const LOG_FILENAME = "easyclaw.log";
const LOG_FILENAME_PREV = "easyclaw.log.1";
const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file

// --- Module state ---
let fileLoggingEnabled = false;
let logDir = LOG_DIR;
let maxFileSize = DEFAULT_MAX_FILE_SIZE;
const registeredLoggers: Logger<unknown>[] = [];

export function ensureLogDir(): void {
  mkdirSync(logDir, { recursive: true });
}

export interface FileLoggingOptions {
  /** Max size per log file in bytes. Default: 5 MB. Total on disk ~ 2x this value. */
  maxFileSize?: number;
  /** Override log directory (for testing). Default: ~/.easyclaw/logs */
  logDir?: string;
}

/**
 * Enable file-based log persistence. Call once at app startup.
 *
 * Writes to `{logDir}/easyclaw.log`. When the file exceeds `maxFileSize`,
 * it is rotated to `easyclaw.log.1` (one backup). Total disk usage <= 2x maxFileSize.
 *
 * Loggers created before AND after this call will write to disk.
 */
export function enableFileLogging(options?: FileLoggingOptions): void {
  if (options?.logDir) logDir = options.logDir;
  maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  ensureLogDir();
  rotateIfNeeded();
  fileLoggingEnabled = true;

  // Retroactively attach transport to already-created loggers
  for (const logger of registeredLoggers) {
    attachFileTransport(logger);
  }
}

/**
 * Reset module state. Only for testing — do not call in production.
 * @internal
 */
export function _resetFileLogging(): void {
  fileLoggingEnabled = false;
  logDir = LOG_DIR;
  maxFileSize = DEFAULT_MAX_FILE_SIZE;
  registeredLoggers.length = 0;
}

function attachFileTransport(logger: Logger<unknown>): void {
  logger.attachTransport((logObj: Record<string, unknown>) => {
    writeToFile(formatLogLine(logObj));
  });
}

function getLogFilePath(): string {
  return join(logDir, LOG_FILENAME);
}

function rotateIfNeeded(): void {
  const logPath = getLogFilePath();
  try {
    if (!existsSync(logPath)) return;
    const { size } = statSync(logPath);
    if (size >= maxFileSize) {
      const prevPath = join(logDir, LOG_FILENAME_PREV);
      if (existsSync(prevPath)) unlinkSync(prevPath);
      renameSync(logPath, prevPath);
    }
  } catch {
    // Don't break the app for rotation errors
  }
}

function writeToFile(line: string): void {
  try {
    appendFileSync(getLogFilePath(), line + "\n", "utf-8");
    rotateIfNeeded();
  } catch {
    // Silently ignore — logging should never crash the app
  }
}

function formatLogLine(logObj: Record<string, unknown>): string {
  const meta = logObj._meta as
    | { date?: Date; logLevelName?: string; name?: string }
    | undefined;
  const ts = (meta?.date ?? new Date()).toISOString();
  const level = (meta?.logLevelName ?? "INFO").padEnd(5);
  const name = meta?.name ?? "";

  // Collect positional arguments (tslog stores them as "0", "1", …)
  const parts: string[] = [];
  for (let i = 0; ; i++) {
    const val = logObj[String(i)];
    if (val === undefined) break;
    parts.push(typeof val === "string" ? val : JSON.stringify(val));
  }

  return `${ts} ${level} [${name}] ${parts.join(" ")}`;
}

export function createLogger(name: string): Logger<unknown> {
  const logger = new Logger({
    name,
    type: "pretty",
    minLevel: process.env.NODE_ENV === "production" ? 3 : 0,
  });

  registeredLoggers.push(logger);

  if (fileLoggingEnabled) {
    attachFileTransport(logger);
  }

  return logger;
}
