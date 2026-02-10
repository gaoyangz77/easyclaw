/**
 * Standalone CLI script for Volcengine STT (Speech-to-Text) — Model 2.0.
 *
 * Usage: node volcengine-stt-cli.mjs <audio-file-path>
 *
 * Reads VOLCENGINE_APP_KEY and VOLCENGINE_ACCESS_KEY from environment variables.
 * Submits the audio file to Volcengine's Model 2.0 recording file recognition API,
 * polls for the result, and prints the transcribed text to stdout.
 *
 * This script is invoked by OpenClaw's media-understanding CLI runner
 * as a bridge between OpenClaw and EasyClaw's Volcengine STT integration.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";

const SUBMIT_URL =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const QUERY_URL =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
const RESOURCE_ID = "volc.seedasr.auc";
const MODEL_NAME = "bigmodel";

const INITIAL_POLL_MS = 2_000;
const MAX_POLL_MS = 30_000;
const TIMEOUT_MS = 5 * 60 * 1_000;
const BACKOFF = 2;

/** Model 2.0 status codes (from x-api-status-code header) */
const STATUS_OK = "20000000";
const STATUS_PROCESSING = "40000003";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHeader(res: Response, name: string): string {
  return res.headers.get(name) ?? "";
}

async function submit(
  audio: Buffer,
  format: string,
  appKey: string,
  accessKey: string,
  requestId: string,
): Promise<void> {
  const res = await fetch(SUBMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-App-Key": appKey,
      "X-Api-Access-Key": accessKey,
      "X-Api-Resource-Id": RESOURCE_ID,
      "X-Api-Request-Id": requestId,
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      user: { uid: appKey },
      audio: { format, data: audio.toString("base64") },
      request: { model_name: MODEL_NAME },
    }),
  });

  const statusCode = getHeader(res, "x-api-status-code");
  const message = getHeader(res, "x-api-message");

  if (!res.ok || statusCode !== STATUS_OK) {
    const body = await res.text();
    throw new Error(
      `Submit failed: HTTP ${res.status}, status=${statusCode}, message=${message}, body=${body}`,
    );
  }
}

interface QueryResult {
  text?: string;
  utterances?: Array<{ text: string }>;
}

async function poll(
  appKey: string,
  accessKey: string,
  requestId: string,
): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  let interval = INITIAL_POLL_MS;

  while (Date.now() < deadline) {
    await sleep(interval);

    const res = await fetch(QUERY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-App-Key": appKey,
        "X-Api-Access-Key": accessKey,
        "X-Api-Resource-Id": RESOURCE_ID,
        "X-Api-Request-Id": requestId,
        "X-Api-Sequence": "-1",
      },
      body: JSON.stringify({}),
    });

    const statusCode = getHeader(res, "x-api-status-code");
    const message = getHeader(res, "x-api-message");

    if (statusCode === STATUS_PROCESSING) {
      interval = Math.min(interval * BACKOFF, MAX_POLL_MS);
      continue;
    }

    if (!res.ok || statusCode !== STATUS_OK) {
      const body = await res.text();
      throw new Error(
        `Query failed: HTTP ${res.status}, status=${statusCode}, message=${message}, body=${body}`,
      );
    }

    const data = (await res.json()) as { result?: QueryResult };
    if (data.result?.text) return data.result.text;
    if (data.result?.utterances?.length) {
      return data.result.utterances.map((u) => u.text).join("");
    }
    return "";
  }

  throw new Error(`Timed out after ${TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    process.stderr.write("Usage: volcengine-stt-cli <audio-file-path>\n");
    process.exit(1);
  }

  const appKey = process.env.VOLCENGINE_APP_KEY;
  const accessKey = process.env.VOLCENGINE_ACCESS_KEY;
  if (!appKey || !accessKey) {
    process.stderr.write("Missing VOLCENGINE_APP_KEY or VOLCENGINE_ACCESS_KEY\n");
    process.exit(1);
  }

  const ext = extname(filePath).replace(".", "").toLowerCase();
  const format = ext === "oga" ? "ogg" : ext || "ogg";
  const audio = readFileSync(filePath);
  const requestId = randomUUID();

  await submit(audio, format, appKey, accessKey, requestId);
  const text = await poll(appKey, accessKey, requestId);

  process.stdout.write(text);
}

main().catch((err) => {
  process.stderr.write(`Volcengine STT error: ${String(err)}\n`);
  process.exit(1);
});
