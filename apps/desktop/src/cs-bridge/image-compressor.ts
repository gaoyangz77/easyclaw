/**
 * Fail-open image compression wrapper backed by a worker thread.
 *
 * Lazily spawns a single long-lived `Worker` on first call (worker startup is
 * 50-100ms; one image at a time is fine for CS message frequency). Serialises
 * requests via a FIFO queue and uses a correlation id so stray/late messages
 * cannot resolve the wrong promise.
 *
 * Fail-open contract: if the worker errors, crashes, or compression fails, we
 * log a warning and return the original buffer unchanged. Dropping a customer
 * image is worse than sending a big one — the CS pipeline must never lose a
 * message because of compression.
 *
 * The result is a discriminated union — `{ ok: true, buffer, mimeType }` on
 * success, `{ ok: false, buffer, mimeType, error }` on fail-open (still with
 * the original buffer so callers that ignore `ok` continue to behave
 * correctly). Callers that care about observability inspect `ok` and emit
 * telemetry themselves — this module stays CS-agnostic.
 *
 * Has no CS-specific knowledge: takes `(Buffer, mimeType)` in, returns a
 * `CompressResult` out. Reusable for any off-thread image compression.
 */

import { Worker } from "node:worker_threads";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@rivonclaw/logger";

const log = createLogger("image-compressor");

export type CompressResult =
  | { ok: true; buffer: Buffer; mimeType: string }
  | { ok: false; buffer: Buffer; mimeType: string; error: string };

// Sibling file inside dist/ — the worker is a separate tsdown build that emits
// `dist/image-compression-worker.cjs` alongside `main.cjs` (see tsdown.config.ts).
// This module's source lives under `src/cs-bridge/` but bundles into `main.cjs`,
// so at runtime `__dirname` is `dist/`. Works in dev and packaged Electron
// (inside asar — Node resolves paths inside asar transparently).
const WORKER_FILENAME = "image-compression-worker.cjs";

type PendingRequest = {
  id: number;
  buffer: Buffer;
  mimeType: string;
  resolve: (value: CompressResult) => void;
};

type WorkerResponse =
  | { id: number; ok: true; buffer: ArrayBuffer; mimeType: string }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let nextId = 1;
const queue: PendingRequest[] = [];
let inFlight: PendingRequest | null = null;

// Test-only override: when set, used verbatim instead of the dist/ sibling
// path. Allows unit tests to point at a fixture worker (e.g. one that crashes
// on purpose) without spawning the real production worker.
let workerPathOverride: string | null = null;

function resolveWorkerPath(): string {
  if (workerPathOverride !== null) return workerPathOverride;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, WORKER_FILENAME);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const workerPath = resolveWorkerPath();
  const w = new Worker(workerPath);
  // Bind every handler to this specific Worker instance via closure. If `w`
  // crashes, handleWorkerDeath() sets worker = null; any further events from
  // the same `w` (e.g. a delayed "exit" after "error") are ignored because
  // `w !== worker`. If a new worker is installed afterwards, it is a different
  // `w`, so old-worker events still fail the identity check and cannot drain
  // the new worker's inFlight request.
  w.on("message", (msg: WorkerResponse) => {
    if (w !== worker) return; // stale worker — ignore
    const pending = inFlight;
    inFlight = null;
    if (!pending || pending.id !== msg.id) {
      // Stale response after a crash/respawn — ignore.
      pumpQueue();
      return;
    }
    if (msg.ok) {
      pending.resolve({ ok: true, buffer: Buffer.from(msg.buffer), mimeType: msg.mimeType });
    } else {
      log.warn("Image compression worker returned error; falling back to original buffer", { error: msg.error });
      pending.resolve({
        ok: false,
        buffer: pending.buffer,
        mimeType: pending.mimeType,
        error: msg.error,
      });
    }
    pumpQueue();
  });
  w.on("error", (err) => {
    if (w !== worker) return; // stale worker — ignore
    log.warn("Image compression worker errored; will respawn on next request", { err });
    handleWorkerDeath(`worker error: ${err instanceof Error ? err.message : String(err)}`);
  });
  w.on("exit", (code) => {
    if (w !== worker) return; // stale worker — ignore
    if (code !== 0) {
      log.warn("Image compression worker exited unexpectedly; will respawn on next request", { code });
    }
    handleWorkerDeath(`worker exit code=${code}`);
  });
  worker = w;
  return w;
}

function handleWorkerDeath(error: string): void {
  worker = null;
  // Fail-open any in-flight and queued requests with their original buffers.
  if (inFlight) {
    inFlight.resolve({
      ok: false,
      buffer: inFlight.buffer,
      mimeType: inFlight.mimeType,
      error,
    });
    inFlight = null;
  }
  while (queue.length > 0) {
    const pending = queue.shift()!;
    pending.resolve({
      ok: false,
      buffer: pending.buffer,
      mimeType: pending.mimeType,
      error,
    });
  }
}

function pumpQueue(): void {
  if (inFlight || queue.length === 0) return;
  const next = queue.shift()!;
  inFlight = next;
  try {
    const w = ensureWorker();
    // Copy into a fresh ArrayBuffer for transfer: (1) keeps the original
    // Buffer intact so fail-open paths can still hand it back, (2) yields
    // a well-typed ArrayBuffer (Buffer.buffer is `ArrayBuffer | SharedArrayBuffer`).
    const ab = new ArrayBuffer(next.buffer.byteLength);
    new Uint8Array(ab).set(next.buffer);
    w.postMessage({ id: next.id, buffer: ab, mimeType: next.mimeType }, [ab]);
  } catch (err) {
    // Synchronous throw — e.g. new Worker() failed because the file vanished.
    // Without this catch, inFlight would be stuck and the pending promise
    // would hang forever. Fail-open with the original buffer and drain the
    // rest of the queue (each will also fail-open on the same condition).
    log.warn("Failed to dispatch to image worker; falling back to original buffer", { err });
    inFlight = null;
    const error = `worker spawn failed: ${err instanceof Error ? err.message : String(err)}`;
    next.resolve({
      ok: false,
      buffer: next.buffer,
      mimeType: next.mimeType,
      error,
    });
    pumpQueue();
  }
}

/**
 * Compress an image buffer off the main thread. Returns a discriminated union:
 *   - `{ ok: true, buffer, mimeType }` on success (compressed output).
 *   - `{ ok: false, buffer, mimeType, error }` on any failure — buffer/mimeType
 *     are the original inputs (fail-open) and `error` is a short description
 *     for observability.
 */
export function compressImageForAgent(
  buffer: Buffer,
  mimeType: string,
): Promise<CompressResult> {
  return new Promise((resolve) => {
    const pending: PendingRequest = {
      id: nextId++,
      buffer,
      mimeType,
      resolve,
    };
    queue.push(pending);
    // pumpQueue() owns the ensureWorker() call and handles synchronous spawn
    // failures by fail-opening the request. Do not preflight-spawn here — that
    // would fail-open only the current request and leave any queued peers
    // hanging.
    pumpQueue();
  });
}

/**
 * Test-only: reset module state between unit tests.
 */
export function __resetImageCompressorForTests(): void {
  if (worker) {
    void worker.terminate();
  }
  worker = null;
  inFlight = null;
  queue.length = 0;
  nextId = 1;
  workerPathOverride = null;
}

/**
 * Test-only: override the worker script path. Pass an absolute path to a
 * fixture script, or `null` to restore the default dist/ sibling lookup.
 */
export function __setWorkerPathForTests(path: string | null): void {
  workerPathOverride = path;
}

/**
 * Test-only: expose the currently-installed Worker instance so tests can
 * simulate stale events from a previous worker (Fix 2 race). Returns `null`
 * if no worker is currently installed.
 */
export function __getCurrentWorkerForTests(): Worker | null {
  return worker;
}
