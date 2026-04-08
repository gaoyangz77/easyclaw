// ── W19-0A: Core Types ──────────────────────────────────────────────────────

/** Platform-agnostic inbound message (Adapter → Core Router). */
export interface CSInboundMessage {
  id: string;
  /** Platform identifier: "wecom" | "douyin" | "xiaohongshu" | "shopee" | ... */
  platform: string;
  /** Platform-native customer identifier. */
  customer_id: string;
  msg_type: "text" | "image" | "voice" | "video";
  /** Text content (for text messages) or caption. */
  content: string;
  /** Base64-encoded media data (for image/voice/video). */
  media_data?: string;
  /** MIME type of the media (e.g. "audio/amr", "image/jpeg"). */
  media_mime?: string;
  /** Original timestamp from platform (epoch seconds). */
  timestamp: number;
  /** Platform-specific metadata (transparent passthrough, not parsed by core). */
  platform_meta?: Record<string, unknown>;
}

/** Platform-agnostic outbound reply (Core Router → Adapter). */
export interface CSOutboundMessage {
  id: string;
  platform: string;
  customer_id: string;
  msg_type: "text" | "image";
  content: string;
  /** Base64-encoded image data (for image replies). */
  image_data?: string;
  /** MIME type of image (e.g. "image/png"). */
  image_mime?: string;
}

/** Configuration for the customer service module (client-side). */
export interface CustomerServiceConfig {
  /** Relay server WebSocket URL. */
  relayUrl: string;
  /** Authentication token for relay. */
  authToken: string;
  /** Gateway ID for this RivonClaw instance. */
  gatewayId: string;
  /** User-defined business rules/prompt (editable). */
  businessPrompt: string;
  /** Enabled platforms. */
  platforms: string[];
}

/** Runtime status of the customer service module. */
export interface CustomerServiceStatus {
  connected: boolean;
  platforms: CustomerServicePlatformStatus[];
}

/** Per-platform status within customer service. */
export interface CustomerServicePlatformStatus {
  platform: string;
  boundCustomers: number;
}

// ── W19-0B: WebSocket Frame Types (Relay ↔ Client) ─────────────────────────

/** Client → Relay: authenticate gateway connection. */
export interface CSHelloFrame {
  type: "cs_hello";
  gateway_id: string;
  auth_token: string;
}

/** Relay → Client: incoming customer message. */
export interface CSInboundFrame {
  type: "cs_inbound";
  id: string;
  platform: string;
  customer_id: string;
  msg_type: string;
  content: string;
  timestamp: number;
  media_data?: string;
  media_mime?: string;
}

/** Client → Relay: text reply to customer. */
export interface CSReplyFrame {
  type: "cs_reply";
  id: string;
  platform: string;
  customer_id: string;
  content: string;
}

/** Client → Relay: image reply to customer. */
export interface CSImageReplyFrame {
  type: "cs_image_reply";
  id: string;
  platform: string;
  customer_id: string;
  image_data: string;
  image_mime: string;
}

/** Relay → Client: acknowledgment. */
export interface CSAckFrame {
  type: "cs_ack";
  id: string;
}

/** Relay → Client: error response. */
export interface CSErrorFrame {
  type: "cs_error";
  message: string;
}

/** Client → Relay: bind shops to this gateway. */
export interface CSBindShopsFrame {
  type: "cs_bind_shops";
  shopIds: string[];
}

/** Relay → Client: shop binding result. */
export interface CSBindShopsResultFrame {
  type: "cs_bind_shops_result";
  bound: string[];
  /** Shop IDs that were taken over from another gateway during binding. */
  takenOver?: string[];
  /** @deprecated Always empty — kept for backwards compatibility. */
  conflicts: Array<{ shopId: string; gatewayId: string }>;
}

/** Client → Relay: unbind shops. */
export interface CSUnbindShopsFrame {
  type: "cs_unbind_shops";
  shopIds: string[];
}

/** Client → Relay: force-bind a shop (take over from another device). */
export interface CSForceBindShopFrame {
  type: "cs_force_bind_shop";
  shopId: string;
}

/** Relay → Client: your shop was taken over by another device. */
export interface CSShopTakenOverFrame {
  type: "cs_shop_taken_over";
  shopId: string;
  newGatewayId: string;
}

/** Client → Relay: request a new binding token. */
export interface CSCreateBindingFrame {
  type: "cs_create_binding";
  gateway_id: string;
  platform?: string;
}

/** Relay → Client: binding token created. */
export interface CSCreateBindingAckFrame {
  type: "cs_create_binding_ack";
  token: string;
  customer_service_url: string;
}

/** Client → Relay: unbind all customers for this gateway. */
export interface CSUnbindAllFrame {
  type: "cs_unbind_all";
  gateway_id: string;
}

/** Relay → Client: a customer was successfully bound to this gateway. */
export interface CSBindingResolvedFrame {
  type: "cs_binding_resolved";
  platform: string;
  customer_id: string;
  gateway_id: string;
}

// ── W29-0E: Relay-to-Desktop New-Message / New-Conversation Frames ───────────
//
// The wire-format `type` strings ("cs_tiktok_new_message", etc.) are kept for
// backward compatibility with the relay server.  The TypeScript interface names
// are platform-neutral because the desktop CS bridge handles these frames
// identically regardless of which e-commerce platform originated them.

/** Relay → Client: new conversation notification. */
export interface CSNewConversationFrame {
  /** Wire-format identifier — kept as "cs_tiktok_new_conversation" for relay compat. */
  type: "cs_tiktok_new_conversation";
  shopId: string;
  conversationId: string;
  createTime: number;
}

/** Relay → Client: new message notification (buyer message relayed to desktop agent). */
export interface CSNewMessageFrame {
  /** Wire-format identifier — kept as "cs_tiktok_new_message" for relay compat. */
  type: "cs_tiktok_new_message";
  shopId: string;
  conversationId: string;
  /** Buyer's IM user ID (from webhook sender.im_user_id). NOT the platform buyer user ID. */
  imUserId: string;
  /** Order ID if conversation is order-scoped (post-sale). Undefined for pre-sale. */
  orderId?: string;
  messageId: string;
  messageType: string;
  content: string;
  senderRole: string;
  /** Sender's IM user ID (same as imUserId for buyer messages). */
  senderId: string;
  createTime: number;
  isVisible: boolean;
}

/** Union of all customer service WebSocket frames. */
export type CSWSFrame =
  | CSHelloFrame
  | CSInboundFrame
  | CSReplyFrame
  | CSImageReplyFrame
  | CSAckFrame
  | CSErrorFrame
  | CSBindShopsFrame
  | CSBindShopsResultFrame
  | CSUnbindShopsFrame
  | CSForceBindShopFrame
  | CSShopTakenOverFrame
  | CSCreateBindingFrame
  | CSCreateBindingAckFrame
  | CSUnbindAllFrame
  | CSBindingResolvedFrame
  | CSNewConversationFrame
  | CSNewMessageFrame;

// ── Admin Directive (V0 escalation) ──────────────────────────────────────────

/** Parameters for dispatching a verified manager directive to a CS agent session. */
export interface CSAdminDirectiveParams {
  /** MongoDB ObjectId of the shop. */
  shopId: string;
  /** The CS conversation to resume. */
  conversationId: string;
  /** The buyer in this conversation. */
  buyerUserId: string;
  /** Manager's decision: "approved" | "rejected" | free text. */
  decision: string;
  /** Manager's instructions for the agent. */
  instructions: string;
  /** Related order if any. */
  orderId?: string;
}

// ── Escalation ───────────────────────────────────────────────────────────────

/** Parameters for sending an escalation message to a merchant's configured channel. */
export interface CSEscalateParams {
  /** MongoDB ObjectId of the shop. */
  shopId: string;
  /** The CS conversation being escalated. */
  conversationId: string;
  /** The buyer in this conversation. */
  buyerUserId: string;
  /** Related order if any. */
  orderId?: string;
  /** Reason for escalation. */
  reason: string;
  /** Optional additional context for the merchant. */
  context?: string;
}

// ── Adapter Interface ───────────────────────────────────────────────────────

/**
 * Interface that each platform adapter must implement.
 * The adapter handles platform-specific webhook/API logic and normalizes
 * messages into the platform-agnostic format used by the Core Router.
 */
export interface PlatformAdapter {
  /** Platform identifier (e.g. "wecom", "douyin", "xiaohongshu"). */
  readonly platform: string;

  /** Register HTTP routes for this platform's webhook. Called during server startup. */
  registerWebhook(app: unknown): void;

  /** Send a text reply to a customer on this platform. */
  sendText(customerId: string, content: string): Promise<void>;

  /** Send an image reply to a customer on this platform. */
  sendImage(customerId: string, imageData: Buffer, mime: string): Promise<void>;
}
