import { WebSocket } from "ws";
import { createLogger } from "@rivonclaw/logger";
import { proxyNetwork } from "../infra/proxy/proxy-aware-network.js";
import type { GatewayEventFrame } from "@rivonclaw/gateway";
import {
  type CSHelloFrame,
  type CSBindShopsFrame,
  type CSBindShopsResultFrame,
  type CSShopTakenOverFrame,
  type CSNewMessageFrame,
  type CSNewConversationFrame,
  type CSWSFrame,
} from "@rivonclaw/core";
import { getAuthSession } from "../auth/session-ref.js";
import { getStorageRef } from "../app/storage-ref.js";
import { CustomerServiceSession, type CSShopContext, type Escalation } from "./customer-service-session.js";
import { reaction, toJS } from "mobx";

// Re-export for consumers that imported CSShopContext from this file
export type { CSShopContext } from "./customer-service-session.js";
import { rootStore } from "../app/store/desktop-store.js";
import { runtimeStatusStore } from "../app/store/runtime-status-store.js";
import { normalizePlatform } from "../utils/platform.js";

const log = createLogger("cs-bridge");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomerServiceBridgeOptions {
  relayUrl: string;
  gatewayId: string;
  /** Default RunProfile ID for CS sessions (fallback when shop has no runProfileId). */
  defaultRunProfileId?: string;
}

// ---------------------------------------------------------------------------
// CustomerServiceBridge
// ---------------------------------------------------------------------------

/**
 * Desktop-side bridge that connects to the CS relay WebSocket,
 * receives buyer messages, and dispatches agent runs via the gateway RPC.
 *
 * Platform-agnostic: the bridge resolves the platform from the shop context
 * (looked up by platformShopId) and uses it to build session keys, so adding
 * a new e-commerce platform only requires registering its shop contexts.
 *
 * The bridge is intentionally thin -- it does NOT fetch data from the backend.
 * All shop context is derived reactively from the entity cache, which is
 * populated by Panel's GraphQL requests flowing through Desktop's proxy.
 *
 * On start(), the bridge subscribes to the entity cache. When shops appear
 * or change, it syncs shop contexts and manages the relay connection
 * accordingly. No explicit push of shop contexts is needed.
 */
export class CustomerServiceBridge {
  private ws: WebSocket | null = null;
  private closed = false;
  private authenticated = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** Set to true when the last WebSocket close was code 4003 (auth failure). */
  private lastCloseWasAuthFailure = false;

  /** Ping/pong keepalive — detects silent connection death. */
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private awaitingPong = false;
  private static readonly PING_INTERVAL_MS = 30_000;
  private static readonly PONG_TIMEOUT_MS = 10_000;

  /** Shop context keyed by platformShopId (from webhook). */
  private shopContexts = new Map<string, CSShopContext>();

  /** Long-lived sessions keyed by conversationId. Reused across messages. */
  private sessions = new Map<string, CustomerServiceSession>();

  /** Shops currently bound to other devices (from last cs_bind_shops_result). */
  private bindingConflicts: Array<{ shopId: string; gatewayId: string }> = [];

  /** Pending agent runs keyed by runId, used to auto-forward final text to buyer. */
  private pendingRuns = new Map<string, { shopObjectId: string; conversationId: string }>();

  /**
   * Per-turn text forwarding buffer. Agent events stream `data.text` as the
   * accumulated text for the current turn (resets after each tool call).
   * On each turn boundary (tool-start or lifecycle-end) the buffer is
   * forwarded to the buyer and cleared.
   */
  private turnTextBuffer = new Map<string, string>();

  /**
   * Run IDs for which at least one text delivery was initiated.
   * Added synchronously when `flushTurnText` starts a forward so the chat
   * error handler knows not to send a duplicate fallback.  If the delivery
   * later fails, the `flushTurnText` catch handler sends the fallback itself.
   */
  private forwardedRuns = new Set<string>();

  /** Entity cache subscription unsubscribe function. */
  private cacheUnsubscribe: (() => void) | null = null;

  constructor(private readonly opts: CustomerServiceBridgeOptions) {}

  // -- Public API ------------------------------------------------------------

  async start(): Promise<void> {
    this.closed = false;
    this.reconnectAttempt = 0;
    // Subscribe to entity cache for reactive shop sync
    this.subscribeToCacheChanges();
    // Perform initial sync in case shops are already in cache
    this.syncFromCache();
    // Only connect to relay if we have shop contexts
    if (this.shopContexts.size > 0) {
      await this.connect();
    } else {
      log.info("CS bridge started, waiting for shops to appear in entity cache");
    }
  }

  stop(): void {
    this.closed = true;
    // Unsubscribe from entity cache
    if (this.cacheUnsubscribe) {
      this.cacheUnsubscribe();
      this.cacheUnsubscribe = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPingInterval();
    this.reconnectAttempt = 0;
    this.lastCloseWasAuthFailure = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    runtimeStatusStore.setCsBridgeDisconnected();
    log.info("CS bridge stopped");
  }

  /**
   * Register or update shop context. Called by desktop on startup (for all
   * CS-enabled shops) and when the user modifies businessPrompt in Panel.
   * Also sends a binding frame to the relay for the new/updated shop.
   */
  setShopContext(ctx: CSShopContext): void {
    this.shopContexts.set(ctx.platformShopId, ctx);
    log.info(`Shop context set: platform=${ctx.platformShopId} object=${ctx.objectId}`);
    // Send binding for the newly added/updated shop
    this.sendShopBindings([ctx.platformShopId]);
  }

  /** Remove shop context (shop disconnected/deleted). */
  removeShopContext(platformShopId: string): void {
    this.shopContexts.delete(platformShopId);
  }

  /** Get current binding conflicts (shops bound to other devices). */
  getBindingConflicts(): Array<{ shopId: string; gatewayId: string }> {
    return this.bindingConflicts;
  }

  /** Unbind a shop from this device. */
  unbindShop(shopId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "cs_unbind_shops", shopIds: [shopId] }));
    this.shopContexts.delete(shopId);
  }

  /**
   * Sync shop contexts from entity cache. Reads all cached shops, filters
   * for CS-enabled shops bound to this device, and updates the internal
   * shopContexts map. Also manages relay connection lifecycle:
   * - Connects if shops appeared and relay is not connected
   * - Disconnects if all shops were removed
   */
  syncFromCache(): void {
    const shops = rootStore.shops;
    const deviceId = this.opts.gatewayId;

    // Build the set of shops that should be active
    const activeShopIds = new Set<string>();

    for (const shop of shops) {
      const cs = shop.services?.customerService;
      if (!cs?.enabled) continue;
      if (cs.csDeviceId !== deviceId) continue;
      // The shop MST composes the final prompt locally from its own
      // `platformSystemPrompt` (embedded by the backend on each shop
      // response) and the user-owned `businessPrompt`. A null result means
      // CS is disabled or the shop payload has not arrived yet — skip
      // until it's ready.
      const assembledPrompt = cs.assembledPrompt;
      if (!assembledPrompt) {
        log.info(`Shop ${shop.shopName} (${shop.id}) has no assembledPrompt yet, skipping`);
        continue;
      }

      const platformShopId = shop.platformShopId;
      activeShopIds.add(platformShopId);

      // Check if context needs updating
      const existing = this.shopContexts.get(platformShopId);
      const newCtx: CSShopContext = {
        objectId: shop.id,
        platformShopId,
        shopName: shop.shopName ?? platformShopId,
        platform: normalizePlatform(shop.platform),
        systemPrompt: assembledPrompt,
        csProviderOverride: cs.csProviderOverride ?? undefined,
        csModelOverride: cs.csModelOverride ?? undefined,
        runProfileId: cs.runProfileId ?? undefined,
      };

      if (!existing || !this.shopContextEqual(existing, newCtx)) {
        this.setShopContext(newCtx);
      }
    }

    // Remove shops that are no longer active
    for (const [platformShopId] of this.shopContexts) {
      if (!activeShopIds.has(platformShopId)) {
        log.info(`Shop ${platformShopId} no longer active in cache, removing context`);
        this.removeShopContext(platformShopId);
      }
    }
  }

  /**
   * Handle gateway events forwarded from the RPC client's onEvent callback.
   *
   * Processes two event types:
   * - `agent` events: per-turn text forwarding. On each turn boundary (tool-start
   *   or lifecycle-end), the accumulated-but-unsent text is forwarded to the buyer
   *   as a separate message. This gives the buyer incremental responses instead of
   *   one large blob at run completion.
   * - `chat` events with `state: "final"`: run lifecycle cleanup (pendingRuns,
   *   session active run tracking, abortedRunIds). Text forwarding is handled by
   *   agent events, so the chat handler no longer sends text.
   */
  onGatewayEvent(evt: GatewayEventFrame): void {
    if (evt.event === "agent") {
      this.onAgentEvent(evt);
      return;
    }

    if (evt.event !== "chat") return;

    const payload = evt.payload as {
      runId?: string;
      state?: string;
    } | undefined;
    if (!payload?.runId) return;

    const pending = this.pendingRuns.get(payload.runId);
    if (!pending) return;

    if (payload.state === "final" || payload.state === "error") {
      this.pendingRuns.delete(payload.runId);

      const session = this.sessions.get(pending.conversationId);

      // Clean up aborted run markers
      const wasAborted = session?.abortedRunIds.has(payload.runId);
      if (wasAborted) {
        session!.abortedRunIds.delete(payload.runId);
        log.info(`Run ${payload.runId} was aborted, skipping auto-forward`);
      } else if (payload.state === "error") {
        // Non-aborted error: log only, no fallback — fail fast so issues surface immediately
        if (!this.forwardedRuns.has(payload.runId)) {
          log.warn(`Agent run ${payload.runId} ended with error and no text was forwarded`);
        } else {
          log.warn(`Agent run ${payload.runId} ended with error (text was previously forwarded)`);
        }
      }

      // Safety-net cleanup of turn buffer (normally already flushed by agent events)
      this.turnTextBuffer.delete(payload.runId);
      this.forwardedRuns.delete(payload.runId);

      // Clear session's active run tracking
      if (session) {
        session.onRunCompleted(payload.runId);
      }
    }
  }

  // -- Per-turn agent event handling ------------------------------------------

  /**
   * Process agent-level events for per-turn text forwarding.
   *
   * Agent events carry streaming data: `stream` identifies the sub-stream,
   * and `data` contains stream-specific fields. We watch for:
   * - `assistant` stream: update the accumulated text buffer
   * - `tool` stream with `phase: "start"`: a turn boundary -- flush unsent text
   * - `lifecycle` stream with `phase: "end"`: run completed -- flush remaining text
   * - `lifecycle` stream with `phase: "error"`: run failed -- flush any buffered
   *   text (partial responses still reach the buyer), then clear the buffer
   */
  private onAgentEvent(evt: GatewayEventFrame): void {
    const payload = evt.payload as {
      runId?: string;
      stream?: string;
      data?: Record<string, unknown>;
    } | undefined;
    if (!payload?.runId) return;

    const { runId, stream, data } = payload;
    if (!stream || !data) return;

    // Only process events for CS runs (those in pendingRuns)
    const pending = this.pendingRuns.get(runId);
    if (!pending) return;

    if (stream === "assistant") {
      const text = data.text;
      if (typeof text === "string") {
        this.turnTextBuffer.set(runId, text);
      }
      return;
    }

    if (stream === "tool" && data.phase === "start") {
      this.flushTurnText(runId, pending.conversationId);
      return;
    }

    if (stream === "lifecycle") {
      if (data.phase === "end" || data.phase === "error") {
        // Flush any buffered text before clearing — ensures partial
        // responses reach the buyer even when the run errors out.
        this.flushTurnText(runId, pending.conversationId);
        this.turnTextBuffer.delete(runId);
      }
    }
  }

  /** Known runtime error/timeout patterns that should not be forwarded as-is. */
  private static readonly RUNTIME_ERROR_PATTERNS = [
    /increase [`']?agents\.defaults/i,
    /timed out before a response was generated/i,
    /LLM idle timeout/i,
  ];

  private static readonly FALLBACK_MESSAGE = "I'm sorry, I wasn't able to complete my response. Please try again.";

  /**
   * Forward buffered text for a run to the buyer, then clear the buffer.
   * `data.text` is accumulated per-turn (resets after each tool call),
   * so we send the full buffer content each time.
   *
   * Before forwarding, sanitizes known runtime error/timeout patterns:
   * - If the entire text is a timeout/error message, replaces with a
   *   user-friendly fallback.
   * - If real content has a timeout suffix appended, strips the suffix.
   */
  private flushTurnText(runId: string, conversationId: string): void {
    let text = this.turnTextBuffer.get(runId)?.trim();
    this.turnTextBuffer.delete(runId);
    if (!text) return;

    const session = this.sessions.get(conversationId);
    if (!session) return;

    // Don't forward for aborted runs
    if (session.abortedRunIds.has(runId)) return;

    // Sanitize runtime error/timeout patterns
    text = this.sanitizeRuntimeErrors(text);

    // Mark delivery initiated synchronously so the chat error handler (which
    // may fire before the network call resolves) defers to us instead of
    // sending a duplicate fallback.  If the delivery fails, we send the
    // fallback ourselves in the catch handler below.
    this.forwardedRuns.add(runId);
    session.forwardTextToBuyer(text)
      .catch((err) => {
        log.error("Failed to forward per-turn text:", err);
        // Re-check abort status: a newer buyer message may have aborted this
        // run while the outbound send was in flight.  Aborted runs must not
        // produce any terminal output for the buyer.
        if (session.abortedRunIds.has(runId)) {
          log.info(`Run ${runId} was aborted during delivery, skipping fallback`);
          return;
        }
        // Delivery failed — buyer didn't receive the text.  The chat error
        // handler already deferred to us (it saw forwardedRuns), so we are
        // responsible for sending the fallback.
        log.warn(`Delivery failed for run ${runId}, sending fallback to buyer`);
        session.forwardTextToBuyer(CustomerServiceBridge.FALLBACK_MESSAGE)
          .catch((fallbackErr) => log.error("Failed to send fallback after delivery failure:", fallbackErr));
      });
  }

  /**
   * Sanitize known runtime error/timeout patterns from agent text.
   * Returns the cleaned text, or a fallback message if the entire text
   * was a runtime error message.
   */
  private sanitizeRuntimeErrors(text: string): string {
    const hasErrorPattern = CustomerServiceBridge.RUNTIME_ERROR_PATTERNS.some(
      (pattern) => pattern.test(text),
    );
    if (!hasErrorPattern) return text;

    // Split into lines and find where the error message starts
    const lines = text.split("\n");
    const cleanLines: string[] = [];
    for (const line of lines) {
      const isErrorLine = CustomerServiceBridge.RUNTIME_ERROR_PATTERNS.some(
        (pattern) => pattern.test(line),
      );
      if (isErrorLine) break;
      cleanLines.push(line);
    }

    const cleaned = cleanLines.join("\n").trim();
    if (cleaned) {
      log.info(`Stripped runtime error suffix from agent text (${text.length} → ${cleaned.length} chars)`);
      return cleaned;
    }

    // Entire text was a runtime error message
    log.info("Agent text was entirely a runtime error message, replacing with fallback");
    return CustomerServiceBridge.FALLBACK_MESSAGE;
  }

  // -- Entity cache subscription ---------------------------------------------

  private subscribeToCacheChanges(): void {
    // Avoid double-subscribe
    if (this.cacheUnsubscribe) return;

    this.cacheUnsubscribe = reaction(
      () => toJS(rootStore.shops),
      () => this.onShopsChanged(),
    );
  }

  private onShopsChanged(): void {
    const hadShops = this.shopContexts.size > 0;
    this.syncFromCache();
    const hasShops = this.shopContexts.size > 0;

    // Connect to relay if shops appeared and we aren't connected
    if (!hadShops && hasShops && !this.ws && !this.closed) {
      log.info("Shops appeared in entity cache, connecting to CS relay");
      this.connect().catch((err) => {
        log.warn(`CS bridge connect on shop appearance failed: ${(err as Error).message ?? err}`);
      });
    }

    // Disconnect from relay if all shops removed
    if (hadShops && !hasShops && this.ws) {
      log.info("All shops removed from entity cache, disconnecting from CS relay");
      this.ws.close();
      this.ws = null;
      this.authenticated = false;
      runtimeStatusStore.setCsBridgeDisconnected();
    }
  }

  // -- Connection management -------------------------------------------------

  private async connect(): Promise<void> {
    if (this.closed) return;
    if (this.shopContexts.size === 0) return; // no shops need CS

    let token = getAuthSession()?.getAccessToken() ?? null;

    // If the last connection was rejected with 4003 (auth failure), the cached
    // token is likely expired. Attempt a refresh before reconnecting, following
    // the same pattern as CloudClient.rest() (auto-refresh on 401).
    if (token && this.lastCloseWasAuthFailure) {
      log.info("Last close was auth failure (4003), refreshing access token before reconnect");
      try {
        token = await getAuthSession()!.refresh();
        this.lastCloseWasAuthFailure = false;
      } catch (err) {
        // Distinguish auth errors (permanent) from network errors (transient),
        // following the same pattern as AuthSession.validate() in auth-session.ts.
        const msg = err instanceof Error ? err.message : String(err);
        const isAuthError =
          msg.includes("Not authenticated") ||
          msg.includes("Authentication required") ||
          msg.includes("Invalid token") ||
          msg.includes("Token expired") ||
          msg.includes("No refresh token");

        if (isAuthError) {
          // Auth is permanently broken (e.g. refresh token expired/revoked).
          // Stop reconnecting to avoid an infinite loop.
          log.error("Token refresh failed (auth error), stopping CS bridge reconnect:", err);
          this.lastCloseWasAuthFailure = false;
          return;
        }

        // Network/transient error — keep lastCloseWasAuthFailure so the next
        // reconnect attempt will retry the refresh, and schedule a reconnect
        // with backoff instead of connecting with a potentially expired token.
        log.warn("Token refresh failed (transient error), scheduling reconnect:", err);
        this.scheduleReconnect();
        return;
      }
    }

    if (!token) {
      log.warn("No auth token available, scheduling reconnect");
      this.scheduleReconnect();
      return;
    }

    return new Promise<void>((resolve) => {
      log.info(`Connecting to CS relay at ${this.opts.relayUrl}...`);

      const ws = proxyNetwork.createWebSocket(this.opts.relayUrl);
      this.ws = ws;

      ws.on("open", () => {
        log.info("CS relay WebSocket open, sending cs_hello");
        const hello: CSHelloFrame = {
          type: "cs_hello",
          gateway_id: this.opts.gatewayId,
          auth_token: token!,
        };
        ws.send(JSON.stringify(hello));
      });

      ws.on("message", (data) => {
        try {
          const frame = JSON.parse(data.toString()) as CSWSFrame;
          this.onFrame(frame);
        } catch (err) {
          log.warn("Failed to parse CS relay message:", err);
        }
      });

      ws.on("close", (code, reason) => {
        log.info(`CS relay WebSocket closed: ${code} ${reason.toString()}`);
        this.stopPingInterval();
        this.ws = null;
        this.authenticated = false;
        runtimeStatusStore.setCsBridgeDisconnected();
        this.lastCloseWasAuthFailure = code === 4003;
        if (!this.closed) {
          this.scheduleReconnect();
        }
        resolve();
      });

      ws.on("error", (err) => {
        log.warn(`CS relay WebSocket error: ${err.message}`);
      });

      ws.on("pong", () => {
        this.awaitingPong = false;
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.shopContexts.size === 0) return; // intentional disconnect, no shops need CS

    const baseDelay = 1000;
    const maxDelay = 5000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempt), maxDelay);
    this.reconnectAttempt++;
    runtimeStatusStore.setCsBridgeReconnecting(this.reconnectAttempt);

    log.info(`CS bridge reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        log.warn(`CS bridge reconnect failed: ${(err as Error).message ?? err}`);
      });
    }, delay);
  }

  // -- Ping/pong keepalive ---------------------------------------------------

  private startPingInterval(): void {
    this.stopPingInterval();
    this.awaitingPong = false;

    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (this.awaitingPong) {
        // Previous ping never got a pong — connection is dead
        log.warn("CS relay pong timeout — terminating dead connection");
        this.ws.terminate();
        return;
      }

      this.awaitingPong = true;
      this.ws.ping();
    }, CustomerServiceBridge.PING_INTERVAL_MS);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.awaitingPong = false;
  }

  // -- Frame dispatch --------------------------------------------------------

  private onFrame(frame: CSWSFrame): void {
    switch (frame.type) {
      // Wire-format identifiers from the relay server — not platform-specific restrictions.
      case "cs_tiktok_new_message":
        this.onNewMessage(frame as CSNewMessageFrame).catch((err) => {
          log.error("Error handling CS message:", err);
        });
        break;
      case "cs_tiktok_new_conversation":
        log.info(
          `New CS conversation: shop=${(frame as CSNewConversationFrame).shopId} ` +
          `conv=${(frame as CSNewConversationFrame).conversationId}`,
        );
        break;
      case "cs_ack":
        this.reconnectAttempt = 0;
        this.authenticated = true;
        runtimeStatusStore.setCsBridgeConnected();
        log.info("CS relay connection confirmed (cs_ack)");
        this.startPingInterval();
        // Bind all CS-enabled shops after relay confirms connection
        this.sendShopBindings();
        break;
      case "cs_bind_shops_result": {
        const result = frame as CSBindShopsResultFrame;
        const boundSet = new Set(result.bound);
        const takenOverSet = new Set(result.takenOver ?? []);
        const conflictSet = new Set(result.conflicts.map(c => c.shopId));
        const requested = [...this.shopContexts.keys()];
        const rejected = requested.filter(id => !boundSet.has(id) && !takenOverSet.has(id) && !conflictSet.has(id));

        log.info(`Shop binding result: ${result.bound.length} bound, ${(result.takenOver ?? []).length} takenOver, ${result.conflicts.length} conflicts, ${rejected.length} rejected`);
        if (result.bound.length > 0) {
          log.info(`  Bound: ${result.bound.join(", ")}`);
        }
        if ((result.takenOver ?? []).length > 0) {
          log.info(`  Taken over from other device: ${result.takenOver!.join(", ")}`);
        }
        if (result.conflicts.length > 0) {
          log.warn(`  Conflicts (bound to other device): ${result.conflicts.map(c => `${c.shopId} → ${c.gatewayId}`).join(", ")}`);
        }
        if (rejected.length > 0) {
          log.error(`  Rejected (not bound, no conflict — check relay server auth): ${rejected.join(", ")}`);
        }
        this.bindingConflicts = result.conflicts;
        break;
      }
      case "cs_shop_taken_over": {
        const taken = frame as CSShopTakenOverFrame;
        log.warn(`Shop ${taken.shopId} taken over by gateway ${taken.newGatewayId}`);
        // Remove from local shop contexts so we stop handling messages for this shop
        this.shopContexts.delete(taken.shopId);
        break;
      }
      case "cs_error":
        log.error(`CS relay error: ${(frame as { message?: string }).message}`);
        break;
      default:
        break;
    }
  }

  // -- Shop binding ----------------------------------------------------------

  /**
   * Send cs_bind_shops frame to the relay.
   * If shopIds is provided, only those shops are sent; otherwise all known shops.
   */
  private sendShopBindings(shopIds?: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) return;

    const ids = shopIds ?? [...this.shopContexts.values()].map(ctx => ctx.platformShopId);
    if (ids.length === 0) return;

    const frame: CSBindShopsFrame = {
      type: "cs_bind_shops",
      shopIds: ids,
    };
    this.ws.send(JSON.stringify(frame));
    log.info(`Sent shop bindings: ${ids.length} shop(s)`);
  }

  // -- Inbound message handling -----------------------------------------------

  private async onNewMessage(frame: CSNewMessageFrame): Promise<void> {
    log.info(`Incoming message: shop=${frame.shopId} conv=${frame.conversationId} msg=${frame.messageId} sender=${frame.senderRole}`);

    const shop = this.shopContexts.get(frame.shopId);
    if (!shop) {
      log.error(`No shop context for platform shopId ${frame.shopId}, dropping message`);
      return;
    }

    const session = await this.getOrCreateSession(shop.objectId, {
      conversationId: frame.conversationId,
      buyerUserId: frame.imUserId,
      imUserId: frame.imUserId,
      orderId: frame.orderId,
    });

    try {
      await session.handleBuyerMessage(frame);
      // Session handles abort + queue + redispatch internally.
      // onRunDispatched callback handles pendingRuns tracking.
    } catch (err) {
      log.error(`Failed to handle buyer message ${frame.messageId}:`, err);
    }
  }

  // -- Internal helpers -------------------------------------------------------

  /** Find a shop context by its MongoDB objectId. */
  private findShopByObjectId(objectId: string): CSShopContext | undefined {
    for (const shop of this.shopContexts.values()) {
      if (shop.objectId === objectId) return shop;
    }
    return undefined;
  }

  /** Find session that owns a given escalation ID (searches all sessions). */
  findSessionByEscalationId(escalationId: string): CustomerServiceSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.escalations.has(escalationId)) return session;
    }
    return undefined;
  }

  /**
   * Find escalation data by ID, checking in-memory sessions first, then storage.
   * Returns the escalation plus its conversation/shop/buyer context.
   */
  findEscalationById(escalationId: string): { escalation: Escalation; conversationId: string; shopId: string; buyerUserId: string } | undefined {
    // Check in-memory sessions first (fast path)
    for (const session of this.sessions.values()) {
      const esc = session.escalations.get(escalationId);
      if (esc) {
        return {
          escalation: esc,
          conversationId: session.csContext.conversationId,
          shopId: session.csContext.shopId,
          buyerUserId: session.csContext.buyerUserId,
        };
      }
    }
    // Fall back to storage (survives restart)
    const storage = getStorageRef();
    if (!storage) return undefined;
    const stored = storage.csEscalations.getById(escalationId);
    if (!stored) return undefined;
    return {
      escalation: {
        id: stored.id,
        reason: stored.reason,
        context: stored.context,
        createdAt: stored.createdAt,
        result: stored.result,
      },
      conversationId: stored.conversationId,
      shopId: stored.shopId,
      buyerUserId: stored.buyerUserId,
    };
  }

  /** Get existing session or create a new one. */
  async getOrCreateSession(
    shopObjectId: string,
    params: { conversationId: string; buyerUserId: string; imUserId?: string; orderId?: string },
  ): Promise<CustomerServiceSession> {
    const existing = this.sessions.get(params.conversationId);
    if (existing) return existing;

    const shop = this.findShopByObjectId(shopObjectId);
    if (!shop) throw new Error(`No shop context for objectId ${shopObjectId}`);

    return this.createAndStoreSession(shop, shopObjectId, params);
  }

  private async createAndStoreSession(
    shop: CSShopContext,
    shopObjectId: string,
    params: { conversationId: string; buyerUserId: string; imUserId?: string; orderId?: string },
  ): Promise<CustomerServiceSession> {
    const csContext = {
      shopId: shopObjectId,
      conversationId: params.conversationId,
      buyerUserId: params.buyerUserId,
      imUserId: params.imUserId,
      orderId: params.orderId,
    };

    const session = new CustomerServiceSession(shop, csContext, {
      defaultRunProfileId: this.opts.defaultRunProfileId,
      onRunDispatched: (runId) => {
        this.pendingRuns.set(runId, { shopObjectId, conversationId: params.conversationId });
      },
    });

    // Resolve platform buyer ID and recent orders before session is usable
    await session.ensureContextResolved();

    this.sessions.set(params.conversationId, session);
    return session;
  }

  /** Shallow equality check for CSShopContext to avoid unnecessary updates. */
  private shopContextEqual(a: CSShopContext, b: CSShopContext): boolean {
    return (
      a.objectId === b.objectId &&
      a.platformShopId === b.platformShopId &&
      a.platform === b.platform &&
      a.systemPrompt === b.systemPrompt &&
      a.csProviderOverride === b.csProviderOverride &&
      a.csModelOverride === b.csModelOverride &&
      a.runProfileId === b.runProfileId
    );
  }
}
