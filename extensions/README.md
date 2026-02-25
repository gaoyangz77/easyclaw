# EasyClaw Extensions

Extensions are OpenClaw plugins that ship with EasyClaw. They are auto-discovered
at runtime — no per-extension wiring needed in config-writer, main.ts, or
electron-builder.yml.

## Extension Inventory

| Extension | Type | Description |
|-----------|------|-------------|
| `easyclaw-tools` | Hook + Tool | Runtime context injection + `easyclaw`/`providers` tools (ownerOnly) |
| `easyclaw-policy` | Hook | Injects compiled policies and guard directives into system prompt |
| `file-permissions` | Hook | Validates file operations against permission policies |
| `search-browser-fallback` | Hook (single-file) | Falls back to browser search when `web_search` fails |
| `wecom` | Channel | WeCom/WeChat messaging channel integration |

### easyclaw-tools: Tool Status

| Component | Status | Description |
|-----------|--------|-------------|
| `before_prompt_build` hook | Implemented | Prepends EasyClaw runtime context via `prependContext` |
| `easyclaw` tool | Implemented | `status` (runtime info), `help` (available tools + tips) |
| `providers` tool | Implemented | list, add, activate, remove — calls panel-server HTTP API |
| `channels` tool | Placeholder | list, status, configure — will call panel-server API |
| `settings` tool | Placeholder | get, update — will call panel-server API |
| `rules` tool | Placeholder | list, create, update, delete — will call panel-server API |
| `skills` tool | Placeholder | search, install, delete, list — will call panel-server API |

### easyclaw-tools: Why `prependContext` Instead of `systemPrompt` Replacement

The `before_prompt_build` hook's `event.prompt` is the **user's message**, not the
built system prompt. The hook cannot read or modify the existing system prompt —
it can only provide a full replacement via `systemPrompt` or prepend to the user
message via `prependContext`.

Full replacement (`systemPrompt`) would require calling `buildAgentSystemPrompt()`
ourselves with 25+ dynamic parameters (toolNames, workspace, timezone, skills,
context files, sandbox info, etc.) that are not available in the hook context.
This would mean maintaining a copy of the vendor's prompt builder logic.

`prependContext` is the correct approach: the AI sees "do NOT use openclaw CLI"
before it encounters the CLI instructions in the system prompt. The OpenClaw CLI
section remains in the system prompt but is effectively overridden.

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
