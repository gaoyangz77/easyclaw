# Scripts

## Build & Release

### rebuild-native.sh

Builds `better-sqlite3` for both Node.js and Electron, enabling both runtimes to coexist.

Node.js and Electron have different ABIs (e.g. Node.js v24 = ABI 141, Electron 35 = ABI 143). A binary compiled for one crashes when loaded by the other. This script compiles `better-sqlite3` twice and places each binary in an ABI-specific directory under `lib/binding/`. It then deletes `build/` so the `bindings` package auto-selects the correct binary at runtime.

**When it runs:**
- Automatically after `pnpm install` via the root `postinstall` hook
- Manually: `./scripts/rebuild-native.sh` (or `--force` to skip the "already exists" check)

**Rules:**
- Do NOT run `electron-rebuild` manually — it creates `build/` and breaks Node.js tests
- Do NOT delete `lib/binding/` — it contains the dual prebuilds
- If unit tests fail with ABI mismatch errors, run `./scripts/rebuild-native.sh`

### setup-vendor.sh

Clones and builds `vendor/openclaw` from the commit pinned in `.openclaw-version`. Used by the README quick start, CI workflows, and `provision-vendor.sh`.

```bash
./scripts/setup-vendor.sh          # dev build (full deps)
./scripts/setup-vendor.sh --prod   # prod build (production deps only)
```

### test-local.sh

Full local test pipeline: install, build, unit tests, E2E tests (dev + prod), and pack.

```bash
./scripts/test-local.sh 1.5.8          # full pipeline with version
./scripts/test-local.sh --skip-tests   # build + pack only
```

Steps: `pnpm install` → vendor check → `rebuild-native.sh` → `pnpm build` → `pnpm test` → E2E dev → `electron-builder --dir` → `rebuild-native.sh` → E2E prod.

### publish-release.sh

Promotes a draft GitHub Release (created by CI) to a public release. Run after CI build and local tests pass.

```bash
./scripts/publish-release.sh           # reads version from apps/desktop/package.json
./scripts/publish-release.sh 1.5.8     # explicit version
```

Requires: `gh` CLI authenticated, draft release exists on GitHub.

## Verification & Auditing

### audit-provider-sync.mjs

Audits provider/model sync between EasyClaw and vendor. Compares the pi-ai vendor catalog, OpenClaw's `resolveImplicitProviders`, and EasyClaw's `ALL_PROVIDERS` to detect invisible providers or new upstream additions. Used by the `update-vendor` skill (Step 7).

```bash
node scripts/audit-provider-sync.mjs   # exit 0 = no gaps, exit 1 = critical gaps
```

### verify-proxy-domains.mjs

Verifies that `DOMAIN_TO_PROVIDER` in `apps/desktop/src/main.ts` includes all domains from `PROVIDER_BASE_URLS` in `packages/core/src/models.ts`. Exposed as `pnpm verify-proxy`.

```bash
pnpm verify-proxy   # exit 0 = all present, exit 1 = missing domains
```

## Developer Utilities

### reset-user-data.sh

Wipes all EasyClaw + OpenClaw user data to simulate fresh onboarding. Cleans SQLite DB, gateway state, logs, workspace, subagents, canvas, and macOS Keychain entries.

```bash
./scripts/reset-user-data.sh           # interactive (asks for confirmation)
./scripts/reset-user-data.sh --force   # skip confirmation
```

### test-proxy.mjs

Starts a local HTTP CONNECT proxy server for testing proxy-router functionality. Hardcoded test credentials (`testuser`/`testpass`). Referenced in ADR-015.

```bash
node scripts/test-proxy.mjs [port]     # default port: 8888
```

### test-proxy-auth.mjs

Tests authenticated proxy connections against the test proxy started by `test-proxy.mjs`. Verifies both valid and invalid credential handling.

```bash
node scripts/test-proxy-auth.mjs
```

### test-vector-integration.sh

Integration test for Vector telemetry pipeline. Sends test events to Vector and verifies they appear in ClickHouse. Requires `docker compose up -d clickhouse vector` in `server/`.

```bash
./scripts/test-vector-integration.sh
```
