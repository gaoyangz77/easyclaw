import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Jimp } from "jimp";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressImageBuffer } from "./image-compression-core.js";

// Silence the compressor's logger in this test.
vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Pure core — compressImageBuffer
// ---------------------------------------------------------------------------

describe("compressImageBuffer", () => {
  it("downscales a large image and returns a valid smaller JPEG", async () => {
    // Synthesize a 3000x2000 image with a gradient so JPEG can't trivially
    // compress it to near-zero bytes. Build RGBA via unsigned shifts so the
    // top byte (red) doesn't push the value negative in 32-bit signed math.
    const img = new Jimp({ width: 3000, height: 2000 });
    for (let y = 0; y < 2000; y += 1) {
      for (let x = 0; x < 3000; x += 1) {
        const r = Math.floor((x * 255) / 3000);
        const g = Math.floor((y * 255) / 2000);
        const b = Math.floor(((x + y) * 255) / 5000);
        const rgba = ((r * 0x01000000) + (g << 16) + (b << 8) + 0xff) >>> 0;
        img.setPixelColor(rgba, x, y);
      }
    }
    const input = await img.getBuffer("image/jpeg", { quality: 95 });
    const output = await compressImageBuffer(input);

    // Output is strictly smaller than the high-quality input.
    expect(output.byteLength).toBeLessThan(input.byteLength);

    // Output is a valid JPEG (SOI marker 0xFFD8) and decodes back.
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);
    const decoded = await Jimp.read(output);
    // And the longest edge has been resized to the configured max dimension.
    expect(Math.max(decoded.width, decoded.height)).toBeLessThanOrEqual(1280);
  }, 30_000);

  it("still returns a JPEG for a small image (no resize path)", async () => {
    const small = new Jimp({ width: 100, height: 80, color: 0xff0000ff });
    const input = await small.getBuffer("image/png");
    const output = await compressImageBuffer(input);
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);
    const decoded = await Jimp.read(output);
    expect(decoded.width).toBe(100);
    expect(decoded.height).toBe(80);
  }, 15_000);

  it("rejects a non-image buffer", async () => {
    await expect(compressImageBuffer(Buffer.from("not an image"))).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Wrapper — compressImageForAgent fail-open
// ---------------------------------------------------------------------------

describe("compressImageForAgent", () => {
  beforeEach(async () => {
    const mod = await import("./image-compressor.js");
    mod.__resetImageCompressorForTests();
  });

  it("falls open to the original buffer when the worker file is missing", async () => {
    // At test time the compiled worker at dist/image-compression-worker.cjs
    // does not exist alongside the test, so Worker spawn or exec will fail.
    // The wrapper must surface the original buffer + mime type rather than
    // throw or drop the image, AND mark the result `ok: false` with an error
    // string so callers can emit telemetry.
    const { compressImageForAgent } = await import("./image-compressor.js");
    const original = Buffer.from([1, 2, 3, 4, 5]);
    const result = await compressImageForAgent(original, "image/png");
    expect(result.ok).toBe(false);
    expect(result.buffer).toEqual(original);
    expect(result.mimeType).toBe("image/png");
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Fix 2 — double handleWorkerDeath() / cross-worker event leakage
// Fix 3 — synchronous throw inside pumpQueue's ensureWorker()
// ---------------------------------------------------------------------------

const fixtureDir = mkdtempSync(join(tmpdir(), "img-compressor-test-"));
afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

/** Writes a fixture worker script to disk and returns its absolute path. */
function writeFixtureWorker(filename: string, source: string): string {
  const full = join(fixtureDir, filename);
  writeFileSync(full, source, "utf8");
  return full;
}

describe("compressImageForAgent — worker lifecycle edge cases", () => {
  beforeEach(async () => {
    const mod = await import("./image-compressor.js");
    mod.__resetImageCompressorForTests();
  });

  it("ignores delayed events from a previous (dead) worker (Fix 2)", async () => {
    // Scenario this test locks in:
    //   1. Spawn worker A. A posts a delayed reply.
    //   2. Grab a handle to A. Manually crash A by emitting "error" → the
    //      registered handler calls handleWorkerDeath() (queue already empty
    //      because request was in-flight), setting worker = null and fail-
    //      opening the in-flight request.
    //   3. Spawn worker B via a new compress call with a fresh delayed reply.
    //   4. Emit a spurious "exit" on A (simulating Node's delayed exit after
    //      error). Without the closure guard, this would call
    //      handleWorkerDeath() a second time and drain B's in-flight. With
    //      the guard (`w !== worker`), A's handler is a no-op.
    //   5. Await B's reply — it must arrive normally, proving the stale
    //      event did not hijack the new worker's state.
    const {
      compressImageForAgent,
      __setWorkerPathForTests,
      __getCurrentWorkerForTests,
    } = await import("./image-compressor.js");

    // Well-behaved echo worker that replies with a JPEG-mimetype echo after
    // a short delay.
    const echoWorker = writeFixtureWorker(
      "echo-worker.cjs",
      `
        const { parentPort } = require("node:worker_threads");
        parentPort.on("message", async (msg) => {
          await new Promise((r) => setTimeout(r, 150));
          parentPort.postMessage(
            { id: msg.id, ok: true, buffer: msg.buffer, mimeType: "image/jpeg" },
            [msg.buffer],
          );
        });
      `,
    );
    __setWorkerPathForTests(echoWorker);

    // Step 1-2: start request A and grab A's Worker handle, then crash it.
    const reqA = compressImageForAgent(Buffer.from("a-payload"), "image/png");
    await new Promise((r) => setTimeout(r, 20));
    const workerA = __getCurrentWorkerForTests();
    expect(workerA).not.toBeNull();

    // Manually fire "error" on A — the registered listener drains in-flight
    // (fail-open with original buffer) and sets worker = null.
    workerA!.emit("error", new Error("simulated crash"));
    const resultA = await reqA;
    expect(resultA.ok).toBe(false);
    expect(resultA.buffer).toEqual(Buffer.from("a-payload"));
    expect(resultA.mimeType).toBe("image/png");
    if (!resultA.ok) expect(resultA.error).toContain("simulated crash");

    // Step 3: start request B — this spawns a fresh worker instance.
    const reqB = compressImageForAgent(Buffer.from("b-payload"), "image/png");
    await new Promise((r) => setTimeout(r, 20));
    const workerB = __getCurrentWorkerForTests();
    expect(workerB).not.toBeNull();
    expect(workerB).not.toBe(workerA);

    // Step 4: emit a spurious "exit" on the DEAD worker A. Without the
    // closure guard this would invoke handleWorkerDeath() again and drain
    // B's in-flight request prematurely with the original buffer.
    workerA!.emit("exit", 1);

    // Step 5: request B must resolve from B's own (real, delayed) reply as
    // an echoed JPEG — not as a prematurely failed-open PNG.
    const resultB = await reqB;
    expect(resultB.ok).toBe(true);
    expect(resultB.mimeType).toBe("image/jpeg");
    expect(Buffer.from(resultB.buffer).equals(Buffer.from("b-payload"))).toBe(true);

    // Terminate B cleanly so the test process doesn't leak the thread.
    await workerB!.terminate();
  }, 15_000);

  it("fail-opens when ensureWorker throws synchronously (Fix 3)", async () => {
    // Point the worker at a non-existent path that will cause new Worker(...)
    // to throw synchronously. The pending promise must resolve with the
    // original buffer instead of hanging forever.
    const { compressImageForAgent, __setWorkerPathForTests } = await import(
      "./image-compressor.js"
    );
    __setWorkerPathForTests("/definitely/does/not/exist/worker.cjs");

    const original = Buffer.from([9, 8, 7]);
    const result = await compressImageForAgent(original, "image/png");
    expect(result.ok).toBe(false);
    expect(result.buffer).toEqual(original);
    expect(result.mimeType).toBe("image/png");
    // The failure may surface either synchronously (spawn throw) or via the
    // "error" event (ENOENT on module resolve, which Node emits
    // asynchronously). Either path fail-opens with a non-empty error string.
    if (!result.ok) {
      expect(result.error).toMatch(/worker (spawn failed|error:)/);
    }
  }, 10_000);

  it("drains an entire queued batch when ensureWorker keeps throwing (Fix 3)", async () => {
    // When spawn fails synchronously, the recursive pumpQueue() call must
    // fail-open every queued peer too — not just the first one. This is the
    // invariant the comment in pumpQueue promises.
    const { compressImageForAgent, __setWorkerPathForTests } = await import(
      "./image-compressor.js"
    );
    __setWorkerPathForTests("/definitely/does/not/exist/worker.cjs");

    const inputs = [Buffer.from([1]), Buffer.from([2]), Buffer.from([3])];
    const results = await Promise.all(
      inputs.map((buf) => compressImageForAgent(buf, "image/png")),
    );
    for (let i = 0; i < inputs.length; i += 1) {
      expect(results[i].ok).toBe(false);
      expect(results[i].buffer).toEqual(inputs[i]);
      expect(results[i].mimeType).toBe("image/png");
    }
  }, 10_000);
});
