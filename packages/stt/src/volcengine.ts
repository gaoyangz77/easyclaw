import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { SttProvider, SttResult } from "./types.js";

const log = createLogger("stt:volcengine");

const SUBMIT_URL =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/idle/submit";
const QUERY_URL =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/idle/query";

const RESOURCE_ID = "volc.bigasr.auc_idle";
const MODEL_NAME = "bigmodel";

/** Initial poll interval in milliseconds */
const INITIAL_POLL_INTERVAL_MS = 1_000;
/** Maximum poll interval in milliseconds */
const MAX_POLL_INTERVAL_MS = 30_000;
/** Total timeout in milliseconds (5 minutes) */
const TIMEOUT_MS = 5 * 60 * 1_000;
/** Exponential backoff multiplier */
const BACKOFF_MULTIPLIER = 2;

interface VolcengineSubmitResponse {
  resp: {
    code: number;
    msg: string;
    id: string;
  };
}

interface VolcengineQueryResponse {
  resp: {
    code: number;
    msg: string;
    text?: string;
    utterances?: Array<{
      text: string;
    }>;
  };
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

    // Submit the audio for processing
    const taskId = await this.submit(audio, format, requestId);
    log.info(`Task submitted, taskId=${taskId}`);

    // Poll for the result
    const text = await this.pollResult(taskId, requestId);

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
  ): Promise<string> {
    const mimeType = `audio/${format}`;
    const base64Audio = audio.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64Audio}`;

    const body = {
      user: { uid: this.appKey },
      audio: { url: dataUrl },
      request: { model_name: MODEL_NAME },
    };

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
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Volcengine submit failed: HTTP ${response.status} — ${text}`,
      );
    }

    const data = (await response.json()) as VolcengineSubmitResponse;

    if (data.resp.code !== 0) {
      throw new Error(
        `Volcengine submit error: code=${data.resp.code}, msg=${data.resp.msg}`,
      );
    }

    return data.resp.id;
  }

  private async pollResult(taskId: string, requestId: string): Promise<string> {
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
        body: JSON.stringify({ id: taskId }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Volcengine query failed: HTTP ${response.status} — ${text}`,
        );
      }

      const data = (await response.json()) as VolcengineQueryResponse;

      // code 0 = success (complete)
      if (data.resp.code === 0) {
        // Prefer the top-level text field; fall back to concatenating utterances
        if (data.resp.text) {
          return data.resp.text;
        }
        if (data.resp.utterances && data.resp.utterances.length > 0) {
          return data.resp.utterances.map((u) => u.text).join("");
        }
        return "";
      }

      // code 1000 = still processing — continue polling
      if (data.resp.code === 1000) {
        log.debug(`Task ${taskId} still processing, polling again in ${interval}ms`);
        interval = Math.min(interval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL_MS);
        continue;
      }

      // Any other code is an error
      throw new Error(
        `Volcengine query error: code=${data.resp.code}, msg=${data.resp.msg}`,
      );
    }

    throw new Error(
      `Volcengine transcription timed out after ${TIMEOUT_MS}ms for task ${taskId}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
