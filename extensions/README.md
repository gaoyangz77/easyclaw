# EasyClaw Extensions

Extensions are OpenClaw plugins that ship with EasyClaw. They are auto-discovered
at runtime — no per-extension wiring needed in config-writer, main.ts, or
electron-builder.yml.

## How Loading Works

EasyClaw points `plugins.load.paths` at the **entire `extensions/` directory**.
OpenClaw's `discoverInDirectory()` scans each subdirectory and discovers plugins via:

1. `package.json` with `openclaw.extensions` field (channel plugins like wecom)
2. `index.ts` / `index.mjs` fallback (hook plugins like search-browser-fallback)
3. `openclaw.plugin.json` manifest validation (subdirs without it are skipped)

### Dev vs Packaged App

| Environment | Extensions Path |
|---|---|
| Dev (monorepo) | `<monorepo-root>/extensions/` — auto-resolved via `pnpm-workspace.yaml` |
| Packaged Electron | `process.resourcesPath + "/extensions"` — bundled by electron-builder |

The `extensionsDir` option in `writeGatewayConfig()` handles both cases.
`electron-builder.yml` copies all extensions into `Contents/Resources/extensions/`.

## Required Files

Every extension **must** have:

- **`openclaw.plugin.json`** — Plugin manifest with at minimum:
  ```json
  {
    "id": "<plugin-id>",
    "configSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    }
  }
  ```
  The `id` and `configSchema` fields are **required** by OpenClaw's manifest
  validator. Without `configSchema`, the gateway will crash on startup.

- **An entry point** — Either:
  - `index.ts` (loaded by jiti at runtime, no build step needed)
  - A built `.mjs` referenced in `package.json` `openclaw.extensions`

## Two Extension Patterns

### Pattern A: Single-file hook plugin (no build step)

For simple plugins that intercept/augment tool calls. Example: `search-browser-fallback/`.

```
my-plugin/
  openclaw.plugin.json    # required manifest
  index.ts                # entry point, loaded by jiti
```

No `package.json`, no build, no `node_modules`. The `.ts` file is transpiled
on-the-fly by OpenClaw's jiti loader.

### Pattern B: Channel plugin (built with tsdown)

For channel integrations with dependencies and build output. Example: `wecom/`.

```
my-channel/
  openclaw.plugin.json    # required manifest
  package.json            # with openclaw.extensions: ["./openclaw-plugin.mjs"]
  openclaw-plugin.mjs     # built entry point
  openclaw-plugin.ts      # source for the entry point
  src/                    # additional source files
  dist/                   # build output
  tsdown.config.ts        # build config
  vitest.config.ts        # test config
```

The `package.json` `openclaw.extensions` array tells OpenClaw which `.mjs` file(s)
to load. The extension must be built (`pnpm build`) before it can be loaded.

## Checklist: Adding a New Extension

1. Create `extensions/<name>/openclaw.plugin.json` with `id` and `configSchema`
2. Create the entry point (`index.ts` for Pattern A, or `openclaw-plugin.ts` + build for Pattern B)
3. If Pattern B, add the package to `pnpm-workspace.yaml` packages list
4. **No changes needed** in:
   - `packages/gateway/src/config-writer.ts`
   - `apps/desktop/src/main.ts`
   - `apps/desktop/electron-builder.yml`
5. Test in dev: start the app, check gateway logs for plugin discovery
6. Test packaged build: verify the extension appears in `Contents/Resources/extensions/`

## What NOT to Put Here

- **Vendor-bundled plugins** (e.g. `google-gemini-cli-auth`) — These ship inside
  `vendor/openclaw/extensions/` and are enabled via `plugins.entries` only
