/**
 * Customer Service Bridge
 *
 * Thin integration layer between the `@easyclaw/customer-service` module and
 * the desktop application.  It:
 *  - Creates a CustomerServiceModule instance
 *  - Wires the onInboundMessage callback to forward messages to the gateway agent
 *  - Stores/loads config from SQLite storage
 *  - Exposes functions for panel-server to call
 */

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";
import type { CustomerServiceConfig, CustomerServiceStatus } from "@easyclaw/core";
import { GatewayRpcClient, resolveOpenClawStateDir } from "@easyclaw/gateway";
import { createCustomerServiceModule, buildCustomerServicePrompt } from "@easyclaw/customer-service";
import type { CustomerServiceModule } from "@easyclaw/customer-service";

const log = createLogger("cs-bridge");

// Hardcoded relay connection (our own server — must match CS_RELAY_AUTH_SECRET on server)
const CS_RELAY_URL = "ws://49.235.178.19:3003";
const CS_RELAY_AUTH_TOKEN = "easyclaw-cs-relay-secret-2024";

// Session key prefix for customer service agent calls (separate from main chat).
// Each customer gets their own session so the LLM maintains per-customer context.
const CS_SESSION_PREFIX = "agent:main:cs";

let csModule: CustomerServiceModule | null = null;
let csGatewayRpc: GatewayRpcClient | null = null;
let csConfig: CustomerServiceConfig | null = null;

// Map runId → { resolve, reject } for pending agent responses
const pendingReplies = new Map<string, {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// References set during initialization
let storageRef: Storage | null = null;
let secretStoreRef: SecretStore | null = null;
let getGatewayInfoRef: (() => { wsUrl: string; token?: string }) | null = null;
let deviceIdRef: string | null = null;

/**
 * Initialize the bridge with external dependencies.
 * Must be called once during panel-server startup.
 */
export function initCSBridge(deps: {
  storage: Storage;
  secretStore: SecretStore;
  getGatewayInfo?: () => { wsUrl: string; token?: string };
  deviceId?: string;
}): void {
  storageRef = deps.storage;
  secretStoreRef = deps.secretStore;
  getGatewayInfoRef = deps.getGatewayInfo ?? null;
  deviceIdRef = deps.deviceId ?? null;
}

/**
 * Handle a gateway 'chat' event for customer service.
 * Extracts the AI reply and resolves the pending promise.
 */
function handleCSChatEvent(payload: unknown): void {
  const p = payload as Record<string, unknown> | null;
  if (!p) return;

  const runId = p.runId as string | undefined;
  if (!runId || !pendingReplies.has(runId)) return;

  if (p.state === "error") {
    const pending = pendingReplies.get(runId)!;
    pendingReplies.delete(runId);
    clearTimeout(pending.timer);
    const errorMsg = (p.errorMessage as string) ?? "An error occurred";
    log.warn(`CS: agent error for runId ${runId}: ${errorMsg}`);
    pending.resolve(`Error: ${errorMsg}`);
    return;
  }

  if (p.state !== "final") return;

  const pending = pendingReplies.get(runId)!;
  pendingReplies.delete(runId);
  clearTimeout(pending.timer);

  const message = p.message as Record<string, unknown> | undefined;
  const content = message?.content;

  // Collect raw text from content blocks (same pattern as WeCom handler)
  const texts: string[] = [];
  if (Array.isArray(content)) {
    for (const c of content) {
      const block = c as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text as string);
      }
    }
  }

  const replyText = texts.join("\n\n").replace(/\bNO_REPLY\b/g, "").trim();
  pending.resolve(replyText || "");
}

/**
 * Forward an inbound customer message to the gateway agent and wait for the reply.
 */
async function forwardToAgent(
  platform: string,
  customerId: string,
  msgType: string,
  content: string,
  _mediaData?: string,
  _mediaMime?: string,
): Promise<string> {
  if (!csGatewayRpc || !csGatewayRpc.isConnected()) {
    throw new Error("Gateway RPC not connected");
  }

  if (!csModule) {
    throw new Error("Customer service module not started");
  }

  // Build the CS security + business rules prompt.
  // Injected via extraSystemPrompt so OpenClaw's full pipeline (rules, skills,
  // MCP tools, memory) remains active — only adds our CS context on top.
  const csPrompt = buildCustomerServicePrompt(csModule.getBusinessPrompt());

  // Per-customer session key so the LLM maintains separate conversation context
  // for each customer. The key is deterministic: same customer always gets the
  // same session, preserving chat history across reconnects.
  const sessionKey = `${CS_SESSION_PREFIX}:${platform}:${customerId}`;

  const idempotencyKey = randomUUID();
  const message = `[${platform}/${customerId}] ${content}`;

  const result = await csGatewayRpc.request<{ runId?: string }>("agent", {
    sessionKey,
    channel: "customer-service",
    message,
    extraSystemPrompt: csPrompt,
    idempotencyKey,
  });

  if (!result?.runId) {
    throw new Error("Agent request did not return a runId");
  }

  // Wait for the agent reply (via gateway event callback)
  const replyText = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingReplies.delete(result.runId!);
      reject(new Error("Agent reply timeout (60s)"));
    }, 60_000);
    pendingReplies.set(result.runId!, { resolve, reject, timer });
  });

  return replyText;
}

/**
 * Start the customer service module with the given config.
 */
export function startCS(config: {
  businessPrompt: string;
  platforms: string[];
}): void {
  if (!storageRef || !secretStoreRef) {
    throw new Error("CS bridge not initialized");
  }

  // Stop existing module if running
  stopCS();

  const gatewayId = deviceIdRef ?? randomUUID();
  const gwInfo = getGatewayInfoRef?.();

  csConfig = {
    relayUrl: CS_RELAY_URL,
    authToken: CS_RELAY_AUTH_TOKEN,
    gatewayId,
    businessPrompt: config.businessPrompt,
    platforms: config.platforms,
  };

  // Persist config to storage
  storageRef.settings.set("cs-business-prompt", config.businessPrompt);
  storageRef.settings.set("cs-platforms", JSON.stringify(config.platforms));

  // Create a dedicated gateway RPC client for CS
  csGatewayRpc = new GatewayRpcClient({
    url: gwInfo?.wsUrl ?? "ws://127.0.0.1:28789",
    token: gwInfo?.token,
    deviceIdentityPath: join(resolveOpenClawStateDir(), "identity", "device.json"),
    onEvent: (evt) => {
      if (evt.event === "chat") {
        handleCSChatEvent(evt.payload);
      }
    },
  });
  csGatewayRpc.start().catch((err) => {
    log.error("CS: gateway RPC start failed:", err);
  });

  // Create and start the module
  csModule = createCustomerServiceModule({
    onInboundMessage: forwardToAgent,
    onBindingResolved: (platform, customerId) => {
      log.info(`CS: binding resolved — ${platform}/${customerId}`);
    },
  });

  csModule.start(csConfig);
  log.info("CS: started");
}

/**
 * Stop the customer service module.
 */
export function stopCS(): void {
  if (csModule) {
    csModule.stop();
    csModule = null;
  }
  if (csGatewayRpc) {
    csGatewayRpc.stop();
    csGatewayRpc = null;
  }
  // Reject all pending replies
  for (const [runId, pending] of pendingReplies) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Customer service stopped"));
    pendingReplies.delete(runId);
  }
  csConfig = null;
  log.info("CS: stopped");
}

/**
 * Get the current customer service status.
 * Returns null if the module is not running.
 */
export function getCSStatus(): CustomerServiceStatus | null {
  if (!csModule) return null;
  return csModule.getStatus();
}

/**
 * Update the customer service configuration (partial update).
 */
export function updateCSConfig(update: {
  businessPrompt?: string;
  platforms?: string[];
}): void {
  if (!csModule || !csConfig || !storageRef) {
    throw new Error("Customer service not running");
  }

  if (update.businessPrompt !== undefined) {
    csModule.updateBusinessPrompt(update.businessPrompt);
    csConfig.businessPrompt = update.businessPrompt;
    storageRef.settings.set("cs-business-prompt", update.businessPrompt);
  }

  if (update.platforms !== undefined) {
    csConfig.platforms = update.platforms;
    storageRef.settings.set("cs-platforms", JSON.stringify(update.platforms));
  }
}

/**
 * Restore customer service from persisted config on startup.
 * Called during panel-server initialization (fire-and-forget).
 */
export async function restoreCS(): Promise<void> {
  if (!storageRef || !secretStoreRef) return;

  const savedBusinessPrompt = storageRef.settings.get("cs-business-prompt");
  if (savedBusinessPrompt === undefined) return; // Never started before

  let savedPlatforms: string[] = [];
  try {
    const raw = storageRef.settings.get("cs-platforms");
    if (raw) savedPlatforms = JSON.parse(raw);
  } catch {
    // Ignore malformed data
  }

  startCS({
    businessPrompt: savedBusinessPrompt ?? "",
    platforms: savedPlatforms,
  });

  log.info("CS: restored from saved config");
}
