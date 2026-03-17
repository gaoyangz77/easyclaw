import type { SessionStateRuntimeTarget } from "@rivonclaw/core";
import type { BrowserSessionAdapter } from "./session-state/index.js";
import { CdpCookieAdapter } from "./cdp-cookie-adapter.js";
import { ManagedProfileCookieAdapter } from "./managed-profile-cookie-adapter.js";

/**
 * Context needed to create an adapter for a specific runtime target.
 *
 * Not all fields are required for every target:
 * - `cdp`: requires `cdpPort`
 * - `managed_profile`: requires `profileId` + `cdpPort` (profile-specific)
 */
export interface AdapterContext {
  profileId: string;
  cdpPort?: number;
  cdpPortResolver?: () => number | null;
}

/**
 * Create the correct BrowserSessionAdapter for a given runtime target.
 *
 * Runtime targets:
 * - managed_profile: PRIMARY target — each profile gets its own Chrome instance
 * - cdp: COMPATIBILITY target — user's existing Chrome
 */
export function createAdapter(
  target: SessionStateRuntimeTarget,
  ctx: AdapterContext,
): BrowserSessionAdapter {
  switch (target) {
    case "managed_profile":
      return new ManagedProfileCookieAdapter(
        ctx.profileId,
        ctx.cdpPortResolver ?? ctx.cdpPort ?? (() => null),
      );

    case "cdp":
      if (!ctx.cdpPort) {
        throw new Error("CDP adapter requires cdpPort");
      }
      return new CdpCookieAdapter(ctx.cdpPort);
  }
}
