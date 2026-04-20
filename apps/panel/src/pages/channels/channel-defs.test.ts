// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { ChannelsStatusSnapshot, ChannelAccountSnapshot } from "../../api/index.js";
import { buildAccountsList, type MstChannelAccountLike } from "./channel-defs.jsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const t = (key: string) => key;

function mst(overrides: Partial<MstChannelAccountLike> = {}): MstChannelAccountLike {
  return {
    channelId: "telegram",
    accountId: "acct-1",
    name: "Prod Bot",
    config: {},
    ...overrides,
  };
}

function snapshot(
  channelAccounts: Record<string, ChannelAccountSnapshot[]> = {},
  overrides: Partial<ChannelsStatusSnapshot> = {},
): ChannelsStatusSnapshot {
  return {
    ts: 1700000000000,
    channelOrder: [],
    channelLabels: {},
    channels: {},
    channelAccounts,
    channelDefaultAccountId: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAccountsList — MST-authoritative with snapshot overlay", () => {
  it("merges MST identity with runtime overlay when both are present", () => {
    const result = buildAccountsList(
      [mst({ channelId: "telegram", accountId: "a1", name: "Prod Bot", config: { dmPolicy: "auto" } })],
      snapshot({
        telegram: [{
          accountId: "a1",
          name: "Stale Name From Gateway",
          configured: true,
          enabled: true,
          running: true,
          tokenSource: "keychain",
          mode: "polling",
        }],
      }),
      t,
    );

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.channelId).toBe("telegram");
    // MST identity wins
    expect(entry.account.accountId).toBe("a1");
    expect(entry.account.name).toBe("Prod Bot");
    // Runtime overlay wins on status fields
    expect(entry.account.configured).toBe(true);
    expect(entry.account.enabled).toBe(true);
    expect(entry.account.running).toBe(true);
    expect(entry.account.tokenSource).toBe("keychain");
    expect(entry.account.mode).toBe("polling");
    // Config-derived fallback applied because runtime didn't have dmPolicy
    expect(entry.account.dmPolicy).toBe("auto");
  });

  it("uses conservative defaults when snapshot is null", () => {
    const result = buildAccountsList(
      [mst({ channelId: "telegram", accountId: "a1", name: "Prod Bot", config: { dmPolicy: "manual" } })],
      null,
      t,
    );

    expect(result).toHaveLength(1);
    const { account } = result[0]!;
    expect(account.accountId).toBe("a1");
    expect(account.name).toBe("Prod Bot");
    expect(account.configured).toBe(true);
    expect(account.enabled).toBe(true);
    // Running status is unknown without runtime data — NOT optimistically true
    expect(account.running).toBeNull();
    expect(account.dmPolicy).toBe("manual");
  });

  it("uses conservative defaults when snapshot exists but is missing the channel", () => {
    const result = buildAccountsList(
      [mst({ channelId: "feishu", accountId: "a1" })],
      snapshot({ telegram: [] }),
      t,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.account.running).toBeNull();
    expect(result[0]!.account.configured).toBe(true);
  });

  it("uses conservative defaults when snapshot has the channel but not the accountId", () => {
    const result = buildAccountsList(
      [mst({ channelId: "telegram", accountId: "a1" })],
      snapshot({
        telegram: [{
          accountId: "OTHER",
          configured: true,
          running: true,
        }],
      }),
      t,
    );

    // Our MST account (a1) gets conservative defaults, not the runtime status of OTHER
    expect(result).toHaveLength(1);
    expect(result[0]!.account.accountId).toBe("a1");
    expect(result[0]!.account.running).toBeNull();
  });

  it("MST name wins when snapshot has a different name for the same account", () => {
    const result = buildAccountsList(
      [mst({ channelId: "telegram", accountId: "a1", name: "Correct Name" })],
      snapshot({
        telegram: [{
          accountId: "a1",
          name: "Wrong Name",
          running: true,
        }],
      }),
      t,
    );

    expect(result[0]!.account.name).toBe("Correct Name");
  });

  it("respects enabled=false from MST config when snapshot is missing", () => {
    const result = buildAccountsList(
      [mst({ config: { enabled: false } })],
      null,
      t,
    );

    expect(result[0]!.account.enabled).toBe(false);
  });

  it("returns mobile entries from snapshot when MST is empty (mobile exception)", () => {
    const result = buildAccountsList(
      [],
      snapshot({
        mobile: [{
          accountId: "pair-123",
          name: "iPhone 15",
          configured: true,
          running: true,
        }],
      }),
      t,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.channelId).toBe("mobile");
    expect(result[0]!.account.accountId).toBe("pair-123");
    expect(result[0]!.account.running).toBe(true);
  });

  it("does NOT return non-mobile snapshot entries when MST is empty (key bug fix)", () => {
    // The original bug: WeChat ghost accounts showed up when gateway had them
    // but Desktop SQLite/MST did not. With MST as source of truth, those must
    // be filtered out entirely.
    const result = buildAccountsList(
      [],
      snapshot({
        weixin: [{
          accountId: "ghost",
          name: "Ghost WeChat",
          configured: true,
          running: true,
        }],
        telegram: [{
          accountId: "ghost2",
          configured: true,
          running: true,
        }],
      }),
      t,
    );

    expect(result).toHaveLength(0);
  });

  it("filters out synthetic-default mobile entries", () => {
    const result = buildAccountsList(
      [],
      snapshot({
        mobile: [
          {
            accountId: "default",
            name: null,
            configured: false,
            tokenSource: "none",
          },
          {
            accountId: "real-pair",
            name: "Real Device",
            configured: true,
            running: true,
          },
        ],
      }),
      t,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.account.accountId).toBe("real-pair");
  });

  it("surfaces multiple MST accounts across different channels", () => {
    const result = buildAccountsList(
      [
        mst({ channelId: "telegram", accountId: "tg-1", name: "TG One" }),
        mst({ channelId: "telegram", accountId: "tg-2", name: "TG Two" }),
        mst({ channelId: "feishu", accountId: "fs-1", name: "FS One" }),
      ],
      snapshot({
        telegram: [
          { accountId: "tg-1", running: true },
          { accountId: "tg-2", running: false },
        ],
        feishu: [{ accountId: "fs-1", running: true }],
      }),
      t,
    );

    expect(result).toHaveLength(3);
    const byAccount = new Map(result.map(r => [r.account.accountId, r]));
    expect(byAccount.get("tg-1")?.account.running).toBe(true);
    expect(byAccount.get("tg-2")?.account.running).toBe(false);
    expect(byAccount.get("fs-1")?.account.running).toBe(true);
  });

  it("combines MST accounts and mobile snapshot entries in one list", () => {
    const result = buildAccountsList(
      [mst({ channelId: "telegram", accountId: "tg-1" })],
      snapshot({
        telegram: [{ accountId: "tg-1", running: true }],
        mobile: [{ accountId: "pair-1", running: true }],
      }),
      t,
    );

    expect(result).toHaveLength(2);
    const channels = result.map(r => r.channelId).sort();
    expect(channels).toEqual(["mobile", "telegram"]);
  });

  it("falls back to snapshot.channelLabels for unknown channels", () => {
    const result = buildAccountsList(
      [mst({ channelId: "custom-channel", accountId: "a1" })],
      snapshot({ "custom-channel": [{ accountId: "a1" }] }, {
        channelLabels: { "custom-channel": "Custom Channel Label" },
      }),
      t,
    );

    expect(result[0]!.channelLabel).toBe("Custom Channel Label");
  });

  it("uses i18n label from KNOWN_CHANNELS for known channels", () => {
    const result = buildAccountsList(
      [mst({ channelId: "telegram", accountId: "a1" })],
      null,
      t,
    );

    // Our test `t` returns the key, and KNOWN_CHANNELS has an entry for telegram
    expect(result[0]!.channelLabel).toMatch(/^channels?\./);
  });
});
