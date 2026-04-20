import type { Storage } from "@rivonclaw/storage";
import { createLogger } from "@rivonclaw/logger";

const log = createLogger("boot-migrations");

/**
 * One-shot, idempotent migrations that run during Desktop startup.
 *
 * Each migration is tagged with `introduced` (the app version that first
 * shipped it) and `removeAfter` (the earliest version where it is safe to
 * delete). When a customer has upgraded past `removeAfter`, their data is
 * guaranteed already migrated and the code can be dropped.
 *
 * Migrations are split into phases because they have different dependency
 * requirements (filesystem vs storage vs gateway config). Each phase runs
 * at a specific point in `main.ts` startup — see call sites there.
 *
 * ── Registry ────────────────────────────────────────────────────────────
 *
 * │ #  │ Name                          │ Phase        │ Introduced │ Remove after │
 * │────│───────────────────────────────│──────────────│────────────│──────────────│
 * │ 1  │ migrateFromEasyClaw           │ preStorage   │ v1.7.0     │ v1.9.0       │
 * │ 2  │ migrateWeixinAccountKeys      │ postConfig   │ v1.7.14    │ v1.9.0       │
 * │ 3  │ backfillOwnerMigration        │ postInit     │ v1.6.0     │ v1.8.0       │
 *
 * When removing a migration:
 *   1. Delete the corresponding `runXxxPhase` body entry below.
 *   2. Delete the migration's source file under `../auth/` or `../channels/`.
 *   3. Remove the row from this registry table.
 *   4. If a phase function becomes empty, remove the phase entirely + its
 *      call site in main.ts.
 */

// ── Phase A: pre-storage ────────────────────────────────────────────────
// Runs BEFORE `createStorage()` so filesystem-level moves/renames finish
// before SQLite is opened from the old location.
export async function runPreStorageMigrations(): Promise<void> {
  // [1] v1.7.0 · remove after v1.9.0
  // Rebrand EasyClaw → RivonClaw: moves ~/.easyclaw → ~/.rivonclaw and
  // rewrites keychain service names. Idempotent via a marker file.
  const { migrateFromEasyClaw } = await import("../auth/rebrand-migration.js");
  await migrateFromEasyClaw();

  log.debug("pre-storage migrations complete");
}

// ── Phase B: post-config ────────────────────────────────────────────────
// Runs AFTER `ensureGatewayConfig()` returns `configPath`, but BEFORE the
// first `writeGatewayConfig` so the gateway reads the migrated file.
export async function runPostConfigMigrations(configPath: string): Promise<void> {
  // [2] v1.7.14 · remove after v1.9.0
  // Canonicalize WeChat account keys in openclaw.json from the plugin's
  // raw `xxx@im.bot` form to the canonical dash form `xxx-im-bot`. Paired
  // with SQLite migration 27 (packages/storage) which does the same for
  // `channel_accounts`. See `normalizeWeixinAccountId` in @rivonclaw/core.
  // Idempotent — no-op once all keys are canonical.
  const { migrateWeixinAccountKeys } = await import("../channels/weixin-account-id-migration.js");
  migrateWeixinAccountKeys(configPath);

  log.debug("post-config migrations complete");
}

// ── Phase C: post-init ──────────────────────────────────────────────────
// Runs AFTER storage, stateDir, and configPath are all available (i.e.
// after channel-manager init). Operates on both SQLite rows and openclaw.json.
export async function runPostInitMigrations(
  storage: Storage,
  stateDir: string,
  configPath: string,
): Promise<void> {
  // [3] v1.6.0 · remove after v1.8.0
  // Backfill `channel_recipients` owner rows from pre-existing allowFrom
  // files (pairing channels introduced owners via SQLite only after v1.6.0).
  // Also syncs `commands.ownerAllowFrom` in openclaw.json for gateway-side
  // command gating. Idempotent via ensureExists + is_owner guard.
  const { backfillOwnerMigration } = await import("../auth/owner-migration.js");
  await backfillOwnerMigration(storage, stateDir, configPath);

  log.debug("post-init migrations complete");
}
