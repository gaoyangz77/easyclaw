import { execFile } from "node:child_process";

/** Audio formats natively supported by STT providers (Groq Whisper). */
export const STT_SUPPORTED_FORMATS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);

/**
 * Convert audio to MP3 using ffmpeg (piped via stdin/stdout).
 * Throws if ffmpeg is unavailable — callers should surface the error.
 */
export function convertAudioToMp3(input: Buffer, inputFormat: string): Promise<{ data: Buffer; format: string }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      "ffmpeg",
      ["-i", "pipe:0", "-f", inputFormat, "-f", "mp3", "-ac", "1", "-ar", "16000", "pipe:1"],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024, timeout: 15_000 },
      (err, stdout) => {
        if (err) {
          const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT";
          if (isNotFound) {
            reject(new Error(
              "ffmpeg not found. Voice messages in AMR format require ffmpeg for conversion.\n" +
              "  macOS:   brew install ffmpeg\n" +
              "  Windows: winget install ffmpeg   (or download from https://ffmpeg.org/download.html)\n" +
              "  Linux:   sudo apt install ffmpeg",
            ));
            return;
          }
          reject(new Error(`ffmpeg conversion failed: ${err.message}`));
          return;
        }
        if (!stdout || stdout.length === 0) {
          reject(new Error("ffmpeg produced empty output"));
          return;
        }
        resolve({ data: stdout as unknown as Buffer, format: "mp3" });
      },
    );
    proc.stdin?.end(input);
  });
}
