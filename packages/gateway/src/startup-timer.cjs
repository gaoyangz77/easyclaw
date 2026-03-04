/**
 * Startup timing preload script.
 *
 * Injected via NODE_OPTIONS="--require .../startup-timer.cjs" by the launcher.
 * Logs timestamps for key startup phases so we can see where time is spent.
 *
 * Output goes to stderr so it doesn't interfere with stdout protocol messages.
 */
"use strict";

const t0 = performance.now();
let requireCount = 0;
let requireTotalMs = 0;

// Filesystem operation counters
let fsOpCount = 0;
let fsOpTotalMs = 0;
let fsSlowOps = []; // Collect slow ops for summary

function logPhase(label) {
  const elapsed = (performance.now() - t0).toFixed(0);
  process.stderr.write(`[startup-timer] +${elapsed}ms ${label}\n`);
}

logPhase("preload executing");

// ── Hook CJS Module._load ──
const Module = require("module");
const origLoad = Module._load;

// ── Fix: Redirect openclaw/plugin-sdk to the already-loaded module ──
// Extensions use require("openclaw/plugin-sdk") as an external dependency.
// Without this hook, Node.js native require fails (no node_modules/openclaw/),
// causing jiti to fall back to its babel-transform pipeline. jiti's nested
// requires are NOT cached to disk, so the 17 MB plugin-sdk gets babel-
// transformed on EVERY startup (~12 s macOS, ~22 s Windows).
//
// This hook captures the absolute path of plugin-sdk when entry.js first
// loads it via require("./plugin-sdk/index.js"), then redirects all future
// require("openclaw/plugin-sdk") calls to that path. Since the module is
// already in Node's module cache, the redirect is free. jiti's native
// require succeeds → no fallback → no babel → instant extension loading.
let pluginSdkResolvedPath = null;
let pluginSdkDir = null;

const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithPluginSdk(
  request,
  parent,
  isMain,
  options,
) {
  if (pluginSdkResolvedPath) {
    if (request === "openclaw/plugin-sdk") {
      return pluginSdkResolvedPath;
    }
    if (request.startsWith("openclaw/plugin-sdk/")) {
      // e.g. "openclaw/plugin-sdk/account-id" → "<sdk-dir>/account-id"
      const subpath = request.slice("openclaw/plugin-sdk/".length);
      return origResolveFilename.call(
        this,
        path.join(pluginSdkDir, subpath),
        parent,
        isMain,
        options,
      );
    }
  }
  return origResolveFilename.call(this, request, parent, isMain, options);
};

Module._load = function timedLoad(request, parent, isMain) {
  requireCount++;
  const start = performance.now();
  const result = origLoad.call(this, request, parent, isMain);
  const dur = performance.now() - start;
  requireTotalMs += dur;

  // Capture plugin-sdk absolute path on first load
  if (!pluginSdkResolvedPath && /plugin-sdk[/\\]index\.js$/.test(request)) {
    try {
      pluginSdkResolvedPath = origResolveFilename.call(
        Module,
        request,
        parent,
        isMain,
      );
      pluginSdkDir = path.dirname(pluginSdkResolvedPath);
      logPhase(`plugin-sdk alias active: ${pluginSdkResolvedPath}`);
    } catch {
      // Non-critical — extensions will still load via jiti fallback
    }
  }

  if (dur > 100) {
    const shortReq =
      request.length > 60 ? "..." + request.slice(-57) : request;
    logPhase(`require("${shortReq}") took ${dur.toFixed(0)}ms`);
  }
  return result;
};

// ── Hook sync filesystem operations (Defender scanning shows up here) ──
const fs = require("fs");
const path = require("path");

function wrapFsSync(name) {
  const orig = fs[name];
  if (typeof orig !== "function") return;
  fs[name] = function () {
    fsOpCount++;
    const start = performance.now();
    const result = orig.apply(this, arguments);
    const dur = performance.now() - start;
    fsOpTotalMs += dur;
    if (dur > 50) {
      const arg0 = arguments[0];
      const p = typeof arg0 === "string" ? arg0 : String(arg0);
      const shortPath = p.length > 60 ? "..." + p.slice(-57) : p;
      fsSlowOps.push({ name, path: shortPath, dur });
      // Log individually if very slow
      if (dur > 200) {
        logPhase(`fs.${name}("${shortPath}") took ${dur.toFixed(0)}ms`);
      }
    }
    return result;
  };
}

// Hook all commonly used sync fs operations
[
  "openSync",
  "readFileSync",
  "existsSync",
  "statSync",
  "lstatSync",
  "realpathSync",
  "readdirSync",
  "accessSync",
  "closeSync",
].forEach(wrapFsSync);

// ── Hook Module._compile (CJS module compilation) ──
const origCompile = Module.prototype._compile;
Module.prototype._compile = function timedCompile(content, filename) {
  const start = performance.now();
  const result = origCompile.call(this, content, filename);
  const dur = performance.now() - start;
  if (dur > 100) {
    const shortName =
      filename.length > 60 ? "..." + filename.slice(-57) : filename;
    const sizeKB = (content.length / 1024).toFixed(0);
    logPhase(
      `Module._compile("${shortName}") took ${dur.toFixed(0)}ms (${sizeKB}KB)`,
    );
  }
  return result;
};

// ── Hook vm module (jiti uses vm.compileFunction, NOT Module._compile) ──
const vm = require("vm");
let vmCompileCount = 0;
let vmCompileTotalMs = 0;
let vmSlowCompiles = [];

const origCompileFunction = vm.compileFunction;
if (typeof origCompileFunction === "function") {
  vm.compileFunction = function timedCompileFunction(code, params, options) {
    vmCompileCount++;
    const start = performance.now();
    const result = origCompileFunction.call(this, code, params, options);
    const dur = performance.now() - start;
    vmCompileTotalMs += dur;
    if (dur > 50) {
      const filename =
        (options && options.filename) || "<anonymous>";
      const shortName =
        filename.length > 60 ? "..." + filename.slice(-57) : filename;
      const sizeKB = (code.length / 1024).toFixed(0);
      vmSlowCompiles.push({ filename: shortName, dur, sizeKB });
      logPhase(
        `vm.compileFunction("${shortName}") took ${dur.toFixed(0)}ms (${sizeKB}KB)`,
      );
    }
    return result;
  };
}

// Hook vm.Script constructor (another possible compilation path)
const OrigScript = vm.Script;
const origScriptProto = OrigScript.prototype;
function TimedScript(code, options) {
  vmCompileCount++;
  const start = performance.now();
  const instance = new OrigScript(code, options);
  const dur = performance.now() - start;
  vmCompileTotalMs += dur;
  if (dur > 50) {
    const filename =
      (typeof options === "string" ? options : options && options.filename) ||
      "<anonymous>";
    const shortName =
      filename.length > 60 ? "..." + filename.slice(-57) : filename;
    const sizeKB = (code.length / 1024).toFixed(0);
    vmSlowCompiles.push({ filename: shortName, dur, sizeKB });
    logPhase(
      `new vm.Script("${shortName}") took ${dur.toFixed(0)}ms (${sizeKB}KB)`,
    );
  }
  return instance;
}
TimedScript.prototype = origScriptProto;
vm.Script = TimedScript;

// Hook vm.runInThisContext / vm.runInNewContext (less common but possible)
for (const vmFn of ["runInThisContext", "runInNewContext"]) {
  const origVmFn = vm[vmFn];
  if (typeof origVmFn === "function") {
    vm[vmFn] = function (code, options) {
      vmCompileCount++;
      const start = performance.now();
      const result = origVmFn.call(this, code, options);
      const dur = performance.now() - start;
      vmCompileTotalMs += dur;
      if (dur > 50) {
        logPhase(`vm.${vmFn}() took ${dur.toFixed(0)}ms (${(code.length / 1024).toFixed(0)}KB)`);
      }
      return result;
    };
  }
}

// Log when the event loop starts processing (= all top-level ESM code done).
setImmediate(() => {
  logPhase(
    `event loop started (${requireCount} requires/${requireTotalMs.toFixed(0)}ms, ${fsOpCount} fs ops/${fsOpTotalMs.toFixed(0)}ms, ${vmCompileCount} vm compiles/${vmCompileTotalMs.toFixed(0)}ms)`,
  );

  // Log periodic heartbeats with cumulative stats
  let prevFsOps = fsOpCount;
  let prevFsMs = fsOpTotalMs;
  let prevVmCompiles = vmCompileCount;
  let prevVmMs = vmCompileTotalMs;
  let heartbeat = 0;
  const iv = setInterval(() => {
    heartbeat++;
    const newOps = fsOpCount - prevFsOps;
    const newMs = (fsOpTotalMs - prevFsMs).toFixed(0);
    const newVm = vmCompileCount - prevVmCompiles;
    const newVmMs = (vmCompileTotalMs - prevVmMs).toFixed(0);
    logPhase(
      `heartbeat #${heartbeat} (fs: +${newOps} ops/+${newMs}ms | vm: +${newVm} compiles/+${newVmMs}ms | totals: ${fsOpCount} fs/${fsOpTotalMs.toFixed(0)}ms, ${vmCompileCount} vm/${vmCompileTotalMs.toFixed(0)}ms)`,
    );
    // Flush slow ops summary at each heartbeat
    if (fsSlowOps.length > 0) {
      const summary = {};
      for (const op of fsSlowOps) {
        const key = op.name;
        summary[key] = (summary[key] || 0) + 1;
      }
      const parts = Object.entries(summary)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      logPhase(`  slow fs ops: ${parts}`);
      fsSlowOps = [];
    }
    if (vmSlowCompiles.length > 0) {
      for (const c of vmSlowCompiles) {
        logPhase(`  slow vm compile: ${c.filename} (${c.dur.toFixed(0)}ms, ${c.sizeKB}KB)`);
      }
      vmSlowCompiles = [];
    }
    prevFsOps = fsOpCount;
    prevFsMs = fsOpTotalMs;
    prevVmCompiles = vmCompileCount;
    prevVmMs = vmCompileTotalMs;
    if (heartbeat >= 60) clearInterval(iv);
  }, 1000);
  if (iv.unref) iv.unref();
});

// Log when the gateway starts listening (detect via stdout write)
const origStdoutWrite = process.stdout.write;
process.stdout.write = function (chunk, ...args) {
  const str = typeof chunk === "string" ? chunk : chunk.toString();
  if (str.includes("listening on")) {
    logPhase(
      `gateway listening (READY) — ${fsOpCount} fs/${fsOpTotalMs.toFixed(0)}ms, ${vmCompileCount} vm/${vmCompileTotalMs.toFixed(0)}ms`,
    );
  }
  return origStdoutWrite.call(this, chunk, ...args);
};

// Log at process exit for total lifetime
process.on("exit", () => {
  logPhase("process exiting");
});
