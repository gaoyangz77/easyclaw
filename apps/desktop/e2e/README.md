# EasyClaw E2E Testing

End-to-end integration tests for the EasyClaw Electron desktop app, powered by [Playwright](https://playwright.dev/docs/api/class-electron).

## Architecture

```
e2e/
├── playwright.config.ts   # Playwright config (timeouts, workers, reporter)
├── electron-fixture.ts    # Custom fixtures — `test` (returning user) & `freshTest` (fresh user)
├── global-setup.ts        # Loads e2e/.env, kills stale EasyClaw processes
├── smoke.spec.ts          # Returning-user smoke tests (uses `test` fixture)
├── onboarding.spec.ts     # Fresh-user onboarding tests (uses `freshTest` fixture)
├── .env                   # API keys for testing (gitignored)
├── package.json           # { "type": "commonjs" } override for Playwright compatibility
└── README.md              # This file
```

## Data Isolation

Each test runs with a **fresh, isolated temp directory**. Three env vars redirect all persistent state:

| Env Var | Points to | Isolates |
|---------|-----------|----------|
| `EASYCLAW_DB_PATH` | `<tempdir>/db.sqlite` | SQLite database |
| `EASYCLAW_SECRETS_DIR` | `<tempdir>/secrets/` | API keys (bypasses macOS Keychain) |
| `OPENCLAW_STATE_DIR` | `<tempdir>/openclaw/` | Gateway state files |

The temp directory is deleted after each test via `rmSync`, ensuring tests are **idempotent**.

## Two Fixtures, Two User Flows

| Fixture | Import | Simulates | Entry Point |
|---------|--------|-----------|-------------|
| `test` | `import { test } from "./electron-fixture.js"` | Returning user (has a provider key) | Main page with sidebar |
| `freshTest` | `import { freshTest as test } from "./electron-fixture.js"` | Brand-new user (empty database) | Onboarding page |

**Returning user (`test`)**: Seeds a Volcengine provider key via the gateway REST API (`POST /api/provider-keys` + `PUT /api/settings`), then reloads. If `E2E_VOLCENGINE_API_KEY` is not set, falls back to clicking "Skip setup" so basic smoke tests still work without real API keys.

**Fresh user (`freshTest`)**: Launches with an empty database so the app shows the onboarding page. Requires `E2E_ZHIPU_API_KEY` for the full onboarding test (otherwise that test is skipped).

## Test Suites

### `onboarding.spec.ts` — Fresh User Onboarding (2 tests)

Uses the `freshTest` fixture (empty database, lands on onboarding page).

| # | Test | Steps | Requires API Key |
|---|------|-------|-----------------|
| 1 | Fresh user completes onboarding with GLM API key | Switch to API tab -> Select "Zhipu (GLM) - China" -> Select "GLM-4.7-Flash" -> Fill API key -> Click "Save & Continue" -> Wait for "All Set" page -> Click "Go to Dashboard" -> Verify sidebar loads | `E2E_ZHIPU_API_KEY` |
| 2 | Fresh user can skip onboarding | Click "Skip setup" -> Verify sidebar loads | No |

### `smoke.spec.ts` — Returning User Smoke Tests (6 tests)

Uses the `test` fixture (pre-seeded Volcengine key, lands on main page).

| # | Test | Steps | Requires API Key |
|---|------|-------|-----------------|
| 1 | App launches and window is visible | Verify 1 window exists -> Check title is "EasyClaw" | No |
| 2 | Panel renders with sidebar navigation | Verify `.sidebar-brand-text` visible -> Verify >= 5 nav buttons | No |
| 3 | Chat page is default and gateway connects | Verify first nav has `nav-active` -> Wait for `.chat-status-dot-connected` -> Verify stable for 3s | No |
| 4 | LLM Providers page: dropdowns and pricing | Dismiss modals -> Navigate to LLM Providers -> Verify Subscription tab active -> Open provider dropdown (2-3 options) -> Verify pricing card -> Switch to API tab -> Open provider dropdown (10-18 options) -> Verify pricing table | No |
| 5 | Add second key and switch active provider | Dismiss modals -> Navigate to LLM Providers -> Verify 1 active volcengine key -> Add GLM key via form (API tab, Zhipu, GLM-4.7-Flash) -> Verify 2 keys (volcengine active, zhipu inactive) -> Click "Activate" on zhipu -> Verify zhipu active, volcengine inactive | `E2E_ZHIPU_API_KEY` + `E2E_VOLCENGINE_API_KEY` |
| 6 | Window has correct web preferences | Verify `nodeIntegration: false` and `contextIsolation: true` | No |

## API Keys

Tests that interact with real LLM providers require API keys. Place them in `e2e/.env` (gitignored):

```
E2E_ZHIPU_API_KEY=your-zhipu-key-here
E2E_VOLCENGINE_API_KEY=your-volcengine-key-here
```

`global-setup.ts` auto-loads this file before tests. CLI env vars take priority over `.env` values.

**Without API keys**: 6 tests pass, 2 are skipped (onboarding completion + key management).

## Dev vs Prod Modes

The same test suite runs against **two modes**:

| Mode | What it launches | When to use |
|------|-----------------|-------------|
| **Dev** | `node_modules/.../Electron` + `dist/main.cjs` | Before packaging — validates compiled code |
| **Prod** | Packaged `EasyClaw.app` or `EasyClaw.exe` | After packaging — validates the installer build |

## Prerequisites

1. **Build all packages** (from repo root):
   ```bash
   pnpm run build
   ```

2. **Dependencies** are already declared in `apps/desktop/package.json`:
   - `@playwright/test` — test runner
   - `playwright` — core library with `_electron` API

   No browser download is needed. Playwright talks to Electron directly via CDP.

## Running Tests

All commands run from `apps/desktop/`.

### Dev mode (before packaging)

```bash
pnpm run test:e2e:dev
```

### Prod mode (after packaging)

```bash
# Step 1: Package the app
pnpm run pack

# Step 2: Run tests against the packaged binary
# macOS (arm64):
E2E_EXECUTABLE_PATH=release/mac-arm64/EasyClaw.app/Contents/MacOS/EasyClaw \
  pnpm run test:e2e:prod

# macOS (universal/x64):
E2E_EXECUTABLE_PATH=release/mac/EasyClaw.app/Contents/MacOS/EasyClaw \
  pnpm run test:e2e:prod

# Windows:
E2E_EXECUTABLE_PATH=release/win-unpacked/EasyClaw.exe \
  pnpm run test:e2e:prod
```

### Full release pipeline

Both dev and prod E2E are included in `scripts/release-local.sh`. See the script header for the full 9-step pipeline and available flags (`--skip-tests`, `--skip-upload`, `--upload-only`).

## Writing New Tests

### Choosing a fixture

- **`test`** (from `electron-fixture.js`) — for tests that need the main page with a pre-seeded provider. Import as: `import { test, expect } from "./electron-fixture.js"`
- **`freshTest`** (from `electron-fixture.js`) — for tests that need the onboarding page. Import as: `import { freshTest as test, expect } from "./electron-fixture.js"`

### Basic structure

```typescript
import { test, expect } from "./electron-fixture.js";

test("description of what you're testing", async ({ window }) => {
  // `window` is a Playwright Page — use locators and assertions
  const element = window.locator(".some-css-class");
  await expect(element).toBeVisible();
});
```

### Available fixtures

| Fixture | Type | Use for |
|---------|------|---------|
| `window` | `Page` | UI interactions — click, type, assert elements |
| `electronApp` | `ElectronApplication` | Main process — evaluate BrowserWindow, app APIs |

### Tips

- **Workers = 1**: The app enforces a single-instance lock, so tests run serially. Don't try to parallelize.
- **Timeout = 60s per test**: The gateway takes a few seconds to start. If you add tests that trigger slow operations, increase the timeout with `test.setTimeout(90_000)`.
- **Modals**: Prod builds may show modals (What's New, telemetry consent) that block clicks. Dismiss them before interacting:
  ```typescript
  for (let i = 0; i < 3; i++) {
    const backdrop = window.locator(".modal-backdrop");
    if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  }
  ```
- **CSS selectors**: Use class names from `apps/panel/src/styles.css` and `apps/panel/src/layout/Layout.tsx`. Key selectors:
  - `.sidebar-brand`, `.sidebar-brand-text` — brand/logo area
  - `.nav-list .nav-btn` — navigation buttons
  - `.nav-active` — currently active nav button
  - `.section-card` — content cards on pages
  - `.modal-backdrop` — modal overlay
  - `.key-card`, `.key-card-active`, `.key-card-inactive` — provider key cards
  - `.provider-select-trigger`, `.provider-select-option` — provider dropdown
  - `.custom-select-trigger`, `.custom-select-option` — model dropdown
  - `.tab-btn`, `.tab-btn-active` — tab buttons
  - `.pricing-card`, `.pricing-inner-table` — pricing display

## Troubleshooting

### "Process failed to launch!"

Check if `ELECTRON_RUN_AS_NODE` is set in your terminal:
```bash
echo $ELECTRON_RUN_AS_NODE
```
If it's `1`, unset it before running tests:
```bash
ELECTRON_RUN_AS_NODE= pnpm run test:e2e:dev
```
The fixture already strips this variable, but the Playwright runner itself may be affected if it's set in the parent shell.

### Tests hang or time out at "waiting for .sidebar-brand"

The gateway process failed to start, so the panel never loads. Check:
- Is another EasyClaw instance already running? (`pkill -x EasyClaw`)
- Are vendor dependencies present? (`ls vendor/openclaw/openclaw.mjs`)
- Run `pnpm run dev` manually to see if the app starts at all.

### "No EasyClaw.app found" in prod mode

Run `pnpm run pack` first. The packaged app is written to `release/`. The directory name depends on your architecture (e.g., `mac-arm64`, `mac`, `win-unpacked`).
