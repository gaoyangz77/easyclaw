import http from "node:http";
import { DEFAULT_CLOUD_API_URL, CLOUD_API_URL_KEY } from "@rivonclaw/core";
import { isNewerVersion } from "@rivonclaw/updater";
import { createLogger } from "@rivonclaw/logger";

const log = createLogger("cloud-update");

export interface CloudUpdatePayload {
  version: string;
  downloadUrl?: string;
}

/**
 * SSE client that subscribes to the cloud-api `/api/releases/subscribe`
 * endpoint for real-time update notifications.
 *
 * Automatically reconnects with exponential backoff.
 */
export class CloudUpdateClient {
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 2_000;

  constructor(
    private readonly currentVersion: string,
    private readonly onUpdate: (payload: CloudUpdatePayload) => void,
    private readonly getCloudApiUrl: () => string,
  ) {}

  start(): void {
    if (this.abortController) return;
    this.doConnect();
  }

  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
  }

  private doConnect(): void {
    const baseUrl = this.getCloudApiUrl().replace(/\/+$/, "");
    const url = `${baseUrl}/api/releases/subscribe?v=${encodeURIComponent(this.currentVersion)}`;

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    log.info(`Connecting to cloud update stream: ${baseUrl}`);

    // Use Node http/https to consume SSE stream
    const proto = url.startsWith("https") ? require("node:https") : http;
    const req = proto.get(url, { signal }, (res: http.IncomingMessage) => {
      if (res.statusCode !== 200) {
        log.warn(`Cloud update stream returned ${res.statusCode}`);
        res.resume();
        this.scheduleReconnect();
        return;
      }

      this.backoffMs = 2_000; // reset on successful connect
      log.info("Cloud update stream connected");

      let buffer = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        // SSE messages are separated by double newlines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          this.handleMessage(part);
        }
      });
      res.on("end", () => {
        log.info("Cloud update stream ended");
        this.scheduleReconnect();
      });
      res.on("error", (err: Error) => {
        if (signal.aborted) return;
        log.warn("Cloud update stream error:", err.message);
        this.scheduleReconnect();
      });
    });

    req.on("error", (err: Error) => {
      if (signal.aborted) return;
      log.warn("Cloud update connection failed:", err.message);
      this.scheduleReconnect();
    });
  }

  private handleMessage(raw: string): void {
    for (const line of raw.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const payload = JSON.parse(line.slice(6)) as { version?: string; downloadUrl?: string };
          if (!payload.version) return;
          if (!isNewerVersion(this.currentVersion, payload.version)) {
            log.info(`Cloud update dismissed: v${payload.version} not newer than v${this.currentVersion}`);
            return;
          }
          log.info(`Cloud update available: v${payload.version}`);
          this.onUpdate({ version: payload.version, downloadUrl: payload.downloadUrl });
        } catch { /* ignore malformed JSON */ }
      }
      // Ignore comments (keepalive lines starting with ":")
    }
  }

  private scheduleReconnect(): void {
    if (this.abortController?.signal.aborted) return;
    this.abortController = null;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    log.info(`Reconnecting cloud update stream in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }
}
