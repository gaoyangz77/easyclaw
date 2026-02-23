import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Lazy-loaded AMR codec instance.
 * The vendored amrnb.js (~1MB emscripten output) is loaded on first use
 * so it doesn't penalise startup time when AMR conversion isn't needed.
 */
let amrCodec: { toWAV(amr: Uint8Array): Uint8Array | null } | null = null;

function getAmrCodec() {
  if (!amrCodec) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    amrCodec = require("./vendor/amrnb.cjs") as typeof amrCodec;
  }
  return amrCodec!;
}

/**
 * Convert an AMR-NB audio buffer to WAV format using a pure-JS decoder.
 *
 * The output is 16-bit PCM, 8000 Hz, mono — matching AMR-NB's native
 * sample rate. Both Groq (Whisper) and Volcengine accept WAV.
 *
 * @throws {Error} if the buffer is not valid AMR-NB or decoding fails
 */
export function convertAmrToWav(amrBuffer: Buffer): Buffer {
  const amrArray = new Uint8Array(amrBuffer.buffer, amrBuffer.byteOffset, amrBuffer.byteLength);
  const codec = getAmrCodec();
  const wavArray = codec.toWAV(amrArray);
  if (!wavArray) {
    throw new Error("Failed to decode AMR audio: invalid or corrupted AMR-NB data");
  }
  return Buffer.from(wavArray.buffer, wavArray.byteOffset, wavArray.byteLength);
}
