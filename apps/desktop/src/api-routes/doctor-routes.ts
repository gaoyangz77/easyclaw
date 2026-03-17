import { spawn, execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createLogger } from "@rivonclaw/logger";
import { resolveOpenClawStateDir, resolveOpenClawConfigPath } from "@rivonclaw/core/node";
import type { RouteHandler } from "./api-context.js";

const log = createLogger("doctor");

const DOCTOR_TIMEOUT_MS = 60_000;
const isWindows = process.platform === "win32";

let doctorRunning = false;

export const handleDoctorRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  if (pathname !== "/api/doctor/run" || req.method !== "GET") {
    return false;
  }

  const sendSSE = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  if (doctorRunning) {
    sendSSE({ type: "error", message: "Doctor is already running" });
    res.end();
    return true;
  }

  const entryPath = join(ctx.vendorDir, "openclaw.mjs");

  if (!existsSync(ctx.nodeBin)) {
    sendSSE({ type: "error", message: `Node binary not found: ${ctx.nodeBin}` });
    res.end();
    return true;
  }

  if (!existsSync(entryPath)) {
    sendSSE({ type: "error", message: `OpenClaw entry point not found: ${entryPath}` });
    res.end();
    return true;
  }

  const fix = url.searchParams.get("fix") === "true";
  const args = [entryPath, "doctor", "--non-interactive"];
  if (fix) args.push("--fix");

  const stateDir = resolveOpenClawStateDir();

  doctorRunning = true;
  let killed = false;

  const child = spawn(ctx.nodeBin, args, {
    cwd: stateDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_CONFIG_PATH: resolveOpenClawConfigPath(),
    },
  });

  const cleanup = () => {
    doctorRunning = false;
  };

  const killProcess = () => {
    if (killed || !child.pid) return;
    killed = true;
    try {
      if (isWindows) {
        execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: "ignore" });
      } else {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      // Process may have already exited
    }
  };

  const timeout = setTimeout(() => {
    log.warn("Doctor process timed out after 60s, killing");
    killProcess();
    if (res.writable) {
      sendSSE({ type: "error", message: "Doctor timed out after 60 seconds" });
      res.end();
    }
    cleanup();
  }, DOCTOR_TIMEOUT_MS);

  const handleLine = (line: string) => {
    if (!res.writable) return;
    sendSSE({ type: "output", text: line });
  };

  const processStream = (stream: NodeJS.ReadableStream) => {
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        handleLine(line);
      }
    });
    stream.on("end", () => {
      if (buffer.length > 0) {
        handleLine(buffer);
        buffer = "";
      }
    });
  };

  if (child.stdout) processStream(child.stdout);
  if (child.stderr) processStream(child.stderr);

  child.on("error", (err) => {
    clearTimeout(timeout);
    log.error("Doctor process spawn error:", err);
    if (res.writable) {
      sendSSE({ type: "error", message: `Failed to spawn doctor: ${err.message}` });
      res.end();
    }
    cleanup();
  });

  child.on("close", (exitCode) => {
    clearTimeout(timeout);
    if (res.writable && !killed) {
      sendSSE({ type: "done", exitCode: exitCode ?? 1 });
      res.end();
    }
    cleanup();
  });

  req.on("close", () => {
    if (!child.killed) {
      log.info("Client disconnected, killing doctor process");
      killProcess();
    }
    clearTimeout(timeout);
    cleanup();
  });

  return true;
};
