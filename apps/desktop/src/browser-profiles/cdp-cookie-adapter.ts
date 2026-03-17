import { createLogger } from "@rivonclaw/logger";
import type { BrowserCookie, BrowserSessionAdapter } from "./session-state/index.js";
import { fetchDebuggerUrl, sendCdpCommand } from "./cdp-transport.js";

const log = createLogger("cdp-cookie-adapter");

/**
 * Map a CDP cookie sameSite value to our BrowserCookie sameSite type.
 * CDP returns "Strict", "Lax", "None" — which matches our interface directly.
 */
function mapSameSite(value?: string): "Strict" | "Lax" | "None" | undefined {
  if (value === "Strict" || value === "Lax" || value === "None") return value;
  return undefined;
}

/**
 * CdpCookieAdapter — BrowserSessionAdapter backed by Chrome DevTools Protocol.
 *
 * Connects to Chrome's CDP endpoint on the given port to get/set cookies.
 * Each operation opens a fresh WebSocket connection and closes it after the
 * command completes — no persistent connection is maintained.
 *
 * When Chrome is not running or the CDP port is unreachable:
 * - getCookies returns []
 * - setCookies is a no-op with a warning log
 */
export class CdpCookieAdapter implements BrowserSessionAdapter {
  private readonly port: number;

  constructor(port: number) {
    this.port = port;
  }

  async getCookies(): Promise<BrowserCookie[]> {
    const wsUrl = await fetchDebuggerUrl(this.port);
    if (!wsUrl) {
      log.warn(`getCookies: Chrome CDP not reachable on port ${this.port}`);
      return [];
    }

    try {
      const result = await sendCdpCommand(wsUrl, "Network.getAllCookies") as {
        cookies?: Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires: number;
          httpOnly: boolean;
          secure: boolean;
          sameSite?: string;
        }>;
      };

      return (result?.cookies ?? []).map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: mapSameSite(c.sameSite),
      }));
    } catch (err) {
      log.warn(`getCookies failed (returning []):`, err);
      return [];
    }
  }

  async setCookies(cookies: BrowserCookie[]): Promise<void> {
    if (cookies.length === 0) return;

    const wsUrl = await fetchDebuggerUrl(this.port);
    if (!wsUrl) {
      log.warn(`setCookies: Chrome CDP not reachable on port ${this.port}`);
      return;
    }

    try {
      await sendCdpCommand(wsUrl, "Network.setCookies", {
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
      });
    } catch (err) {
      log.warn(`setCookies failed (non-fatal):`, err);
    }
  }

  async replaceCookies(cookies: BrowserCookie[]): Promise<void> {
    const wsUrl = await fetchDebuggerUrl(this.port);
    if (!wsUrl) {
      log.warn(`replaceCookies: Chrome CDP not reachable on port ${this.port}`);
      return;
    }

    try {
      // Step 1: Get all existing cookies
      const result = await sendCdpCommand(wsUrl, "Network.getAllCookies") as {
        cookies?: Array<{ name: string; domain: string; path: string }>;
      };
      const existing = result?.cookies ?? [];

      // Step 2: Delete all existing cookies
      for (const c of existing) {
        await sendCdpCommand(wsUrl, "Network.deleteCookies", {
          name: c.name,
          domain: c.domain,
          path: c.path,
        });
      }

      // Step 3: Set snapshot cookies
      if (cookies.length > 0) {
        await sendCdpCommand(wsUrl, "Network.setCookies", {
          cookies: cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite,
          })),
        });
      }

      log.info(`replaceCookies: deleted ${existing.length} existing, set ${cookies.length} from snapshot`);
    } catch (err) {
      log.warn(`replaceCookies failed (non-fatal):`, err);
    }
  }
}
