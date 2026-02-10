import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { SttProvider, SttResult } from "./types.js";

const log = createLogger("stt:volcengine");

const SUBMIT_URL =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const QUERY_URL =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";

const RESOURCE_ID = "volc.seedasr.auc";
const MODEL_NAME = "bigmodel";

/** Model 2.0 status codes (from x-api-status-code header) */
const STATUS_OK = "20000000";
const STATUS_PROCESSING = "40000003";

/** Initial poll interval in milliseconds */
const INITIAL_POLL_INTERVAL_MS = 2_000;
/** Maximum poll interval in milliseconds */
const MAX_POLL_INTERVAL_MS = 30_000;
/** Total timeout in milliseconds (5 minutes) */
const TIMEOUT_MS = 5 * 60 * 1_000;
/** Exponential backoff multiplier */
const BACKOFF_MULTIPLIER = 2;

interface QueryResult {
  text?: string;
  utterances?: Array<{ text: string }>;
}

export class VolcengineSttProvider implements SttProvider {
  readonly name = "volcengine";
  private readonly appKey: string;
  private readonly accessKey: string;

  constructor(appKey: string, accessKey: string) {
    this.appKey = appKey;
    this.accessKey = accessKey;
  }

  async transcribe(audio: Buffer, format: string): Promise<SttResult> {
    const startTime = Date.now();
    const requestId = randomUUID();

    log.info(`Starting transcription, requestId=${requestId}, format=${format}`);

    // Submit the audio for processing (Model 2.0 uses requestId as task ID)
    await this.submit(audio, format, requestId);
    log.info(`Task submitted, requestId=${requestId}`);

    // Poll for the result
    const text = await this.pollResult(requestId);

    const durationMs = Date.now() - startTime;
    log.info(`Transcription complete in ${durationMs}ms`);

    return {
      text,
      provider: "volcengine",
      durationMs,
    };
  }

  private async submit(
    audio: Buffer,
    format: string,
    requestId: string,
  ): Promise<void> {
    const response = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-App-Key": this.appKey,
        "X-Api-Access-Key": this.accessKey,
        "X-Api-Resource-Id": RESOURCE_ID,
        "X-Api-Request-Id": requestId,
        "X-Api-Sequence": "-1",
      },
      body: JSON.stringify({
        user: { uid: this.appKey },
        audio: { format, data: audio.toString("base64") },
        request: { model_name: MODEL_NAME },
      }),
    });

    const statusCode = response.headers.get("x-api-status-code") ?? "";
    const message = response.headers.get("x-api-message") ?? "";

    if (!response.ok || statusCode !== STATUS_OK) {
      const body = await response.text();
      throw new Error(
        `Volcengine submit failed: HTTP ${response.status}, status=${statusCode}, message=${message}, body=${body}`,
      );
    }
  }

  private async pollResult(requestId: string): Promise<string> {
    const deadline = Date.now() + TIMEOUT_MS;
    let interval = INITIAL_POLL_INTERVAL_MS;

    while (Date.now() < deadline) {
      await sleep(interval);

      const response = await fetch(QUERY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-App-Key": this.appKey,
          "X-Api-Access-Key": this.accessKey,
          "X-Api-Resource-Id": RESOURCE_ID,
          "X-Api-Request-Id": requestId,
          "X-Api-Sequence": "-1",
        },
        body: JSON.stringify({}),
      });

      const statusCode = response.headers.get("x-api-status-code") ?? "";
      const message = response.headers.get("x-api-message") ?? "";

      // Still processing — continue polling
      if (statusCode === STATUS_PROCESSING) {
        log.debug(`Task ${requestId} still processing, polling again in ${interval}ms`);
        interval = Math.min(interval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL_MS);
        continue;
      }

      if (!response.ok || statusCode !== STATUS_OK) {
        const body = await response.text();
        throw new Error(
          `Volcengine query failed: HTTP ${response.status}, status=${statusCode}, message=${message}, body=${body}`,
        );
      }

      const data = (await response.json()) as { result?: QueryResult };
      if (data.result?.text) return data.result.text;
      if (data.result?.utterances?.length) {
        return data.result.utterances.map((u) => u.text).join("");
      }
      return "";
    }

    throw new Error(
      `Volcengine transcription timed out after ${TIMEOUT_MS}ms for request ${requestId}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
