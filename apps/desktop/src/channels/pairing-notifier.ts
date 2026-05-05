import { promises as fs } from "node:fs";
import { watch } from "node:fs";
import { join } from "node:path";
import { resolveCredentialsDir } from "@rivonclaw/core/node";
import { createLogger } from "@rivonclaw/logger";
import { proxiedFetch } from "../infra/api/route-utils.js";
import { sendChannelMessage } from "./channel-senders.js";

const log = createLogger("pairing-notifier");

interface PairingStore {
  version: number;
  requests: Array<{ id: string; code: string; createdAt: string; lastSeenAt: string; meta?: Record<string, string> }>;
}

/** Detect system locale: "zh" for Chinese systems, "en" for everything else. */
function getSystemLocale(): "zh" | "en" {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

const PAIRING_MESSAGES = {
  zh: [
    "💡 [RivonClaw] 您的配对请求已收到。",
    "",
    "请前往管理面板 → 通道，展开对应通道账号并点击「批准」完成配对。",
  ].join("\n"),
  en: [
    "💡 [RivonClaw] Your pairing request has been received.",
    "",
    "Please go to the panel → Channels, expand the matching channel account, and click \"Approve\".",
  ].join("\n"),
};

/**
 * Watch the credentials directory for new pairing requests and send
 * follow-up messages to the corresponding channels.
 */
export function startPairingNotifier(
  proxyRouterPort: number,
  pushSSE: (event: string, data: unknown) => void,
): { stop: () => void } {
  const credentialsDir = resolveCredentialsDir();
  const knownCodes = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function initKnownCodes() {
    try {
      const files = await fs.readdir(credentialsDir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith("-pairing.json")) continue;
        try {
          const content = await fs.readFile(join(credentialsDir, file), "utf-8");
          const data = JSON.parse(content) as PairingStore;
          if (Array.isArray(data.requests)) {
            for (const req of data.requests) {
              if (req.code) knownCodes.add(req.code);
            }
          }
        } catch { /* per-file errors */ }
      }
    } catch { /* directory may not exist */ }
  }

  async function checkForNewRequests() {
    try {
      const files = await fs.readdir(credentialsDir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith("-pairing.json")) continue;
        const channelId = file.replace("-pairing.json", "");

        const content = await fs.readFile(join(credentialsDir, file), "utf-8").catch(() => "");
        if (!content) continue;

        const data = JSON.parse(content) as PairingStore;
        if (!Array.isArray(data.requests)) continue;

        for (const req of data.requests) {
          if (!req.code || knownCodes.has(req.code)) continue;
          knownCodes.add(req.code);

          const message = PAIRING_MESSAGES[getSystemLocale()];
          log.info(`Sending pairing follow-up to ${channelId} user ${req.id}`);
          const boundFetch = (url: string | URL, init?: RequestInit) => proxiedFetch(proxyRouterPort, url, init);
          sendChannelMessage(channelId, req.id, message, boundFetch);
          // Shared SSE event name with gateway event-dispatcher's
          // `rivonclaw.recipient-seen` path. Payload `{ channelId }` stays
          // identical to what was sent under the old "pairing-update" name so
          // the Panel can subscribe once and refresh on both signals.
          pushSSE("recipient-added", { channelId });
        }
      }
    } catch (err) {
      log.error("Pairing notifier check failed:", err);
    }
  }

  initKnownCodes();

  let watcher: ReturnType<typeof watch> | null = null;
  try {
    fs.mkdir(credentialsDir, { recursive: true }).then(() => {
      try {
        watcher = watch(credentialsDir, (_eventType, filename) => {
          if (!filename?.endsWith("-pairing.json")) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(checkForNewRequests, 500);
        });
        log.info("Pairing notifier watching:", credentialsDir);
      } catch (err) {
        log.error("Failed to start pairing file watcher:", err);
      }
    });
  } catch (err) {
    log.error("Failed to create credentials directory:", err);
  }

  return {
    stop: () => {
      if (watcher) watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}
