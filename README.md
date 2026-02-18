<p align="center">
  <img src="assets/LOGO_EN_COMPACT.png" width="400" alt="EasyClaw">
</p>

<p align="center">
  English | <a href="README.zh-CN.md">中文</a>
</p>

## Why EasyClaw?

[OpenClaw](https://github.com/openclaw/openclaw) is a powerful agent runtime — but it's built for engineers. Setting it up means editing config files, managing processes, and juggling API keys from the terminal. For non-programmers (designers, operators, small business owners), that barrier is too high.

EasyClaw wraps OpenClaw into a desktop app that **anyone can use**: install, launch from the system tray, and manage everything through a local web panel. Write rules in plain language instead of code, configure LLM providers and messaging channels with a few clicks, and let the agent learn your preferences over time. No terminal required.

**In short:** OpenClaw is the engine; EasyClaw is the cockpit.

## Features

- **Natural Language Rules**: Write rules in plain language—they compile to policy, guards, or skills and take effect immediately (no restart)
- **Multi-Provider LLM Support**: 17+ providers (OpenAI, Anthropic, Google Gemini, DeepSeek, Zhipu/Z.ai, Moonshot, Qwen, Groq, Mistral, xAI, OpenRouter, MiniMax, Venice AI, Xiaomi, Volcengine/Doubao, Amazon Bedrock, etc.) with multi-key management and region-aware defaults
- **Gemini CLI OAuth**: Sign in with Google for free-tier Gemini access—no API key needed. Auto-detects or installs Gemini CLI credentials
- **Per-Provider Proxy Support**: Configure HTTP/SOCKS5 proxies per LLM provider or API key, with automatic routing and hot reload—essential for restricted regions
- **WeChat Messaging (WeCom)**: Chat with your agent from WeChat via a WeCom Customer Service relay. Open-source relay server included (`apps/wecom-relay`)
- **Multi-Account Channels**: Configure Telegram, Discord, Slack, WhatsApp, DingTalk, and more through UI with secure secret storage (Keychain/DPAPI)
- **Token Usage Tracking**: Real-time statistics by model and provider, auto-refreshed from OpenClaw session files
- **Speech-to-Text**: Region-aware STT integration for voice messages (Groq, Volcengine)
- **Visual Permissions**: Control file read/write access through UI
- **Zero-Restart Updates**: API key, proxy, and channel changes apply instantly via hot reload—no gateway restart needed
- **Local-First & Private**: All data stays on your machine; secrets never stored in plaintext
- **Auto-Update**: Client update checker with static manifest hosting
- **Privacy-First Telemetry**: Optional anonymous usage analytics—no PII collected

### How File Permissions Work

EasyClaw enforces file access permissions through an OpenClaw plugin that intercepts tool calls *before* they execute. Here's what's protected:

- **File access tools** (`read`, `write`, `edit`, `image`, `apply-patch`): Fully protected—paths are validated against your configured permissions
- **Command execution** (`exec`, `process`): Working directory is validated, but paths *inside* command strings (like `cat /etc/passwd`) cannot be inspected

**Coverage**: ~85-90% of file access scenarios. For maximum security, consider restricting or disabling `exec` tools through Rules.

**Technical note**: The file permissions plugin uses OpenClaw's `before_tool_call` hook—no vendor source code modifications needed, so EasyClaw can cleanly pull upstream OpenClaw updates.

## Prerequisites

| Tool    | Version    |
| ------- | ---------- |
| Node.js | >= 24      |
| pnpm    | 10.6.2     |

## Quick Start

```bash
# 1. Clone and build the vendored OpenClaw runtime
./scripts/setup-vendor.sh

# 2. Install workspace dependencies and build
pnpm install
pnpm build

# 3. Launch in dev mode
pnpm --filter @easyclaw/desktop dev
```

This starts the Electron tray app, which spawns the OpenClaw gateway and serves the management panel at `http://localhost:3210`.

## Repository Structure

```
easyclaw/
├── apps/
│   ├── desktop/          # Electron tray app (main process)
│   ├── panel/            # React management UI (served by desktop)
│   └── wecom-relay/      # WeCom Customer Service relay server (self-hosted)
├── packages/
│   ├── core/             # Shared types & Zod schemas
│   ├── device-id/        # Machine fingerprinting for device identity
│   ├── gateway/          # Gateway lifecycle, config writer, secret injection, OAuth flows
│   ├── logger/           # Structured logging (tslog)
│   ├── storage/          # SQLite persistence (better-sqlite3)
│   ├── rules/            # Rule compilation & skill file writer
│   ├── secrets/          # Keychain / DPAPI / file-based secret stores
│   ├── updater/          # Auto-update client
│   ├── stt/              # Speech-to-text abstraction (Groq, Volcengine)
│   ├── proxy-router/     # HTTP CONNECT proxy multiplexer for restricted regions
│   ├── telemetry/        # Privacy-first anonymous analytics client
│   └── policy/           # Policy injector & guard evaluator logic
├── extensions/
│   ├── dingtalk/         # DingTalk channel integration
│   ├── easyclaw-policy/  # OpenClaw plugin shell for policy injection
│   ├── file-permissions/ # OpenClaw plugin for file access control
│   └── wecom/            # WeCom channel plugin (runs inside gateway)
├── scripts/
│   ├── release-local.sh  # Local release pipeline (build, test, upload)
│   └── rebuild-native.sh # Prebuild better-sqlite3 for Node.js + Electron
├── vendor/
│   └── openclaw/         # Vendored OpenClaw binary (gitignored)
└── website/              # Static site + nginx/docker for hosting releases
```

## Workspaces

The monorepo uses pnpm workspaces (`apps/*`, `packages/*`, `extensions/*`) with [Turbo](https://turbo.build) for build orchestration. All packages produce ESM output via [tsdown](https://github.com/nicolo-ribaudo/tsdown).

### Apps

| Package                  | Description                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `@easyclaw/desktop`      | Electron 35 tray app. Manages gateway lifecycle, hosts the panel server on port 3210, stores data in SQLite.           |
| `@easyclaw/panel`        | React 19 + Vite 6 SPA. Pages for rules, providers, channels, permissions, usage, and a first-launch onboarding wizard. |
| `@easyclaw/wecom-relay`  | WeCom Customer Service relay server. Bridges WeChat users to the gateway via WebSocket. Deploy with Docker.            |

### Extensions

| Package              | Description                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@easyclaw/wecom`            | WeCom channel plugin. Connects to the relay server via WebSocket, receives/sends messages, and registers as an OpenClaw channel. |
| `@easyclaw/dingtalk`         | DingTalk channel integration (placeholder).                                                                                    |
| `@easyclaw/easyclaw-policy`  | Thin OpenClaw plugin shell that wires policy injection into the gateway's `before_agent_start` hook.                           |
| `@easyclaw/file-permissions` | OpenClaw plugin that enforces file access permissions by intercepting and validating tool calls before execution.               |

### Packages

| Package                            | Description                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@easyclaw/core`                   | Zod-validated types: `Rule`, `ChannelConfig`, `PermissionConfig`, `ModelConfig`, LLM provider definitions (OpenAI, Anthropic, Google Gemini, DeepSeek, Zhipu, Moonshot, Qwen, and more), region-aware defaults. |
| `@easyclaw/gateway`                | `GatewayLauncher` (spawn/stop/restart with exponential backoff), config writer, secret injection from system keychain, Gemini CLI OAuth flow, auth profile sync, skills directory watcher for hot reload. |
| `@easyclaw/logger`                 | tslog-based logger. Writes to `~/.easyclaw/logs/`.                                                                                                                                                  |
| `@easyclaw/storage`                | SQLite via better-sqlite3. Repositories for rules, artifacts, channels, permissions, settings. Migration system included. DB at `~/.easyclaw/easyclaw.db`.                                          |
| `@easyclaw/rules`                  | Rule compilation, skill lifecycle (activate/deactivate), skill file writer that materializes rules as SKILL.md files for OpenClaw.                                                                  |
| `@easyclaw/secrets`                | Platform-aware secret storage. macOS Keychain, file-based fallback, in-memory for tests.                                                                                                            |
| `@easyclaw/updater`                | Checks `update-manifest.json` on the website, notifies user of new versions.                                                                                                                        |
| `@easyclaw/device-id`              | Machine fingerprinting (SHA-256 of hardware UUID) for device identity and quota enforcement.                                                                                                        |
| `@easyclaw/stt`                    | Speech-to-text provider abstraction (Groq for international, Volcengine for China).                                                                                                                 |
| `@easyclaw/proxy-router`           | HTTP CONNECT proxy that routes requests to different upstream proxies based on per-provider domain configuration.                                                                                    |
| `@easyclaw/telemetry`              | Privacy-first telemetry client with batch uploads and retry logic; no PII collected.                                                                                                                |
| `@easyclaw/policy`                 | Policy injector & guard evaluator — compiles policies into prompt fragments and guards into enforcement checks.                                                                                     |

## Scripts

Most root scripts run through Turbo:

```bash
pnpm build        # Build all packages (respects dependency graph)
pnpm dev          # Run desktop + panel in dev mode
pnpm test         # Run all tests (vitest)
pnpm lint         # Lint all packages (oxlint)
pnpm format       # Check formatting (oxfmt, runs directly)
pnpm format:fix   # Auto-fix formatting (oxfmt, runs directly)
```

### Per-package

```bash
# Desktop
pnpm --filter @easyclaw/desktop dev        # Launch Electron in dev mode
pnpm --filter @easyclaw/desktop build      # Bundle main process
pnpm --filter @easyclaw/desktop test       # Run desktop tests
pnpm --filter @easyclaw/desktop dist:mac   # Build macOS DMG (universal)
pnpm --filter @easyclaw/desktop dist:win   # Build Windows NSIS installer

# Panel
pnpm --filter @easyclaw/panel dev          # Vite dev server
pnpm --filter @easyclaw/panel build        # Production build

# Any package
pnpm --filter @easyclaw/core test
pnpm --filter @easyclaw/gateway test
```

## Architecture

```
┌─────────────────────────────────────────┐
│  System Tray (Electron main process)    │
│  ├── GatewayLauncher → vendor/openclaw  │
│  ├── Panel HTTP Server (:3210)          │
│  │   ├── Static files (panel dist/)     │
│  │   └── REST API (/api/*)              │
│  ├── SQLite Storage                     │
│  ├── Auth Profile Sync                  │
│  └── Auto-Updater                       │
└─────────────────────────────────────────┘
         │                    ▲
         ▼                    │
┌─────────────┐    ┌─────────────────┐
│  OpenClaw   │    │  Panel (React)  │
│  Gateway    │    │  localhost:3210  │
│  Process    │    └─────────────────┘
└─────────────┘
         │ (extensions/wecom plugin via WebSocket)
         ▼
┌──────────────────────┐      ┌────────────┐
│  WeCom Relay Server  │◄─────│  WeChat    │
│  (apps/wecom-relay)  │      │  Users     │
└──────────────────────┘      └────────────┘
```

The desktop app runs as a **tray-only** application (hidden from the dock on macOS). It:

1. Spawns the OpenClaw gateway from `vendor/openclaw/`
2. Serves the panel UI and REST API on `localhost:3210`
3. Writes gateway config and auth profiles to `~/.openclaw/`
4. Injects secrets (API keys + OAuth tokens) from the system keychain at runtime
5. Watches `~/.openclaw/skills/` for hot-reload of rule-generated skill files
6. Syncs refreshed OAuth tokens back to keychain on shutdown

### REST API

The panel server exposes these endpoints:

| Endpoint             | Methods                | Description                               |
| -------------------- | ---------------------- | ----------------------------------------- |
| `/api/rules`         | GET, POST, PUT, DELETE | CRUD for rules                            |
| `/api/channels`      | GET, POST, PUT, DELETE | Channel management                        |
| `/api/permissions`   | GET, POST, PUT, DELETE | Permission management                     |
| `/api/settings`      | GET, PUT               | Key-value settings store                  |
| `/api/providers`     | GET                    | Available LLM providers                   |
| `/api/provider-keys` | GET, POST, PUT, DELETE | API key and OAuth credential management   |
| `/api/oauth`         | POST                   | Gemini CLI OAuth flow (acquire/save)      |
| `/api/status`        | GET                    | System status (rule count, gateway state) |

### Data Directories

| Path                             | Purpose                    |
| -------------------------------- | -------------------------- |
| `~/.easyclaw/easyclaw.db`        | SQLite database            |
| `~/.easyclaw/logs/`              | Application logs           |
| `~/.openclaw/`                   | OpenClaw state directory   |
| `~/.openclaw/gateway/config.yml` | Gateway configuration      |
| `~/.openclaw/sessions/`          | WhatsApp sessions          |
| `~/.openclaw/skills/`            | Auto-generated skill files |

## Building Installers

The `dist:mac` and `dist:win` scripts automatically prune `vendor/openclaw/node_modules` to production-only dependencies before packaging. This reduces the DMG from ~360MB to ~270MB.

**After building**, vendor node_modules will be pruned. To restore full deps for development:

```bash
cd vendor/openclaw && CI=true pnpm install --no-frozen-lockfile && cd ../..
```

### macOS (DMG, universal arm64+x64)

```bash
pnpm build
pnpm --filter @easyclaw/desktop dist:mac
# Output: apps/desktop/release/EasyClaw-<version>-universal.dmg
```

For code signing and notarization, set these environment variables:

```bash
CSC_LINK=<path-to-.p12-certificate>
CSC_KEY_PASSWORD=<certificate-password>
APPLE_ID=<your-apple-id>
APPLE_APP_SPECIFIC_PASSWORD=<app-specific-password>
APPLE_TEAM_ID=<team-id>
```

### Windows (NSIS installer, x64)

```bash
pnpm build
pnpm --filter @easyclaw/desktop dist:win
# Output: apps/desktop/release/EasyClaw Setup <version>.exe
```

Cross-compiling from macOS works (NSIS doesn't need Wine). For code signing on Windows, set:

```bash
CSC_LINK=<path-to-.pfx-certificate>
CSC_KEY_PASSWORD=<certificate-password>
```

### Local Release

The `scripts/release-local.sh` script handles the full pipeline:

```bash
./scripts/release-local.sh 1.2.8            # full pipeline
./scripts/release-local.sh --skip-tests      # build + upload only
./scripts/release-local.sh --skip-upload     # build + test, no upload
```

This will:

1. Prebuild native modules for Node.js + Electron
2. Build all workspace packages
3. Run unit tests and E2E tests (dev + prod)
4. Build macOS DMG/ZIP or Windows NSIS installer
5. Upload artifacts to a draft GitHub Release

## Note: better-sqlite3 native module

`desktop dev` auto-rebuilds better-sqlite3 for Electron's Node ABI. This means **tests may fail afterwards** with a `NODE_MODULE_VERSION` mismatch. Fix with:

```bash
pnpm install   # restores the system-Node prebuilt binary
```

## Testing

Tests use [Vitest](https://vitest.dev/). Run all tests:

```bash
pnpm test
```

Run tests for a specific package:

```bash
pnpm --filter @easyclaw/storage test
pnpm --filter @easyclaw/gateway test
```

## Code Style

- **Linting**: [oxlint](https://oxc-project.github.io/) (Rust-based, fast)
- **Formatting**: [oxfmt](https://oxc-project.github.io/) (Rust-based, fast)
- **TypeScript**: Strict mode, ES2023 target, NodeNext module resolution

```bash
pnpm lint
pnpm format       # Check
pnpm format:fix   # Auto-fix
```

## Website & Deployment

The `website/` directory contains the static product site hosted at `www.easy-claw.com`:

```
website/
├── site/           # Static HTML/CSS/JS (i18n: EN/ZH/JA)
│   ├── index.html
│   ├── style.css
│   ├── i18n.js
│   ├── update-manifest.json
│   └── releases/   # Installer binaries (gitignored)
├── nginx/          # nginx config (HTTPS, redirect, caching)
├── docker-compose.yml
└── init-letsencrypt.sh
```

On the production server:

```bash
cd website
./init-letsencrypt.sh   # First-time SSL setup
docker compose up -d    # Start nginx + certbot
```

## License

See [LICENSE](LICENSE) for details.
