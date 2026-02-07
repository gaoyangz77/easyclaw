import { createLogger } from "@easyclaw/logger";
import type { SttProvider, SttResult } from "./types.js";

const log = createLogger("stt:groq");

const GROQ_API_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

const MODEL = "whisper-large-v3-turbo";

/** Maximum file size in bytes (25 MB) */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const SUPPORTED_FORMATS = new Set([
  "flac",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "ogg",
  "wav",
  "webm",
]);

interface GroqTranscriptionResponse {
  text: string;
}

export class GroqSttProvider implements SttProvider {
  readonly name = "groq";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audio: Buffer, format: string): Promise<SttResult> {
    const startTime = Date.now();

    if (!SUPPORTED_FORMATS.has(format)) {
      throw new Error(
        `Unsupported audio format "${format}". Supported: ${[...SUPPORTED_FORMATS].join(", ")}`,
      );
    }

    if (audio.length > MAX_FILE_SIZE) {
      throw new Error(
        `Audio file too large (${audio.length} bytes). Maximum: ${MAX_FILE_SIZE} bytes (25 MB)`,
      );
    }

    log.info(`Starting Groq transcription, format=${format}, size=${audio.length} bytes`);

    const formData = new FormData();
    const blob = new Blob([audio], { type: `audio/${format}` });
    formData.append("file", blob, `audio.${format}`);
    formData.append("model", MODEL);
    formData.append("response_format", "json");

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Groq transcription failed: HTTP ${response.status} — ${text}`,
      );
    }

    const data = (await response.json()) as GroqTranscriptionResponse;

    const durationMs = Date.now() - startTime;
    log.info(`Groq transcription complete in ${durationMs}ms`);

    return {
      text: data.text,
      provider: "groq",
      durationMs,
    };
  }
}
