import { createLogger } from "@rivonclaw/logger";
import type { BrowserCookie, BrowserSessionAdapter } from "./session-state/index.js";
import { fetchDebuggerUrl, sendCdpCommand } from "./cdp-transport.js";

const log = createLogger("managed-profile-cookie-adapter");

/**
 * Map a CDP cookie sameSite value to our BrowserCookie sameSite type.
 */
function mapSameSite(value?: string): "Strict" | "Lax" | "None" | undefined {
  if (value === "Strict" || value === "Lax" || value === "None") return value;
  return undefined;
}

/**
 * ManagedProfileCookieAdapter — BrowserSessionAdapter for RivonClaw-managed
 * multi-profile browsers.
 *
 * This is the PRIMARY runtime target. Each managed profile runs its own
 * Chrome instance with a dedicated CDP debugging port. The adapter uses
 * the same CDP wire protocol as CdpCookieAdapter but is semantically
 * distinct: the port belongs to a managed Chrome instance, not the user's
 * default browser.
 *
 * Port resolution:
 * - Takes a `portResolver` function that returns the current CDP port
 *   for this profile. This allows the port to change across browser
 *   restarts without requiring a new adapter instance.
 * - Alternatively takes a static port number for simpler use cases.
 *
 * Graceful degradation (same as CdpCookieAdapter):
 * - getCookies returns [] when the managed browser is unreachable
 * - setCookies is a no-op with a warning log
 */
export class ManagedProfileCookieAdapter implements BrowserSessionAdapter {
  private readonly profileId: string;
  private readonly resolvePort: () => number | null;

  constructor(profileId: string, portOrResolver: number | (() => number | null)) {
    this.profileId = profileId;
    this.resolvePort = typeof portOrResolver === "number"
      ? () => portOrResolver
      : portOrResolver;
  }

  async getCookies(): Promise<BrowserCookie[]> {
    const port = this.resolvePort();
    if (port === null) {
      log.warn(`[${this.profileId}] getCookies: no CDP port available`);
      return [];
    }

    const wsUrl = await fetchDebuggerUrl(port);
    if (!wsUrl) {
      log.warn(`[${this.profileId}] getCookies: managed browser CDP not reachable on port ${port}`);
      return [];
    }

    try {
      const result = await sendCdpCommand(wsUrl, "Network.getAllCookies") as {
        cookies?: Array<{
          name: string; value: string; domain: string; path: string;
          expires: number; httpOnly: boolean; secure: boolean; sameSite?: string;
        }>;
      };

      return (result?.cookies ?? []).map((c) => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path,
        expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
        sameSite: mapSameSite(c.sameSite),
      }));
    } catch (err) {
      log.warn(`[${this.profileId}] getCookies failed (returning []):`, err);
      return [];
    }
  }

  async setCookies(cookies: BrowserCookie[]): Promise<void> {
    if (cookies.length === 0) return;

    const port = this.resolvePort();
    if (port === null) {
      log.warn(`[${this.profileId}] setCookies: no CDP port available`);
      return;
    }

    const wsUrl = await fetchDebuggerUrl(port);
    if (!wsUrl) {
      log.warn(`[${this.profileId}] setCookies: managed browser CDP not reachable on port ${port}`);
      return;
    }

    try {
      await sendCdpCommand(wsUrl, "Network.setCookies", {
        cookies: cookies.map((c) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
          sameSite: c.sameSite,
        })),
      });
    } catch (err) {
      log.warn(`[${this.profileId}] setCookies failed (non-fatal):`, err);
    }
  }

  async replaceCookies(cookies: BrowserCookie[]): Promise<void> {
    const port = this.resolvePort();
    if (port === null) {
      log.warn(`[${this.profileId}] replaceCookies: no CDP port available`);
      return;
    }

    const wsUrl = await fetchDebuggerUrl(port);
    if (!wsUrl) {
      log.warn(`[${this.profileId}] replaceCookies: managed browser CDP not reachable on port ${port}`);
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
            name: c.name, value: c.value, domain: c.domain, path: c.path,
            expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
            sameSite: c.sameSite,
          })),
        });
      }

      log.info(`[${this.profileId}] replaceCookies: deleted ${existing.length} existing, set ${cookies.length} from snapshot`);
    } catch (err) {
      log.warn(`[${this.profileId}] replaceCookies failed (non-fatal):`, err);
    }
  }
}
