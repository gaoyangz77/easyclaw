# EasyClaw File Permissions Plugin

OpenClaw plugin that enforces file access permissions via the `before_tool_call` hook.

## Overview

This plugin intercepts tool calls before execution and validates file paths against the `EASYCLAW_FILE_PERMISSIONS` environment variable. It blocks unauthorized file access operations while allowing permitted paths.

## Architecture

**Design Principle**: Do NOT modify OpenClaw source code.

Instead, we use OpenClaw's built-in plugin system:
- **Hook**: `before_tool_call` - executes before any tool call
- **Hook Signature**: Receives `{ toolName, params }`, returns `{ block?: boolean, blockReason?: string }`
- **Integration**: Loaded via `openclaw.json` → `plugins.load.paths`

This approach preserves the ability to pull upstream OpenClaw updates cleanly.

## Monitored Tools

The plugin validates file paths for these tools:
- `read`, `write`, `edit` - validate `path` and `file_path` parameters
- `exec`, `process` - validate `cwd` parameter
- `apply-patch`, `image` - validate `path` and `out` parameters

## Environment Variable Format

```bash
EASYCLAW_FILE_PERMISSIONS='read:/path1:/path2,write:/path3:/path4'
```

- Format: `mode:path1:path2,...`
- Modes: `read` (read-only access), `write` (read-write access)
- Paths: Absolute paths, tilde `~` expanded to home directory
- Write permissions imply read permissions

## Usage

### Automatic Integration (Recommended)

The gateway package automatically loads this plugin when `enableFilePermissions: true`:

```typescript
import { writeGatewayConfig } from "@easyclaw/gateway";

writeGatewayConfig({
  enableFilePermissions: true, // Automatically adds plugin to load paths
});
```

### Manual Integration

Add to `openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["path/to/file-permissions/dist/index.mjs"]
    },
    "entries": {
      "easyclaw-file-permissions": {
        "enabled": true
      }
    }
  }
}
```

## Development

```bash
# Install dependencies
pnpm install

# Build plugin
pnpm build

# Run tests
pnpm test
```

## Testing

The plugin includes comprehensive unit tests covering:
- Permission parsing from environment variable
- Path validation (read/write modes, nested paths, tilde expansion)
- File path extraction from tool parameters
- Hook behavior (blocking vs allowing)

Run tests with: `pnpm test:run`

## License

MIT
