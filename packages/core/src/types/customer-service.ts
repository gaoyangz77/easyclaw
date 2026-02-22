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
  /** Gateway ID for this EasyClaw instance. */
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

/** Union of all customer service WebSocket frames. */
export type CSWSFrame =
  | CSHelloFrame
  | CSInboundFrame
  | CSReplyFrame
  | CSImageReplyFrame
  | CSAckFrame
  | CSErrorFrame
  | CSCreateBindingFrame
  | CSCreateBindingAckFrame
  | CSUnbindAllFrame
  | CSBindingResolvedFrame;

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
