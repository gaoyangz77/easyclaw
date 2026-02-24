import { app } from "electron";
import { createLogger } from "@easyclaw/logger";
import { RemoteTelemetryClient } from "@easyclaw/telemetry";
import type { Storage } from "@easyclaw/storage";

const log = createLogger("main");

export interface TelemetryInitResult {
  client: RemoteTelemetryClient | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

/**
 * Initialize the telemetry client and heartbeat timer.
 * Opt-out model: enabled by default, user can disable via consent dialog or Settings.
 * In dev mode, telemetry is OFF unless DEV_TELEMETRY=1 is set.
 */
export function initTelemetry(
  storage: Storage,
  deviceId: string,
  locale: string,
): TelemetryInitResult {
  const telemetryEnabled = !app.isPackaged
    ? process.env.DEV_TELEMETRY === "1"
    : storage.settings.get("telemetry_enabled") !== "false";

  const telemetryEndpoint = process.env.TELEMETRY_ENDPOINT
    || (locale === "zh" ? "https://t-cn.easy-claw.com/" : "https://t.easy-claw.com/");

  let client: RemoteTelemetryClient | null = null;

  if (telemetryEnabled) {
    try {
      client = new RemoteTelemetryClient({
        endpoint: telemetryEndpoint,
        enabled: true,
        version: app.getVersion(),
        platform: process.platform,
        locale,
        deviceId,
      });
      log.info("Telemetry client initialized (user opted in)");
    } catch (error) {
      log.error("Failed to initialize telemetry client:", error);
    }
  } else {
    log.info("Telemetry disabled (user preference)");
  }

  // Track app.started event
  client?.track("app.started");

  // Track heartbeat every 5 minutes
  const heartbeatTimer = client
    ? setInterval(() => {
        client?.track("app.heartbeat", {
          uptimeMs: client.getUptime(),
        });
      }, 5 * 60 * 1000)
    : null;

  return { client, heartbeatTimer };
}
