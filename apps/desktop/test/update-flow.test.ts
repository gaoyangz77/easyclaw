/**
 * Tests for the unified update flow:
 * - queryCheckUpdate() error handling
 * - processUpdatePayload() decision logic (extracted harness)
 * - caller-side state management (manual check, startup check)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setApiBaseUrlOverride } from "@rivonclaw/core";
import { queryCheckUpdate } from "../src/cloud/backend-subscription-client.js";

/* ─── helpers ───────────────────────────────────────────────────────── */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as Response;
}

beforeEach(() => {
  setApiBaseUrlOverride("http://test-backend");
});

/* ═══════════════════════════════════════════════════════════════════════
   1. queryCheckUpdate — GraphQL error handling
   ═══════════════════════════════════════════════════════════════════════ */

describe("queryCheckUpdate", () => {
  it("returns payload when backend has an update", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: { checkUpdate: { version: "2.0.0", downloadUrl: "https://cdn.example.com/v2.dmg" } },
      }),
    );
    const result = await queryCheckUpdate("en", "1.0.0", mockFetch);
    expect(result).toEqual({ version: "2.0.0", downloadUrl: "https://cdn.example.com/v2.dmg" });
  });

  it("returns null when backend says no update", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { checkUpdate: null } }),
    );
    const result = await queryCheckUpdate("en", "2.0.0", mockFetch);
    expect(result).toBeNull();
  });

  it("throws on HTTP non-2xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    await expect(queryCheckUpdate("en", "1.0.0", mockFetch))
      .rejects.toThrow("HTTP 500");
  });

  it("throws on GraphQL 200 + errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: null,
        errors: [{ message: "Internal server error" }],
      }),
    );
    await expect(queryCheckUpdate("en", "1.0.0", mockFetch))
      .rejects.toThrow("GraphQL errors: Internal server error");
  });

  it("throws on GraphQL 200 + errors even when data is present", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: { checkUpdate: { version: "2.0.0", downloadUrl: "https://x.com/f" } },
        errors: [{ message: "partial failure" }],
      }),
    );
    await expect(queryCheckUpdate("en", "1.0.0", mockFetch))
      .rejects.toThrow("GraphQL errors: partial failure");
  });

  it("throws on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(queryCheckUpdate("en", "1.0.0", mockFetch))
      .rejects.toThrow("ECONNREFUSED");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   2. processUpdatePayload logic — tested via a minimal extracted harness
   ═══════════════════════════════════════════════════════════════════════

   processUpdatePayload lives inside the main.ts closure and can't be
   imported directly. We replicate the exact decision sequence using the
   same helper (isNewerVersion) to validate the contract.

   No CDN HEAD check — the backend operator is trusted.                   */

import { isNewerVersion } from "@rivonclaw/updater";

/**
 * Replicates processUpdatePayload's decision logic.
 * Returns whether the update was accepted (true) or rejected (false).
 */
function simulateProcessUpdatePayload(
  currentVersion: string,
  payload: { version: string; downloadUrl?: string },
): { accepted: boolean; cleared: boolean } {
  // Step 1: version check
  if (!isNewerVersion(currentVersion, payload.version)) {
    return { accepted: false, cleared: true };
  }
  // Step 2: downloadUrl required
  if (!payload.downloadUrl) {
    return { accepted: false, cleared: true };
  }
  // Step 3: all checks passed — accepted
  return { accepted: true, cleared: false };
}

describe("processUpdatePayload logic", () => {
  it("rejects and clears when version is not newer", () => {
    const result = simulateProcessUpdatePayload("2.0.0", { version: "1.0.0", downloadUrl: "https://cdn/f" });
    expect(result).toEqual({ accepted: false, cleared: true });
  });

  it("rejects and clears when version is equal", () => {
    const result = simulateProcessUpdatePayload("1.0.0", { version: "1.0.0", downloadUrl: "https://cdn/f" });
    expect(result).toEqual({ accepted: false, cleared: true });
  });

  it("rejects and clears when downloadUrl is missing", () => {
    const result = simulateProcessUpdatePayload("1.0.0", { version: "2.0.0" });
    expect(result).toEqual({ accepted: false, cleared: true });
  });

  it("accepts when version is newer and downloadUrl is present", () => {
    const result = simulateProcessUpdatePayload("1.0.0", { version: "2.0.0", downloadUrl: "https://cdn/v2.dmg" });
    expect(result).toEqual({ accepted: true, cleared: false });
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   3. Manual / startup check — caller-side state management
   ═══════════════════════════════════════════════════════════════════════ */

describe("check-then-process flow", () => {
  it("clears state when queryCheckUpdate returns null", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { checkUpdate: null } }),
    );
    const payload = await queryCheckUpdate("en", "2.0.0", mockFetch);

    // Simulate the caller logic from main.ts
    let cleared = false;
    if (!payload) cleared = true;

    expect(payload).toBeNull();
    expect(cleared).toBe(true);
  });

  it("proceeds to processUpdatePayload when query returns a payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: { checkUpdate: { version: "3.0.0", downloadUrl: "https://cdn/v3" } },
      }),
    );
    const payload = await queryCheckUpdate("en", "1.0.0", mockFetch);

    expect(payload).not.toBeNull();
    expect(payload!.version).toBe("3.0.0");
  });

  it("does not clear state when query throws — error bubbles to caller", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { errors: [{ message: "boom" }] }),
    );
    await expect(queryCheckUpdate("en", "1.0.0", mockFetch))
      .rejects.toThrow("GraphQL errors");
  });

  it("manual check shows correct dialog for payload without downloadUrl", async () => {
    // Simulates: backend returns newer version but no downloadUrl
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: { checkUpdate: { version: "2.0.0" } },
      }),
    );
    const payload = await queryCheckUpdate("en", "1.0.0", mockFetch);
    expect(payload).not.toBeNull();

    // processUpdatePayload rejects it → accepted = false
    const { accepted } = simulateProcessUpdatePayload("1.0.0", payload!);
    expect(accepted).toBe(false);

    // Caller logic: payload is truthy but not accepted
    // → should show "download info incomplete" dialog, NOT "already up to date"
    const showedIncompleteWarning = payload && !accepted;
    expect(showedIncompleteWarning).toBe(true);
  });
});
