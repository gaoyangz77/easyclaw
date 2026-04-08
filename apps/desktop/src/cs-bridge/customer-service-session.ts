/**
 * CustomerServiceSession — a long-lived object representing one CS conversation.
 *
 * Created by the Bridge when a conversation first appears (via relay message,
 * admin directive, or manual start). Reused across subsequent messages in the
 * same conversation. The Bridge stores sessions keyed by conversationId.
 *
 * Responsibilities:
 * - Session key construction (scopeKey / dispatchKey)
 * - System prompt assembly (with optional admin directive guidance)
 * - Gateway session registration (cs_register_session + RunProfile + model override)
 * - Backend session creation (balance check)
 * - Agent run dispatch (buyer message, admin directive, catch-up)
 * - Escalation message sending
 *
 * Does NOT own any global state (pendingRuns, activeConversations, relay connection).
 */

import crypto from "node:crypto";
import { createLogger } from "@rivonclaw/logger";
import { ScopeType, GQL, type CSNewMessageFrame } from "@rivonclaw/core";
import { isStagingDevMode } from "@rivonclaw/core/endpoints";
import { getRpcClient } from "../gateway/rpc-client-ref.js";
import { getAuthSession } from "../auth/auth-session-ref.js";
import { getStorageRef } from "../storage-ref.js";
import { rootStore } from "../store/desktop-store.js";
import { proxyNetwork } from "../gateway/proxy-aware-network.js";

const log = createLogger("cs-session");

const SEND_MESSAGE_MUTATION = `
  mutation($shopId: String!, $conversationId: String!, $type: EcomMessageType!, $content: String!) {
    ecommerceSendMessage(shopId: $shopId, conversationId: $conversationId, type: $type, content: $content) {
      code message data
    }
  }
`;

export const GET_CONVERSATION_DETAILS_QUERY = `
  query($shopId: String!, $conversationId: String!) {
    ecommerceGetConversationDetails(shopId: $shopId, conversationId: $conversationId) {
      code message
      customer { userId nickname }
    }
  }
`;

const GET_BUYER_ORDERS_QUERY = `
  query($shopId: String!, $buyerUserId: String) {
    ecommerceGetOrders(shopId: $shopId, buyerUserId: $buyerUserId) {
      code message data
    }
  }
`;

const CS_GET_OR_CREATE_SESSION_MUTATION = `
  mutation CsGetOrCreateSession($shopId: ID!, $conversationId: String!, $buyerUserId: String!) {
    csGetOrCreateSession(shopId: $shopId, conversationId: $conversationId, buyerUserId: $buyerUserId) {
      sessionId
      isNew
      balance
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shop data needed by a CS session (resolved by desktop from entity cache). */
export interface CSShopContext {
  /** MongoDB ObjectId — used for backend API calls and prompt assembly. */
  objectId: string;
  /** Platform shop ID (TikTok's ID) — matches webhook shop_id. */
  platformShopId: string;
  /** Human-readable shop name (e.g., "My Store"). */
  shopName: string;
  /** Normalized short platform name for session keys (e.g., "tiktok"). */
  platform?: string;
  /** Assembled CS system prompt for this shop. */
  systemPrompt: string;
  /** Provider override for CS sessions. Undefined = use global default provider. */
  csProviderOverride?: string;
  /** LLM model override for CS sessions. Undefined = use global default. */
  csModelOverride?: string;
  /** RunProfile ID configured for this shop's CS sessions. */
  runProfileId?: string;
}

export interface CSContext {
  shopId: string;
  conversationId: string;
  /** Platform buyer user ID. Resolved from conversation details during context
   *  resolution. Before resolution, holds the IM user ID as a placeholder. */
  buyerUserId: string;
  /** IM user ID from the webhook (preserved as-is). Only set for sessions
   *  created via relay webhook path; undefined for manually started sessions. */
  imUserId?: string;
  /** undefined = not yet fetched; null = fetched but no order; string = most recent orderId */
  orderId?: string | null;
  /** undefined = not fetched yet; [] = fetched, no orders; non-empty = has orders */
  recentOrders?: Array<{ orderId: string; createTime: number }>;
}

export interface DispatchResult {
  runId?: string;
}

export interface EscalationResult {
  decision: string;
  instructions: string;
  resolved: boolean;
  resolvedAt: number;
}

export interface Escalation {
  id: string;
  reason: string;
  context?: string;
  createdAt: number;
  result?: EscalationResult;
}

// ---------------------------------------------------------------------------
// CustomerServiceSession
// ---------------------------------------------------------------------------

export class CustomerServiceSession {
  readonly platform: string;
  readonly scopeKey: string;
  readonly dispatchKey: string;

  /** Whether a backend session has been created (balance checked). */
  private backendSessionReady = false;

  /** Whether gateway session setup has been completed (cs_register_session + RunProfile + model). */
  private gatewaySetupReady = false;

  /**
   * Currently active or pending run ID.
   * Set synchronously to a placeholder BEFORE the async dispatch RPC, so the next
   * incoming message can see it and abort. Replaced with the real runId after dispatch.
   */
  private activeRunId: string | null = null;

  /** Run IDs that were aborted — their gateway events should be ignored (no auto-forward). */
  readonly abortedRunIds = new Set<string>();

  /** Number of runs aborted since the last successful delivery to the buyer. */
  private undeliveredCount = 0;

  /** Escalations keyed by escalationId. Populated by addEscalation, resolved by resolveEscalation. */
  readonly escalations = new Map<string, Escalation>();

  constructor(
    private readonly shop: CSShopContext,
    readonly csContext: CSContext,
    private readonly opts?: {
      defaultRunProfileId?: string;
      /** Called after a successful agent dispatch, so the Bridge can track the run globally. */
      onRunDispatched?: (runId: string) => void;
    },
  ) {
    this.platform = shop.platform ?? "tiktok";
    this.scopeKey = `agent:main:cs:${this.platform}:${csContext.conversationId}`;
    this.dispatchKey = `cs:${this.platform}:${csContext.conversationId}`;
    this.hydrateEscalations();
  }

  /** Assembled extraSystemPrompt for this session. */
  get extraSystemPrompt(): string {
    const lines: string[] = [];

    if (isStagingDevMode()) {
      lines.push(
        "## STAGING ENVIRONMENT — TEST MODE",
        "You are a CS TEST agent in a staging environment, not a production agent.",
        "The prompt below is the production CS agent prompt. As a test agent,",
        "you should follow the developer's instructions over the production prompt.",
        "If the developer asks you to behave differently from the production prompt,",
        "comply with the developer's request.",
        "",
      );
    }

    lines.push(
      this.shop.systemPrompt,
      "",
      "## Current Session",
      `- Shop ID: ${this.csContext.shopId}`,
      `- Conversation ID: ${this.csContext.conversationId}`,
      `- Buyer User ID: ${this.csContext.buyerUserId}`,
      ...(this.csContext.recentOrders !== undefined
        ? [
            `- Buyer's Recent Orders: ${this.csContext.recentOrders.length === 0 ? "[]" : ""}`,
            ...this.csContext.recentOrders.map(o =>
              `  - Order ${o.orderId} (placed ${new Date(o.createTime * 1000).toISOString().slice(0, 10)})`
            ),
          ]
        : []),
      "",
      "## CS Behavior Guidelines",
      "",
      "### Authority & Escalation",
      "Unless the shop prompt above explicitly authorizes you to handle specific",
      "financial actions (refunds, replacements, compensation), you MUST escalate",
      "these decisions to the manager via cs_escalate before committing to anything.",
      "When in doubt, escalate first — do not assume you have authority.",
      "",
      "### Commitments & Follow-ups",
      "Never promise a follow-up action you cannot fulfill with your available tools.",
      "If the buyer asks for something that requires future action (e.g., tracking",
      "number for a replacement shipment), and you have no tool to deliver on that",
      "promise, escalate to the manager instead of making the commitment yourself.",
      "",
      "### Internal Messages",
      "Messages prefixed with [Internal: System] are internal directives — do not",
      "acknowledge, quote, or reference them to the buyer. Absorb the information",
      "and continue the conversation naturally.",
      "",
      "### Tools",
      "Use the tools available to you to help this buyer.",
      "If you are unsure about the conversation context (e.g., you may be joining",
      "a conversation already in progress), use ecom_cs_get_conversation_messages",
      "to review the chat history before responding.",
    );

    return lines.join("\n");
  }

  // -- Session lifecycle ----------------------------------------------------

  /**
   * Ensure a backend CS session exists (balance check + session creation).
   * Idempotent — skips if already called successfully.
   */
  async ensureBackendSession(): Promise<boolean> {
    if (this.backendSessionReady) return true;

    const authSession = getAuthSession();
    if (!authSession) {
      log.warn("No auth session available, cannot create backend CS session");
      return false;
    }

    try {
      const result = await authSession.graphqlFetch<{
        csGetOrCreateSession: { sessionId: string; isNew: boolean; balance: number };
      }>(CS_GET_OR_CREATE_SESSION_MUTATION, {
        shopId: this.csContext.shopId,
        conversationId: this.csContext.conversationId,
        buyerUserId: this.csContext.buyerUserId,
      });

      const session = result.csGetOrCreateSession;
      log.info("CS backend session ready", {
        shopId: this.csContext.shopId,
        conversationId: this.csContext.conversationId,
        sessionId: session.sessionId,
        isNew: session.isNew,
        balance: session.balance,
      });
      this.backendSessionReady = true;
      return true;
    } catch (err) {
      log.warn(`CS backend session creation failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  // -- Dispatch methods -----------------------------------------------------

  /**
   * Handle an incoming buyer message.
   *
   * If any run is active or pending (activeRunId is set), aborts it and takes over.
   * Uses JS single-threaded execution: activeRunId is set to a placeholder synchronously
   * before any await, so the next incoming message always sees it and can abort.
   */
  async handleBuyerMessage(frame: CSNewMessageFrame): Promise<DispatchResult> {
    // ── SYNC section (no await — cannot be interleaved) ──
    if (this.activeRunId) {
      log.info(`New message during active/pending run ${this.activeRunId}, aborting`);
      this.abortedRunIds.add(this.activeRunId);
      this.fireAbort();
      this.undeliveredCount++;
    }

    // Claim the slot immediately with a placeholder so the next message can see it.
    const placeholder = `pending:${frame.messageId}`;
    this.activeRunId = placeholder;
    const content = this.parseMessageContent(frame);
    // ── END SYNC section ──

    if (!await this.ensureBackendSession()) {
      if (this.activeRunId === placeholder) this.activeRunId = null;
      return { runId: undefined };
    }

    // If a newer message took over while we were awaiting, bail out.
    if (this.activeRunId !== placeholder) {
      return { runId: undefined };
    }

    const attachments = await this.fetchImageAttachment(frame);

    if (this.activeRunId !== placeholder) {
      return { runId: undefined };
    }

    // If previous runs were aborted, tell the agent its prior replies were not delivered.
    const senderTag = isStagingDevMode() ? "[Internal: Developer]" : "[External: Buyer]";
    let message = `${senderTag}\n${content}`;
    if (this.undeliveredCount > 0) {
      const notice = this.undeliveredCount === 1
        ? "[Internal: System]\nNote: Your previous reply was not delivered to the buyer because a new message arrived. The buyer has not seen it. Please incorporate all messages in your response."
        : `[Internal: System]\nNote: Your last ${this.undeliveredCount} replies were not delivered to the buyer because new messages arrived while you were responding. The buyer has not seen them. Please incorporate all messages in your response.`;
      message = `${notice}\n\n${message}`;
    }

    return this.dispatch({
      message,
      idempotencyKey: `${this.platform}:${frame.messageId}`,
      attachments,
      placeholder,
    });
  }

  /**
   * Called by Bridge when an agent run completes (final or error).
   * Clears active run tracking.
   */
  onRunCompleted(runId: string): void {
    if (this.activeRunId === runId) {
      this.activeRunId = null;
    }
  }

  // -- Escalation lifecycle ---------------------------------------------------

  /**
   * Create an escalation record and return the generated ID.
   * Called before sending the escalation message to the merchant channel.
   */
  addEscalation(params: { reason: string; context?: string }): Escalation {
    const id = `esc_${crypto.randomUUID().slice(0, 8)}`;
    const escalation: Escalation = {
      id,
      reason: params.reason,
      context: params.context,
      createdAt: Date.now(),
    };
    this.escalations.set(id, escalation);

    // Persist to storage
    const storage = getStorageRef();
    if (storage) {
      storage.csEscalations.save({
        id: escalation.id,
        conversationId: this.csContext.conversationId,
        shopId: this.csContext.shopId,
        buyerUserId: this.csContext.buyerUserId,
        reason: params.reason,
        context: params.context,
        createdAt: escalation.createdAt,
      });
    }

    log.info(`Escalation created: ${id} for conv=${this.csContext.conversationId}`);
    return escalation;
  }

  /**
   * Write the manager's decision to an existing escalation record.
   * Can be called multiple times — each call overwrites the previous result
   * (supports interim updates before final resolution).
   */
  resolveEscalation(escalationId: string, params: { decision: string; instructions: string; resolved: boolean }): Escalation {
    const escalation = this.escalations.get(escalationId);
    if (!escalation) throw new Error(`Escalation ${escalationId} not found`);
    escalation.result = {
      decision: params.decision,
      instructions: params.instructions,
      resolved: params.resolved,
      resolvedAt: Date.now(),
    };

    // Persist to storage
    const storage = getStorageRef();
    if (storage) {
      storage.csEscalations.updateResult(escalationId, {
        decision: params.decision,
        instructions: params.instructions,
        resolved: params.resolved,
        resolvedAt: escalation.result.resolvedAt,
      });
    }

    log.info(`Escalation ${params.resolved ? "resolved" : "updated"}: ${escalationId} decision=${params.decision}`);
    return escalation;
  }

  /**
   * Load escalations from storage into the in-memory Map.
   * Called once from the constructor to restore state after app restart.
   * Only adds records not already present in memory (memory is the fast path).
   */
  private hydrateEscalations(): void {
    const storage = getStorageRef();
    if (!storage) return;
    const rows = storage.csEscalations.getByConversationId(this.csContext.conversationId);
    for (const row of rows) {
      if (!this.escalations.has(row.id)) {
        this.escalations.set(row.id, {
          id: row.id,
          reason: row.reason,
          context: row.context,
          createdAt: row.createdAt,
          result: row.result,
        });
      }
    }
  }

  /**
   * Dispatch a CS agent run notifying it that an escalation has been updated or resolved.
   * The agent should call cs_get_escalation_result to get the decision.
   */
  async dispatchEscalationResolved(escalationId: string): Promise<DispatchResult> {
    const escalation = this.escalations.get(escalationId);
    const resolved = escalation?.result?.resolved ?? false;
    const message = resolved
      ? `[Internal: System]\nYour escalation (${escalationId}) has been resolved by your manager. Use the cs_get_escalation_result tool with this escalation ID to retrieve the decision and instructions.`
      : `[Internal: System]\nYour manager has sent an update regarding escalation (${escalationId}). Use the cs_get_escalation_result tool to check the latest status.`;
    return this.dispatch({
      message,
      idempotencyKey: `esc-resolved:${escalationId}:${Date.now()}`,
    });
  }

  /**
   * Forward agent text output to the buyer via the backend GraphQL proxy.
   * Called by the Bridge when an agent run completes with text output.
   */
  async forwardTextToBuyer(text: string): Promise<void> {
    const authSession = getAuthSession();
    if (!authSession) {
      log.warn("No auth session available, cannot forward text to buyer");
      return;
    }
    await authSession.graphqlFetch(SEND_MESSAGE_MUTATION, {
      shopId: this.csContext.shopId,
      conversationId: this.csContext.conversationId,
      type: GQL.EcomMessageType.Text,
      content: JSON.stringify({ content: text }),
    });
    this.undeliveredCount = 0;
    log.info(`Auto-forwarded agent text to buyer (${text.length} chars)`);
  }

  /** Dispatch an agent run to catch up on a missed conversation. Ensures backend session first. */
  async dispatchCatchUp(): Promise<DispatchResult> {
    if (!await this.ensureBackendSession()) {
      throw new Error("Failed to create backend CS session (insufficient balance?)");
    }
    return this.dispatch({
      message: "[Internal: System]\nA customer may be waiting for a response in this conversation. " +
        "WARNING: There may have been messages exchanged since your last interaction that you did not receive. " +
        "You MUST call ecom_cs_get_conversation_messages to check the latest conversation state before responding. " +
        "Do not rely on your existing context — verify what the buyer actually said most recently.",
      idempotencyKey: `cs-start:${this.csContext.conversationId}:${Date.now()}`,
    });
  }

  /**
   * Create an escalation record and send the escalation message to the merchant's channel.
   * Returns the escalation ID for the agent to reference.
   */
  async escalate(params: {
    reason: string;
    orderId?: string;
    context?: string;
  }): Promise<{ ok: boolean; escalationId?: string; error?: string }> {
    const rpcClient = getRpcClient();
    if (!rpcClient) throw new Error("No RPC client available");

    const shopMst = rootStore.shops.find(s => s.id === this.csContext.shopId);
    const escalationChannelId = shopMst?.services?.customerService?.escalationChannelId;
    const escalationRecipientId = shopMst?.services?.customerService?.escalationRecipientId;

    if (!escalationChannelId || !escalationRecipientId) {
      return { ok: false, error: "Escalation routing not configured" };
    }

    // Create escalation record
    const escalation = this.addEscalation(params);

    // Fetch buyer nickname from conversation details
    let buyerNickname: string | undefined;
    try {
      const authSession = getAuthSession();
      if (authSession) {
        const detailsResult = await authSession.graphqlFetch<{
          ecommerceGetConversationDetails: { customer?: { userId: string; nickname: string } };
        }>(GET_CONVERSATION_DETAILS_QUERY, {
          shopId: this.csContext.shopId,
          conversationId: this.csContext.conversationId,
        });
        buyerNickname = detailsResult.ecommerceGetConversationDetails.customer?.nickname;
      }
    } catch (err) {
      log.warn("Failed to fetch conversation details for escalation enrichment:", err);
    }

    const colonIdx = escalationChannelId.indexOf(":");
    const channel = escalationChannelId.slice(0, colonIdx);
    const accountId = escalationChannelId.slice(colonIdx + 1);

    const lines = [
      "CS Escalation",
      "",
      `Escalation ID: ${escalation.id}`,
      `Shop: ${this.shop.shopName}`,
      `Conversation: ${this.csContext.conversationId}`,
      `Buyer: ${buyerNickname ?? this.csContext.buyerUserId}`,
    ];
    const orderId = params.orderId ?? this.csContext.orderId;
    if (orderId) lines.push(`Order: ${orderId}`);
    lines.push(`Reason: ${params.reason}`);
    if (params.context) lines.push(`Context: ${params.context}`);
    lines.push("", "Please reply with your decision (e.g., \"Approved, process full refund\").");

    await rpcClient.request("send", {
      to: escalationRecipientId,
      channel,
      accountId,
      message: lines.join("\n"),
      idempotencyKey: `cs-escalate:${escalation.id}:${Date.now()}`,
    });

    log.info(`Escalation ${escalation.id} sent for conv=${this.csContext.conversationId} via ${channel}`);
    return { ok: true, escalationId: escalation.id };
  }

  // -- Private — message queue ------------------------------------------------

  /** Fire-and-forget abort of the active run. Synchronous call (RPC is async but we don't await). */
  private fireAbort(): void {
    const rpcClient = getRpcClient();
    if (!rpcClient) return;

    rpcClient.request("chat.abort", { sessionKey: this.scopeKey })
      .then(() => log.info(`Aborted active run for session ${this.scopeKey}`))
      .catch((err) => log.warn(`Failed to abort run: ${err instanceof Error ? err.message : String(err)}`));
  }

  // -- Private — context resolution -------------------------------------------

  /** Whether context resolution (platform buyer ID + recent orders) has been attempted. */
  private contextResolved = false;

  /**
   * Resolve platform buyer user ID and recent orders for this session.
   *
   * Called once before the first gateway registration. Fetches conversation
   * details to map the IM user ID to the platform buyer user ID, then uses
   * the platform ID to query the buyer's recent orders.
   *
   * All entry points (webhook message, manual start, escalation) funnel
   * through setup() → this method, so context is always resolved.
   */
  async ensureContextResolved(): Promise<void> {
    if (this.contextResolved) return;

    const authSession = getAuthSession();
    if (!authSession) {
      log.error(`Context resolution failed: no auth session for conv=${this.csContext.conversationId}`);
      this.csContext.recentOrders = [];
      this.contextResolved = true;
      return;
    }

    try {
      // Step 1: resolve platform buyer user ID from conversation participants
      const detailsResult = await authSession.graphqlFetch<{
        ecommerceGetConversationDetails: { code: number; customer?: { userId: string } };
      }>(GET_CONVERSATION_DETAILS_QUERY, {
        shopId: this.csContext.shopId,
        conversationId: this.csContext.conversationId,
      });
      const platformBuyerId = detailsResult.ecommerceGetConversationDetails.customer?.userId;
      if (!platformBuyerId) {
        log.warn(`Context resolution: could not resolve platform buyer ID for conv=${this.csContext.conversationId}`);
        this.csContext.recentOrders = [];
        this.csContext.orderId = null;
        this.contextResolved = true;
        return;
      }

      // Update buyerUserId to the real platform ID
      if (this.csContext.buyerUserId !== platformBuyerId) {
        log.info(`Resolved platform buyerId=${platformBuyerId} (was ${this.csContext.buyerUserId}) for conv=${this.csContext.conversationId}`);
        this.csContext.buyerUserId = platformBuyerId;
      }

      // Step 2: fetch buyer's recent orders using the platform buyer ID
      const ordersResult = await authSession.graphqlFetch<{
        ecommerceGetOrders: { code: number; data?: string };
      }>(GET_BUYER_ORDERS_QUERY, {
        shopId: this.csContext.shopId,
        buyerUserId: platformBuyerId,
      });
      const raw = ordersResult.ecommerceGetOrders;
      if (raw.code === 0 && raw.data) {
        const parsed = JSON.parse(raw.data) as { orders?: Array<{ id?: string; create_time?: number }> };
        const orders = (parsed.orders ?? [])
          .filter((o): o is { id: string; create_time: number } => !!o.id && !!o.create_time)
          .map(o => ({ orderId: o.id, createTime: o.create_time }))
          .sort((a, b) => b.createTime - a.createTime);
        this.csContext.recentOrders = orders;
        this.csContext.orderId = orders[0]?.orderId ?? null;
        log.info(`Context resolved: ${orders.length} order(s) for conv=${this.csContext.conversationId}${orders.length > 0 ? `, latest=${orders[0].orderId}` : ""}`);
      } else {
        this.csContext.recentOrders = [];
        this.csContext.orderId = null;
      }

      this.contextResolved = true;
    } catch (err) {
      log.warn(`Context resolution failed for conv=${this.csContext.conversationId}:`, err);
      // contextResolved stays false — createAndStoreSession will throw,
      // next attempt to create a session for this conversation will retry
    }
  }

  // -- Private — gateway setup ------------------------------------------------

  private async setup(): Promise<void> {
    if (this.gatewaySetupReady) return;

    const rpcClient = getRpcClient();
    if (!rpcClient) throw new Error("No RPC client available");

    await rpcClient.request("cs_register_session", {
      sessionKey: this.scopeKey,
      csContext: this.csContext,
    });

    const runProfileId = this.shop.runProfileId ?? this.opts?.defaultRunProfileId;
    if (!runProfileId) {
      throw new Error(`Shop ${this.shop.objectId} has no runProfileId configured for CS`);
    }
    rootStore.toolCapability.setSessionRunProfile(this.scopeKey, runProfileId);

    await rootStore.llmManager.applyModelForSession(this.scopeKey, {
      type: ScopeType.CS_SESSION,
      shopId: this.shop.objectId,
    });

    this.gatewaySetupReady = true;
  }

  private async dispatch(params: {
    message: string;
    idempotencyKey: string;
    attachments?: Array<{ mimeType: string; content: string }>;
    /** Placeholder activeRunId that was set before this dispatch. */
    placeholder?: string;
  }): Promise<DispatchResult> {
    const rpcClient = getRpcClient();
    if (!rpcClient) throw new Error("No RPC client available");

    await this.setup();

    const response = await rpcClient.request<DispatchResult>("agent", {
      sessionKey: this.dispatchKey,
      message: params.message,
      extraSystemPrompt: this.extraSystemPrompt,
      promptMode: "raw",
      idempotencyKey: params.idempotencyKey,
      ...(params.attachments ? { attachments: params.attachments } : {}),
    });

    const runId = response?.runId;
    if (runId) {
      // If the placeholder was aborted while dispatch was in flight,
      // transfer the abort marker to the real runId so bridge can detect it.
      // Don't overwrite activeRunId — a newer message already claimed the slot.
      if (params.placeholder && this.abortedRunIds.has(params.placeholder)) {
        this.abortedRunIds.delete(params.placeholder);
        this.abortedRunIds.add(runId);
        log.info(`Dispatch completed for aborted placeholder ${params.placeholder} → runId=${runId} (not tracking, newer message took over)`);
        // Still register with bridge for pendingRuns cleanup, but run is marked aborted
        this.opts?.onRunDispatched?.(runId);
      } else if (params.placeholder && this.activeRunId !== params.placeholder) {
        // Placeholder was replaced by a newer message (but not via abort — e.g., bailed before abort).
        // Mark this run as aborted since it's stale.
        this.abortedRunIds.add(runId);
        log.info(`Dispatch completed but placeholder ${params.placeholder} was replaced, marking runId=${runId} as aborted`);
        this.opts?.onRunDispatched?.(runId);
      } else {
        // Normal case: placeholder still matches, take ownership.
        this.activeRunId = runId;
        log.info(`Agent run dispatched: runId=${runId} conv=${this.csContext.conversationId}`);
        this.opts?.onRunDispatched?.(runId);
      }
    } else {
      if (params.placeholder && this.activeRunId === params.placeholder) {
        this.activeRunId = null;
      }
    }
    return { runId };
  }

  private parseMessageContent(frame: CSNewMessageFrame): string {
    if (frame.messageType.toUpperCase() === "TEXT") {
      try {
        const parsed = JSON.parse(frame.content) as Record<string, unknown>;
        if (typeof parsed.content === "string") return parsed.content;
        if (typeof parsed.text === "string") return parsed.text;
      } catch {
        // Not JSON — use raw content
      }
      return frame.content;
    }
    return `[${frame.messageType}] ${frame.content}`;
  }

  private async fetchImageAttachment(
    frame: CSNewMessageFrame,
  ): Promise<Array<{ mimeType: string; content: string }> | undefined> {
    if (frame.messageType.toUpperCase() !== "IMAGE") return undefined;
    try {
      const parsed = JSON.parse(frame.content) as { url?: string };
      if (!parsed.url) return undefined;
      const res = await proxyNetwork.fetch(parsed.url);
      if (!res.ok) return undefined;
      const buffer = Buffer.from(await res.arrayBuffer());
      const mimeType = res.headers.get("content-type") ?? "image/jpeg";
      return [{ mimeType, content: buffer.toString("base64") }];
    } catch (err) {
      log.warn("Failed to fetch buyer image, agent will see URL only", { err });
      return undefined;
    }
  }
}
