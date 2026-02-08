# @easyclaw/telemetry

Privacy-first telemetry client SDK for the EasyClaw desktop application.

## Features

- **Batch Upload**: Automatically batches events (10 events or 30 seconds, whichever comes first)
- **Retry Logic**: Exponential backoff retry on network failures (3 attempts: 1s, 2s, 4s)
- **In-Memory Queue**: Efficient event queuing before flush
- **Runtime Tracking**: Track application start time and uptime
- **Privacy-First**: No PII collection, user opt-in required
- **Graceful Shutdown**: Flush pending events before exit

## Installation

```bash
pnpm add @easyclaw/telemetry
```

## Quick Start

```typescript
import { RemoteTelemetryClient } from "@easyclaw/telemetry";

// Initialize the client
const client = new RemoteTelemetryClient({
  endpoint: "https://telemetry.easyclaw.com/api/telemetry/",
  enabled: true,
  version: "0.1.0",
  platform: process.platform,
  userId: "optional-anonymous-id",
  batchSize: 10, // optional, default: 10
  flushInterval: 30000, // optional, default: 30000ms (30s)
});

// Track events
client.track("app.started", { version: "0.1.0", platform: "darwin" });
client.track("rule.created", { artifactType: "policy" });
client.track("app.error", { errorMessage: "Network timeout" });

// Gracefully shutdown (flushes pending events)
await client.shutdown();
```

## API Reference

### `RemoteTelemetryClient`

#### Constructor

```typescript
new RemoteTelemetryClient(config: TelemetryConfig)
```

Creates a new telemetry client instance.

**Parameters:**

- `config.endpoint` (string, required): Remote endpoint URL for telemetry data
- `config.enabled` (boolean, required): Whether telemetry is enabled
- `config.version` (string, required): Application version
- `config.platform` (string, required): Platform identifier (e.g., "darwin", "win32")
- `config.userId` (string, optional): Anonymous user identifier
- `config.batchSize` (number, optional): Events to batch before auto-flush (default: 10)
- `config.flushInterval` (number, optional): Milliseconds between auto-flush (default: 30000)

#### Methods

##### `track(eventType: string, metadata?: object): void`

Queue an event for batch upload.

**Parameters:**

- `eventType`: Event type identifier (e.g., "app.started")
- `metadata`: Optional event-specific metadata (no PII)

**Example:**

```typescript
client.track("gateway.restarted");
client.track("channel.configured", { channelType: "telegram" });
```

##### `flush(): Promise<void>`

Immediately send all queued events to the remote endpoint. Uses exponential backoff retry logic.

**Example:**

```typescript
await client.flush();
```

##### `shutdown(): Promise<void>`

Gracefully shutdown the client by stopping the auto-flush timer and flushing pending events.

**Example:**

```typescript
await client.shutdown();
```

##### `getUptime(): number`

Get the current application uptime in milliseconds.

**Returns:** Milliseconds since client instantiation

##### `getSessionId(): string`

Get the unique session ID for this app run.

**Returns:** UUID string

##### `getQueueSize(): number`

Get the current number of queued events.

**Returns:** Number of events in queue

## Event Types

The following event types are supported:

| Event Type | Description | Metadata |
|------------|-------------|----------|
| `app.started` | Application started | `{ version, platform }` |
| `app.stopped` | Application stopped | `{ runtimeMs }` |
| `app.heartbeat` | Periodic heartbeat | `{ uptime }` |
| `gateway.restarted` | Gateway process restarted | - |
| `rule.created` | New rule created | `{ artifactType }` |
| `channel.configured` | Channel configured | `{ channelType }` |
| `app.error` | Application error | `{ errorMessage, errorStack }` |

## Usage Examples

### Desktop Application Integration

```typescript
import { RemoteTelemetryClient } from "@easyclaw/telemetry";
import { app } from "electron";

let telemetryClient: RemoteTelemetryClient | null = null;

// Initialize on app ready
app.on("ready", () => {
  const telemetryEnabled = getUserTelemetryPreference(); // from storage

  if (telemetryEnabled) {
    telemetryClient = new RemoteTelemetryClient({
      endpoint: "https://telemetry.easyclaw.com/api/telemetry/",
      enabled: true,
      version: app.getVersion(),
      platform: process.platform,
      userId: getAnonymousUserId(), // optional
    });

    telemetryClient.track("app.started", {
      version: app.getVersion(),
      platform: process.platform,
    });
  }
});

// Track heartbeat every 5 minutes
setInterval(() => {
  if (telemetryClient) {
    telemetryClient.track("app.heartbeat", {
      uptime: telemetryClient.getUptime(),
    });
  }
}, 5 * 60 * 1000);

// Graceful shutdown
app.on("will-quit", async () => {
  if (telemetryClient) {
    telemetryClient.track("app.stopped", {
      runtimeMs: telemetryClient.getUptime(),
    });
    await telemetryClient.shutdown();
  }
});

// Error tracking
process.on("uncaughtException", (error) => {
  if (telemetryClient) {
    telemetryClient.track("app.error", {
      errorMessage: error.message,
      errorStack: error.stack?.split("\n").slice(0, 5).join("\n"),
    });
  }
});
```

### Custom Event Tracking

```typescript
// Track rule creation
function onRuleCreated(rule: Rule) {
  telemetryClient?.track("rule.created", {
    artifactType: rule.artifactType,
  });
}

// Track channel configuration
function onChannelConfigured(channelType: string) {
  telemetryClient?.track("channel.configured", {
    channelType,
  });
}

// Track gateway restart
function onGatewayRestarted() {
  telemetryClient?.track("gateway.restarted");
}
```

### Testing with Mock Endpoint

```typescript
import { RemoteTelemetryClient } from "@easyclaw/telemetry";

// For testing, you can use a mock endpoint
const client = new RemoteTelemetryClient({
  endpoint: "http://localhost:8080/mock/telemetry",
  enabled: true,
  version: "0.1.0-test",
  platform: "darwin",
});

client.track("test.event", { test: true });
await client.flush();
```

## Privacy Guarantees

This telemetry client is designed with privacy as a top priority:

1. **User Opt-In Required**: Telemetry is disabled by default (`enabled: false`)
2. **No PII Collection**: Never collects personally identifiable information
3. **No Conversation Content**: Never sends chat messages or rule text
4. **No API Keys**: Never sends API keys or secrets
5. **Anonymous User ID**: Optional anonymous identifier (e.g., SHA256 hash of MAC address)
6. **Transparent**: All tracked events are documented

## Data Collected

Only the following data is collected when telemetry is enabled:

- Event type (e.g., "app.started")
- Timestamp (ISO 8601)
- Session ID (UUID, unique per app run)
- Application version
- Platform (OS type: darwin, win32, linux)
- Event-specific metadata (no PII)

## Testing

Run the test suite:

```bash
pnpm test
```

This package includes 10+ comprehensive unit tests covering:

- Event queuing and batching
- Auto-flush timer
- Retry logic with exponential backoff
- Queue management
- Session ID generation
- Graceful shutdown
- Event structure validation

## Build

Build the package:

```bash
pnpm build
```

This generates ESM output with TypeScript declarations in the `dist/` directory.

## License

MIT
