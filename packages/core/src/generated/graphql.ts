export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export interface Scalars {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the `date-time` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar.This scalar is serialized to a string in ISO 8601 format and parsed from a string in ISO 8601 format. */
  DateTimeISO: { input: any; output: any; }
}

/** Agent-facing CS settings patch. Omit a field to keep it, pass null to clear it, or pass a value to set it. */
export interface AgentCsSettingsInput {
  /** Store instructions. Omit to keep, null or empty string to clear. */
  businessPrompt?: InputMaybe<Scalars['String']['input']>;
  /** CS model override. Omit to keep, null or empty string to clear. */
  csModelOverride?: InputMaybe<Scalars['String']['input']>;
  /** CS provider override. Omit to keep, null or empty string to clear. */
  csProviderOverride?: InputMaybe<Scalars['String']['input']>;
  /** CS enabled flag. Omit to keep, null to clear to false, true/false to set. */
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** Escalation channel ID. Omit to keep, null or empty string to clear. */
  escalationChannelId?: InputMaybe<Scalars['String']['input']>;
  /** Escalation recipient ID. Omit to keep, null or empty string to clear. */
  escalationRecipientId?: InputMaybe<Scalars['String']['input']>;
  /** RunProfile ID for CS. Omit to keep, null or empty string to clear. */
  runProfileId?: InputMaybe<Scalars['String']['input']>;
}

/** Authentication response with JWT tokens */
export interface AuthPayload {
  accessToken: Scalars['String']['output'];
  refreshToken: Scalars['String']['output'];
  user: MeResponse;
}

/** Isolated browser profile for multi-profile agent sessions */
export interface BrowserProfile {
  createdAt: Scalars['DateTimeISO']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  proxyPolicy: BrowserProfileProxyPolicy;
  sessionStatePolicy: BrowserProfileSessionStatePolicy;
  status: BrowserProfileStatus;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
}

/** Browser profile management action */
export const BrowserProfileAction = {
  Archive: 'ARCHIVE',
  BatchDelete: 'BATCH_DELETE',
  Create: 'CREATE',
  Delete: 'DELETE',
  Update: 'UPDATE'
} as const;

export type BrowserProfileAction = typeof BrowserProfileAction[keyof typeof BrowserProfileAction];
/** Actions recorded in browser profile audit log */
export const BrowserProfileAuditAction = {
  Archived: 'ARCHIVED',
  Created: 'CREATED',
  Deleted: 'DELETED',
  Unarchived: 'UNARCHIVED',
  Updated: 'UPDATED'
} as const;

export type BrowserProfileAuditAction = typeof BrowserProfileAuditAction[keyof typeof BrowserProfileAuditAction];
/** Audit log entry for a browser profile action */
export interface BrowserProfileAuditEntry {
  action: BrowserProfileAuditAction;
  createdAt: Scalars['DateTimeISO']['output'];
  /** JSON-encoded detail payload */
  details?: Maybe<Scalars['String']['output']>;
  profileId: Scalars['String']['output'];
  userId: Scalars['String']['output'];
}

/** Result of a browser profile management operation */
export interface BrowserProfileManageResult {
  /** JSON-serialized result data (profile object, count, etc.) */
  data?: Maybe<Scalars['String']['output']>;
  ok: Scalars['Boolean']['output'];
}

/** Proxy configuration for a browser profile */
export interface BrowserProfileProxyPolicy {
  /** Proxy authentication string — NOT stored directly, reference to secret store */
  auth?: Maybe<Scalars['String']['output']>;
  baseUrl?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
}

/** Session state persistence policy for a browser profile */
export interface BrowserProfileSessionStatePolicy {
  checkpointIntervalSec: Scalars['Float']['output'];
  enabled: Scalars['Boolean']['output'];
  mode: Scalars['String']['output'];
  storage: Scalars['String']['output'];
}

/** Lifecycle status of a browser profile */
export const BrowserProfileStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED',
  Disabled: 'DISABLED'
} as const;

export type BrowserProfileStatus = typeof BrowserProfileStatus[keyof typeof BrowserProfileStatus];
/** Filter input for listing browser profiles */
export interface BrowserProfilesFilterInput {
  /** Filter by name prefixes */
  namePrefixes?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Free-text search query against profile name */
  query?: InputMaybe<Scalars['String']['input']>;
  /** Filter by status values */
  status?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Filter by tags (profiles matching ANY of these tags) */
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
}

/** Pagination input for listing browser profiles */
export interface BrowserProfilesPaginationInput {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}

/** Captcha challenge response */
export interface CaptchaResponse {
  svg: Scalars['String']['output'];
  token: Scalars['String']['output'];
}

/** Input for creating a new RunProfile */
export interface CreateRunProfileInput {
  name: Scalars['String']['input'];
  selectedToolIds: Array<Scalars['String']['input']>;
  surfaceId: Scalars['String']['input'];
}

/** Input for creating a new Surface */
export interface CreateSurfaceInput {
  allowedToolIds: Array<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
}

/** Result of getting or creating a CS session */
export interface CsSessionResult {
  balance: Scalars['Int']['output'];
  isNew: Scalars['Boolean']['output'];
  sessionId: Scalars['String']['output'];
}

/** Supported payment currencies */
export const Currency = {
  Cny: 'CNY',
  Usd: 'USD'
} as const;

export type Currency = typeof Currency[keyof typeof Currency];
/** Customer service billing/quota state (system-managed) */
export interface CustomerServiceBilling {
  balance: Scalars['Int']['output'];
  balanceExpiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
  periodEnd?: Maybe<Scalars['DateTimeISO']['output']>;
  tier?: Maybe<Scalars['String']['output']>;
}

/** A CS conversation between buyer and seller */
export interface CustomerServiceConversation {
  /** Whether the seller can send messages in this conversation */
  canSendMessage?: Maybe<Scalars['Boolean']['output']>;
  conversationId: Scalars['String']['output'];
  /** Unix seconds when the conversation was created */
  createTime?: Maybe<Scalars['Int']['output']>;
  latestMessage?: Maybe<CustomerServiceMessagePreview>;
  /** Unix seconds of last update */
  latestMessageTime?: Maybe<Scalars['Int']['output']>;
  /** Associated order ID if any */
  orderId?: Maybe<Scalars['String']['output']>;
  /** Number of participants in the conversation */
  participantCount?: Maybe<Scalars['Int']['output']>;
  participants?: Maybe<Array<CustomerServiceConversationParticipant>>;
  /** Conversation status per platform */
  status?: Maybe<Scalars['String']['output']>;
  unreadCount?: Maybe<Scalars['Int']['output']>;
}

/** Conversation details: the full conversation entity plus a normalized buyer participant slice for convenience. */
export interface CustomerServiceConversationDetails {
  /** The buyer participant, if resolvable from the conversation's participant list. */
  buyer?: Maybe<CustomerServiceConversationParticipant>;
  conversation: CustomerServiceConversation;
}

/** Participant in a CS conversation */
export interface CustomerServiceConversationParticipant {
  avatar?: Maybe<Scalars['String']['output']>;
  /** IM-specific user ID (may differ from userId on some platforms) */
  imUserId?: Maybe<Scalars['String']['output']>;
  nickname?: Maybe<Scalars['String']['output']>;
  /** BUYER, SELLER, SYSTEM, ROBOT */
  role?: Maybe<Scalars['String']['output']>;
  /** Platform user ID for this participant */
  userId?: Maybe<Scalars['String']['output']>;
}

/** A customer service conversation, trimmed for agent-facing tool output. */
export interface CustomerServiceConversationSummary {
  /** Display nickname of the buyer (extracted from participants[]) */
  buyerNickname?: Maybe<Scalars['String']['output']>;
  /** Platform user ID of the buyer participant (extracted from participants[]) */
  buyerUserId?: Maybe<Scalars['String']['output']>;
  conversationId: Scalars['String']['output'];
  /** Human-readable preview of the latest message (TEXT unwrapped from JSON wire format) */
  latestMessagePreview?: Maybe<Scalars['String']['output']>;
  /** Unix seconds of last update */
  latestMessageTime?: Maybe<Scalars['Int']['output']>;
  /** Role of the latest message's sender (BUYER / SHOP / CUSTOMER_SERVICE / SYSTEM / ROBOT) */
  latestSenderRole?: Maybe<Scalars['String']['output']>;
  /** Associated order ID if the conversation is anchored to an order */
  orderId?: Maybe<Scalars['String']['output']>;
  unreadCount?: Maybe<Scalars['Int']['output']>;
}

/** Create conversation result */
export interface CustomerServiceCreateConversationResult {
  conversationId: Scalars['String']['output'];
}

/** Preview of the latest message in a conversation */
export interface CustomerServiceMessagePreview {
  /** JSON-stringified message content per message type */
  content?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  messageId?: Maybe<Scalars['String']['output']>;
  sender?: Maybe<CustomerServiceConversationParticipant>;
  /** Message type (TEXT, IMAGE, ...) — see EcomMessageType */
  type?: Maybe<Scalars['String']['output']>;
}

/** Sender of a customer service message */
export interface CustomerServiceMessageSender {
  /** Display name. For shops, the shop name; for CS agents, the agent name; for buyers, their TikTok nickname. */
  nickname?: Maybe<Scalars['String']['output']>;
  /** BUYER, SHOP, CUSTOMER_SERVICE, SYSTEM, ROBOT */
  role?: Maybe<Scalars['String']['output']>;
}

/** A message in a CS conversation, trimmed for agent-facing tool output. */
export interface CustomerServiceMessageSummary {
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  sender?: Maybe<CustomerServiceMessageSender>;
  /** Human-readable message body. For TEXT messages the JSON wire content (`{"content":"..."}`) is unwrapped to the inner string. For rich cards (PRODUCT_CARD / ORDER_CARD / LOGISTICS_CARD) this is the platform-provided plaintext summary when available, otherwise the raw content string. */
  text?: Maybe<Scalars['String']['output']>;
  /** Message type (TEXT, IMAGE, PRODUCT_CARD, ORDER_CARD, LOGISTICS_CARD, etc.) */
  type?: Maybe<Scalars['String']['output']>;
}

/** Page of customer service message summaries */
export interface CustomerServiceMessageSummaryPage {
  items: Array<CustomerServiceMessageSummary>;
  /** Pagination cursor — pass back to fetch the next page */
  nextPageToken?: Maybe<Scalars['String']['output']>;
}

/** Scan result of CS conversations needing a seller reply. Not a paginated page — items is the complete scan output, capped by the platform's 24-hour SLA window. */
export interface CustomerServicePendingConversationsResult {
  items: Array<CustomerServiceConversationSummary>;
  /** True when the scan aborted mid-way due to an API error or internal max-page cap. Results returned are still valid but may be incomplete. */
  partial?: Maybe<Scalars['Boolean']['output']>;
}

/** Customer service performance metrics */
export interface CustomerServicePerformance {
  /** Average first-response time in minutes across chat support sessions in the window, as a string (e.g. '3.4'). */
  avgFirstResponseTimeMins?: Maybe<Scalars['String']['output']>;
  /** Conversion rate as a percentage string (e.g. '66.67') */
  conversionRate?: Maybe<Scalars['String']['output']>;
  /** CS-guided GMV as a decimal string (e.g. '36500') */
  csGuidedGmv?: Maybe<Scalars['String']['output']>;
  /** Currency code for GMV (e.g. 'USD') */
  currency?: Maybe<Scalars['String']['output']>;
  /** Shop-local date for this CS performance row (YYYY-MM-DD) */
  dateKey?: Maybe<Scalars['String']['output']>;
  /** Exclusive end of the reported window (YYYY-MM-DD), injected from request params */
  endDate?: Maybe<Scalars['String']['output']>;
  /** Percentage of chat support sessions in the window whose first response happened within 24 hours, as a percentage string (e.g. '93.4'). Sessions started during vacation mode are excluded. Automated replies (FAQ cards) count as a response. */
  firstResponseRatePercent?: Maybe<Scalars['String']['output']>;
  /** Customer satisfaction as a percentage string (e.g. '95.2') */
  satisfactionPercentage?: Maybe<Scalars['String']['output']>;
  /** Start of the reported window (YYYY-MM-DD), injected from request params */
  startDate?: Maybe<Scalars['String']['output']>;
  /** Number of support sessions in the window */
  supportSessionCount?: Maybe<Scalars['Int']['output']>;
}

/** Send message result */
export interface CustomerServiceSendMessageResult {
  /** Platform message ID of the sent message, if returned */
  messageId?: Maybe<Scalars['String']['output']>;
}

/** Customer service support session */
export interface CustomerServiceSession {
  /** Unix seconds when the session began */
  beginTime?: Maybe<Scalars['Int']['output']>;
  /** Buyer's nickname */
  buyerNickname?: Maybe<Scalars['String']['output']>;
  /** Chat tags such as AfterSale, Logistics, or Presale */
  chatTags?: Maybe<Array<Scalars['String']['output']>>;
  /** Associated conversation ID */
  conversationId?: Maybe<Scalars['String']['output']>;
  /** Reason for low satisfaction, localized by the request locale */
  dissatisfactionReason?: Maybe<Scalars['String']['output']>;
  /** Unix seconds when the session ended */
  endTime?: Maybe<Scalars['Int']['output']>;
  /** Customer satisfaction score (for example 1-5) */
  satisfactionScore?: Maybe<Scalars['Int']['output']>;
  sessionId: Scalars['String']['output'];
}

/** Page of customer service support sessions */
export interface CustomerServiceSessionPage {
  items: Array<CustomerServiceSession>;
  nextPageToken?: Maybe<Scalars['String']['output']>;
}

/** Customer service settings per shop (user-configurable) */
export interface CustomerServiceSettings {
  businessPrompt?: Maybe<Scalars['String']['output']>;
  csDeviceId?: Maybe<Scalars['String']['output']>;
  /** LLM model override for CS sessions (e.g. 'glm-5'). Null = use default model. */
  csModelOverride?: Maybe<Scalars['String']['output']>;
  /** LLM provider override for CS sessions (e.g. 'zhipu'). Null = use default provider. */
  csProviderOverride?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  /** Channel ID for escalation messages. Null = not configured. */
  escalationChannelId?: Maybe<Scalars['String']['output']>;
  /** Recipient ID for escalation messages. Null = not configured. */
  escalationRecipientId?: Maybe<Scalars['String']['output']>;
  /** Platform-managed CS system prompt (same for all shops on this backend version; versioned by EasyClaw operators). Returns null when no platform prompt is configured. Clients compose this with `businessPrompt` locally via the shared `assembleCsPrompt` helper. */
  platformSystemPrompt?: Maybe<Scalars['String']['output']>;
  /** RunProfile ID for CS agent sessions */
  runProfileId?: Maybe<Scalars['String']['output']>;
}

/** Full CS settings including device-level fields (Panel/backend use) */
export interface CustomerServiceSettingsInput {
  /** Store instructions. Omit to keep, null or empty string to clear. */
  businessPrompt?: InputMaybe<Scalars['String']['input']>;
  /** Device ID (machine fingerprint) of the desktop instance handling CS. Set by desktop app via Panel UI. Null = no device assigned. */
  csDeviceId?: InputMaybe<Scalars['String']['input']>;
  /** CS model override. Omit to keep, null or empty string to clear. */
  csModelOverride?: InputMaybe<Scalars['String']['input']>;
  /** CS provider override. Omit to keep, null or empty string to clear. */
  csProviderOverride?: InputMaybe<Scalars['String']['input']>;
  /** CS enabled flag. Omit to keep, null to clear to false, true/false to set. */
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** Escalation channel ID. Omit to keep, null or empty string to clear. */
  escalationChannelId?: InputMaybe<Scalars['String']['input']>;
  /** Escalation recipient ID. Omit to keep, null or empty string to clear. */
  escalationRecipientId?: InputMaybe<Scalars['String']['input']>;
  /** RunProfile ID for CS. Omit to keep, null or empty string to clear. */
  runProfileId?: InputMaybe<Scalars['String']['input']>;
}

/** Aftersale eligibility for an order */
export interface EcomAftersaleEligibility {
  skuEligibility?: Maybe<Array<EcomAftersaleSkuEligibility>>;
}

/** Eligibility for a single request type on a SKU */
export interface EcomAftersaleLineItemEligibility {
  eligible?: Maybe<Scalars['Boolean']['output']>;
  ineligibleCode?: Maybe<Scalars['Int']['output']>;
  ineligibleReason?: Maybe<Scalars['String']['output']>;
  orderLineItemIds?: Maybe<Array<Scalars['String']['output']>>;
  /** RETURN_AND_REFUND, REFUND, CANCEL */
  requestType?: Maybe<Scalars['String']['output']>;
}

/** Per-SKU eligibility matrix for an order */
export interface EcomAftersaleSkuEligibility {
  lineItemEligibility?: Maybe<Array<EcomAftersaleLineItemEligibility>>;
  skuId?: Maybe<Scalars['String']['output']>;
}

/** Money value used by ecommerce analytics metrics */
export interface EcomAnalyticsMoney {
  amount?: Maybe<Scalars['String']['output']>;
  currency?: Maybe<Scalars['String']['output']>;
}

/** Decision for approving a refund request */
export const EcomApproveRefundDecision = {
  ApproveRefund: 'APPROVE_REFUND',
  IssueReplacementRefund: 'ISSUE_REPLACEMENT_REFUND',
  OfferPartialRefund: 'OFFER_PARTIAL_REFUND'
} as const;

export type EcomApproveRefundDecision = typeof EcomApproveRefundDecision[keyof typeof EcomApproveRefundDecision];
/** Decision for approving a return request */
export const EcomApproveReturnDecision = {
  ApproveReceivedPackage: 'APPROVE_RECEIVED_PACKAGE',
  ApproveReplacement: 'APPROVE_REPLACEMENT',
  ApproveReturn: 'APPROVE_RETURN'
} as const;

export type EcomApproveReturnDecision = typeof EcomApproveReturnDecision[keyof typeof EcomApproveReturnDecision];
/** Cancellation status filter for searching cancellations */
export const EcomCancelStatusFilter = {
  All: 'ALL',
  CancellationRequestCancel: 'CANCELLATION_REQUEST_CANCEL',
  CancellationRequestComplete: 'CANCELLATION_REQUEST_COMPLETE',
  CancellationRequestPending: 'CANCELLATION_REQUEST_PENDING',
  CancellationRequestSuccess: 'CANCELLATION_REQUEST_SUCCESS'
} as const;

export type EcomCancelStatusFilter = typeof EcomCancelStatusFilter[keyof typeof EcomCancelStatusFilter];
/** Cancellation type filter for searching cancellations */
export const EcomCancelTypeFilter = {
  All: 'ALL',
  BuyerCancel: 'BUYER_CANCEL',
  Cancel: 'CANCEL'
} as const;

export type EcomCancelTypeFilter = typeof EcomCancelTypeFilter[keyof typeof EcomCancelTypeFilter];
/** Buyer- or system-initiated order cancellation request */
export interface EcomCancellation {
  cancelId: Scalars['String']['output'];
  cancelReason?: Maybe<Scalars['String']['output']>;
  cancelReasonText?: Maybe<Scalars['String']['output']>;
  cancelStatus?: Maybe<Scalars['String']['output']>;
  /** BUYER_CANCEL, CANCEL */
  cancelType?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  lineItems?: Maybe<Array<EcomCancellationLineItem>>;
  orderId?: Maybe<Scalars['String']['output']>;
  refundAmount?: Maybe<EcomRefundAmount>;
  role?: Maybe<Scalars['String']['output']>;
  shouldReplenishStock?: Maybe<Scalars['Boolean']['output']>;
  /** Unix seconds */
  updateTime?: Maybe<Scalars['Int']['output']>;
}

/** Cancellation line item */
export interface EcomCancellationLineItem {
  cancelLineItemId?: Maybe<Scalars['String']['output']>;
  orderLineItemId?: Maybe<Scalars['String']['output']>;
  productImage?: Maybe<EcomImage>;
  productName?: Maybe<Scalars['String']['output']>;
  refundAmount?: Maybe<EcomRefundAmount>;
  sellerSku?: Maybe<Scalars['String']['output']>;
  skuId?: Maybe<Scalars['String']['output']>;
  skuName?: Maybe<Scalars['String']['output']>;
}

/** Shipping document format */
export const EcomDocumentFormat = {
  Pdf: 'PDF',
  Zpl: 'ZPL'
} as const;

export type EcomDocumentFormat = typeof EcomDocumentFormat[keyof typeof EcomDocumentFormat];
/** Shipping document size */
export const EcomDocumentSize = {
  A5: 'A5',
  A6: 'A6'
} as const;

export type EcomDocumentSize = typeof EcomDocumentSize[keyof typeof EcomDocumentSize];
/** Shipping document type */
export const EcomDocumentType = {
  HazmatLabel: 'HAZMAT_LABEL',
  InvoiceLabel: 'INVOICE_LABEL',
  PackingSlip: 'PACKING_SLIP',
  ShippingLabel: 'SHIPPING_LABEL',
  ShippingLabelAndPackingSlip: 'SHIPPING_LABEL_AND_PACKING_SLIP',
  ShippingLabelPicture: 'SHIPPING_LABEL_PICTURE'
} as const;

export type EcomDocumentType = typeof EcomDocumentType[keyof typeof EcomDocumentType];
/** Image with dimensions */
export interface EcomImage {
  height?: Maybe<Scalars['Int']['output']>;
  url?: Maybe<Scalars['String']['output']>;
  width?: Maybe<Scalars['Int']['output']>;
}

/** Message content type for CS conversations */
export const EcomMessageType = {
  CouponCard: 'COUPON_CARD',
  Image: 'IMAGE',
  LogisticsCard: 'LOGISTICS_CARD',
  OrderCard: 'ORDER_CARD',
  ProductCard: 'PRODUCT_CARD',
  Text: 'TEXT',
  Video: 'VIDEO'
} as const;

export type EcomMessageType = typeof EcomMessageType[keyof typeof EcomMessageType];
/** Order */
export interface EcomOrder {
  /** Platform buyer user ID */
  buyerUserId?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  currency?: Maybe<Scalars['String']['output']>;
  lineItems?: Maybe<Array<EcomOrderLineItem>>;
  orderId: Scalars['String']['output'];
  /** Unix seconds */
  paidTime?: Maybe<Scalars['Int']['output']>;
  paymentMethodName?: Maybe<Scalars['String']['output']>;
  recipientAddress?: Maybe<EcomRecipientAddress>;
  shippingProvider?: Maybe<Scalars['String']['output']>;
  /** Raw platform order status (e.g. AWAITING_SHIPMENT) */
  status?: Maybe<Scalars['String']['output']>;
  totalAmount?: Maybe<Scalars['String']['output']>;
  trackingNumber?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  updateTime?: Maybe<Scalars['Int']['output']>;
}

/** Line item on an order */
export interface EcomOrderLineItem {
  currency?: Maybe<Scalars['String']['output']>;
  /** Per-line item status */
  displayStatus?: Maybe<Scalars['String']['output']>;
  /** Unique ID of this order line item */
  orderLineItemId?: Maybe<Scalars['String']['output']>;
  originalPrice?: Maybe<Scalars['String']['output']>;
  productId?: Maybe<Scalars['String']['output']>;
  productName?: Maybe<Scalars['String']['output']>;
  quantity?: Maybe<Scalars['Int']['output']>;
  salePrice?: Maybe<Scalars['String']['output']>;
  sellerSku?: Maybe<Scalars['String']['output']>;
  skuId?: Maybe<Scalars['String']['output']>;
  skuImage?: Maybe<Scalars['String']['output']>;
  skuName?: Maybe<Scalars['String']['output']>;
}

/** Order status filter. Use ALL to return all statuses. */
export const EcomOrderStatus = {
  All: 'ALL',
  AwaitingCollection: 'AWAITING_COLLECTION',
  AwaitingShipment: 'AWAITING_SHIPMENT',
  Cancelled: 'CANCELLED',
  Completed: 'COMPLETED',
  Delivered: 'DELIVERED',
  InTransit: 'IN_TRANSIT',
  OnHold: 'ON_HOLD',
  PartiallyShipping: 'PARTIALLY_SHIPPING',
  Unpaid: 'UNPAID'
} as const;

export type EcomOrderStatus = typeof EcomOrderStatus[keyof typeof EcomOrderStatus];
/** Trimmed order summary for list endpoints. Use ecommerceGetOrder for full details including recipient address and line items. */
export interface EcomOrderSummary {
  /** Platform buyer user ID */
  buyerUserId?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  currency?: Maybe<Scalars['String']['output']>;
  orderId: Scalars['String']['output'];
  /** Unix seconds */
  paidTime?: Maybe<Scalars['Int']['output']>;
  shippingProvider?: Maybe<Scalars['String']['output']>;
  /** Raw platform order status (e.g. AWAITING_SHIPMENT) */
  status?: Maybe<Scalars['String']['output']>;
  totalAmount?: Maybe<Scalars['String']['output']>;
  trackingNumber?: Maybe<Scalars['String']['output']>;
}

/** Tracking info for an order */
export interface EcomOrderTracking {
  events?: Maybe<Array<EcomTrackingEvent>>;
  /** Human-readable description of the most recent tracking event — the `description` of the entry with the greatest `updateTimeMillis` in `events`. This is free-form carrier text (e.g. "Order packed and ready for pickup."), not a standardized status enum. TikTok does not expose a separate status enum on either tracking endpoint. */
  latestEventDescription?: Maybe<Scalars['String']['output']>;
  orderId?: Maybe<Scalars['String']['output']>;
  /** Name of the shipping carrier (e.g. 'USPS', 'FedEx'). Sourced from the order record (Get Order) and composed in at Layer 2. */
  shippingProvider?: Maybe<Scalars['String']['output']>;
  /** Carrier tracking number. Sourced from the order record (Get Order) and composed into this tracking payload at Layer 2 — the TikTok Get Tracking endpoint does not return it. */
  trackingNumber?: Maybe<Scalars['String']['output']>;
}

/** Fulfillment package (search hit) */
export interface EcomPackage {
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  /** Order IDs contained in this package */
  orderIds?: Maybe<Array<Scalars['String']['output']>>;
  packageId: Scalars['String']['output'];
  /** Raw platform package status */
  packageStatus?: Maybe<Scalars['String']['output']>;
  shippingProvider?: Maybe<Scalars['String']['output']>;
  trackingNumber?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  updateTime?: Maybe<Scalars['Int']['output']>;
}

/** Detailed package info */
export interface EcomPackageDetail {
  hasMultiSkus?: Maybe<Scalars['Boolean']['output']>;
  orders?: Maybe<Array<EcomPackageOrder>>;
  packageId: Scalars['String']['output'];
  packageStatus?: Maybe<Scalars['String']['output']>;
  packageSubStatus?: Maybe<Scalars['String']['output']>;
  splitAndCombineTag?: Maybe<Scalars['String']['output']>;
}

/** Order contained in a package */
export interface EcomPackageOrder {
  /** Unique ID of this order */
  orderId: Scalars['String']['output'];
  skus?: Maybe<Array<EcomPackageSku>>;
}

/** SKU contained in a package */
export interface EcomPackageSku {
  name?: Maybe<Scalars['String']['output']>;
  quantity?: Maybe<Scalars['Int']['output']>;
  /** Unique ID of this SKU */
  skuId?: Maybe<Scalars['String']['output']>;
}

/** Package status filter. Use ALL to return all statuses. */
export const EcomPackageStatus = {
  All: 'ALL',
  Cancelled: 'CANCELLED',
  Completed: 'COMPLETED',
  Fulfilling: 'FULFILLING',
  Processing: 'PROCESSING'
} as const;

export type EcomPackageStatus = typeof EcomPackageStatus[keyof typeof EcomPackageStatus];
/** Product */
export interface EcomProduct {
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  images?: Maybe<Array<EcomImage>>;
  productId: Scalars['String']['output'];
  skus?: Maybe<Array<EcomProductSku>>;
  status?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  updateTime?: Maybe<Scalars['Int']['output']>;
}

/** Product SKU */
export interface EcomProductSku {
  externalListPrices?: Maybe<Array<EcomProductSkuExternalListPrice>>;
  fees?: Maybe<Array<EcomProductSkuFee>>;
  /** Unique ID of this SKU */
  id: Scalars['String']['output'];
  inventory?: Maybe<Array<EcomProductSkuInventory>>;
  listPrice?: Maybe<EcomProductSkuMoney>;
  preSale?: Maybe<EcomProductSkuPreSale>;
  price?: Maybe<EcomProductSkuPrice>;
  sellerSku?: Maybe<Scalars['String']['output']>;
  statusInfo?: Maybe<EcomProductSkuStatusInfo>;
}

/** Currency used by TikTok Shop product SKU pricing fields. */
export const EcomProductSkuCurrency = {
  Brl: 'BRL',
  Eur: 'EUR',
  Gbp: 'GBP',
  Idr: 'IDR',
  Jpy: 'JPY',
  Mxn: 'MXN',
  Myr: 'MYR',
  Php: 'PHP',
  Sgd: 'SGD',
  Thb: 'THB',
  Usd: 'USD',
  Vnd: 'VND'
} as const;

export type EcomProductSkuCurrency = typeof EcomProductSkuCurrency[keyof typeof EcomProductSkuCurrency];
/** Source that deactivated a product SKU. */
export const EcomProductSkuDeactivationSource = {
  ComboRelation: 'COMBO_RELATION',
  Platform: 'PLATFORM',
  Seller: 'SELLER'
} as const;

export type EcomProductSkuDeactivationSource = typeof EcomProductSkuDeactivationSource[keyof typeof EcomProductSkuDeactivationSource];
/** External list price attached to a product SKU */
export interface EcomProductSkuExternalListPrice {
  amount?: Maybe<Scalars['String']['output']>;
  currency?: Maybe<EcomProductSkuCurrency>;
  source?: Maybe<EcomProductSkuExternalListPriceSource>;
}

/** External platform source for a SKU external list price. */
export const EcomProductSkuExternalListPriceSource = {
  ShopifyCompareAtPrice: 'SHOPIFY_COMPARE_AT_PRICE'
} as const;

export type EcomProductSkuExternalListPriceSource = typeof EcomProductSkuExternalListPriceSource[keyof typeof EcomProductSkuExternalListPriceSource];
/** Platform fee attached to a product SKU */
export interface EcomProductSkuFee {
  additionalAttribute?: Maybe<EcomProductSkuFeeAdditionalAttribute>;
  amount?: Maybe<Scalars['String']['output']>;
  type?: Maybe<EcomProductSkuFeeType>;
}

/** Additional attribute for a product SKU fee. */
export const EcomProductSkuFeeAdditionalAttribute = {
  NotApplicable: 'NOT_APPLICABLE',
  Reusable: 'REUSABLE',
  SingleUse: 'SINGLE_USE'
} as const;

export type EcomProductSkuFeeAdditionalAttribute = typeof EcomProductSkuFeeAdditionalAttribute[keyof typeof EcomProductSkuFeeAdditionalAttribute];
/** Fee type attached to a product SKU. */
export const EcomProductSkuFeeType = {
  Pfand: 'PFAND'
} as const;

export type EcomProductSkuFeeType = typeof EcomProductSkuFeeType[keyof typeof EcomProductSkuFeeType];
/** Inventory entry for a product SKU in a warehouse */
export interface EcomProductSkuInventory {
  backorderQuantity?: Maybe<Scalars['Int']['output']>;
  handlingTime?: Maybe<Scalars['Int']['output']>;
  quantity?: Maybe<Scalars['Int']['output']>;
  warehouseId?: Maybe<Scalars['String']['output']>;
}

/** Price-like amount with currency for product SKU fields */
export interface EcomProductSkuMoney {
  amount?: Maybe<Scalars['String']['output']>;
  currency?: Maybe<EcomProductSkuCurrency>;
}

/** Pre-sale settings for a product SKU */
export interface EcomProductSkuPreSale {
  fulfillmentType?: Maybe<EcomProductSkuPreSaleFulfillmentType>;
  type?: Maybe<EcomProductSkuPreSaleType>;
}

/** Pre-sale fulfillment settings for a product SKU */
export interface EcomProductSkuPreSaleFulfillmentType {
  handlingDurationDays?: Maybe<Scalars['Int']['output']>;
  /** Unix seconds */
  releaseDate?: Maybe<Scalars['Int']['output']>;
}

/** Pre-sale type for a product SKU. */
export const EcomProductSkuPreSaleType = {
  Custom: 'CUSTOM',
  MadeToOrder: 'MADE_TO_ORDER',
  PreOrder: 'PRE_ORDER'
} as const;

export type EcomProductSkuPreSaleType = typeof EcomProductSkuPreSaleType[keyof typeof EcomProductSkuPreSaleType];
/** Detailed price breakdown for a product SKU */
export interface EcomProductSkuPrice {
  currency?: Maybe<EcomProductSkuCurrency>;
  salePrice?: Maybe<Scalars['String']['output']>;
  taxExclusivePrice?: Maybe<Scalars['String']['output']>;
}

/** Lifecycle status for a product SKU. */
export const EcomProductSkuStatus = {
  Deactivated: 'DEACTIVATED',
  Normal: 'NORMAL'
} as const;

export type EcomProductSkuStatus = typeof EcomProductSkuStatus[keyof typeof EcomProductSkuStatus];
/** Status metadata for a product SKU */
export interface EcomProductSkuStatusInfo {
  deactivationSource?: Maybe<EcomProductSkuDeactivationSource>;
  status?: Maybe<EcomProductSkuStatus>;
}

/** Trimmed product SKU summary for list endpoints. Use ecommerceGetProduct for the full product payload. */
export interface EcomProductSkuSummary {
  currency?: Maybe<EcomProductSkuCurrency>;
  price?: Maybe<Scalars['String']['output']>;
  sellerSku?: Maybe<Scalars['String']['output']>;
  /** Unique ID of this SKU */
  skuId: Scalars['String']['output'];
  /** Summary label for the SKU. Derived from sellerSku for list/search output. */
  skuName?: Maybe<Scalars['String']['output']>;
  stockQuantity?: Maybe<Scalars['Int']['output']>;
}

/** Product status filter. Use ALL to return all statuses. */
export const EcomProductStatus = {
  Activate: 'ACTIVATE',
  All: 'ALL',
  Deleted: 'DELETED',
  Draft: 'DRAFT',
  Failed: 'FAILED',
  Freeze: 'FREEZE',
  Pending: 'PENDING',
  PlatformDeactivated: 'PLATFORM_DEACTIVATED',
  SellerDeactivated: 'SELLER_DEACTIVATED'
} as const;

export type EcomProductStatus = typeof EcomProductStatus[keyof typeof EcomProductStatus];
/** Trimmed product summary for list endpoints. Use ecommerceGetProduct for full details including images. */
export interface EcomProductSummary {
  /** URL of the first product image (the listing cover). Derived from images[0].url — use ecommerceGetProduct for the full image set. */
  coverImage?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  /** Highest SKU price across the product's variants, formatted to two decimals (e.g. '29.00'). Omitted when no SKU has a numeric price. */
  priceMax?: Maybe<Scalars['String']['output']>;
  /** Lowest SKU price across the product's variants, formatted to two decimals (e.g. '10.00'). Omitted when no SKU has a numeric price. When only one SKU exists, priceMin === priceMax. */
  priceMin?: Maybe<Scalars['String']['output']>;
  productId: Scalars['String']['output'];
  skus?: Maybe<Array<EcomProductSkuSummary>>;
  status?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  updateTime?: Maybe<Scalars['Int']['output']>;
}

/** Shipping address on an order */
export interface EcomRecipientAddress {
  city?: Maybe<Scalars['String']['output']>;
  district?: Maybe<Scalars['String']['output']>;
  fullAddress?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  phone?: Maybe<Scalars['String']['output']>;
  postalCode?: Maybe<Scalars['String']['output']>;
  region?: Maybe<Scalars['String']['output']>;
}

/** Refund amount breakdown */
export interface EcomRefundAmount {
  currency?: Maybe<Scalars['String']['output']>;
  refundShippingFee?: Maybe<Scalars['String']['output']>;
  refundSubtotal?: Maybe<Scalars['String']['output']>;
  refundTax?: Maybe<Scalars['String']['output']>;
  refundTotal?: Maybe<Scalars['String']['output']>;
}

/** A reject reason option for a return / cancellation */
export interface EcomRejectReason {
  reasonId?: Maybe<Scalars['String']['output']>;
  reasonText?: Maybe<Scalars['String']['output']>;
}

/** Buyer-initiated return / refund / replacement request */
export interface EcomReturn {
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  handoverMethod?: Maybe<Scalars['String']['output']>;
  isQuickRefund?: Maybe<Scalars['Boolean']['output']>;
  lineItems?: Maybe<Array<EcomReturnLineItem>>;
  orderId?: Maybe<Scalars['String']['output']>;
  refundAmount?: Maybe<EcomRefundAmount>;
  returnId: Scalars['String']['output'];
  returnMethod?: Maybe<Scalars['String']['output']>;
  returnReason?: Maybe<Scalars['String']['output']>;
  returnReasonText?: Maybe<Scalars['String']['output']>;
  /** e.g. AWAITING_BUYER_SHIP */
  returnStatus?: Maybe<Scalars['String']['output']>;
  returnTrackingNumber?: Maybe<Scalars['String']['output']>;
  /** RETURN_AND_REFUND, REFUND_ONLY, REPLACE */
  returnType?: Maybe<Scalars['String']['output']>;
  /** Who filed the request: BUYER / SELLER / SYSTEM */
  role?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  updateTime?: Maybe<Scalars['Int']['output']>;
}

/** Return line item (the SKUs the buyer is returning) */
export interface EcomReturnLineItem {
  orderLineItemId?: Maybe<Scalars['String']['output']>;
  productImage?: Maybe<EcomImage>;
  productName?: Maybe<Scalars['String']['output']>;
  refundAmount?: Maybe<EcomRefundAmount>;
  returnLineItemId?: Maybe<Scalars['String']['output']>;
  sellerSku?: Maybe<Scalars['String']['output']>;
  skuId?: Maybe<Scalars['String']['output']>;
  skuName?: Maybe<Scalars['String']['output']>;
}

/** Return audit event */
export interface EcomReturnRecord {
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  /** ORDER_RETURN, SELLER_AGGREE_RETURN, BUYER_RETURN_SHIPPED_TIMEOUT, ... */
  event?: Maybe<Scalars['String']['output']>;
  /** Free-text note left by the actor */
  note?: Maybe<Scalars['String']['output']>;
  reasonText?: Maybe<Scalars['String']['output']>;
  /** BUYER, SELLER, SYSTEM */
  role?: Maybe<Scalars['String']['output']>;
}

/** Return status filter for searching returns */
export const EcomReturnStatusFilter = {
  All: 'ALL',
  AwaitingBuyerResponse: 'AWAITING_BUYER_RESPONSE',
  AwaitingBuyerShip: 'AWAITING_BUYER_SHIP',
  BuyerShippedItem: 'BUYER_SHIPPED_ITEM',
  RefundOrReturnRequestReject: 'REFUND_OR_RETURN_REQUEST_REJECT',
  RejectReceivePackage: 'REJECT_RECEIVE_PACKAGE',
  ReturnOrRefundRequestCancel: 'RETURN_OR_REFUND_REQUEST_CANCEL',
  ReturnOrRefundRequestComplete: 'RETURN_OR_REFUND_REQUEST_COMPLETE',
  ReturnOrRefundRequestPending: 'RETURN_OR_REFUND_REQUEST_PENDING',
  ReturnOrRefundRequestSuccess: 'RETURN_OR_REFUND_REQUEST_SUCCESS'
} as const;

export type EcomReturnStatusFilter = typeof EcomReturnStatusFilter[keyof typeof EcomReturnStatusFilter];
/** Return type filter for searching returns */
export const EcomReturnTypeFilter = {
  All: 'ALL',
  Refund: 'REFUND',
  Replacement: 'REPLACEMENT',
  ReturnAndRefund: 'RETURN_AND_REFUND'
} as const;

export type EcomReturnTypeFilter = typeof EcomReturnTypeFilter[keyof typeof EcomReturnTypeFilter];
/** Shipping document URL */
export interface EcomShippingDocument {
  /** URL of the document (label, packing slip, etc.) */
  docUrl?: Maybe<Scalars['String']['output']>;
  trackingNumber?: Maybe<Scalars['String']['output']>;
}

/** Per-SKU performance metrics for shop analytics */
export interface EcomSkuPerformance {
  /** Shop-local date for this SKU performance row (YYYY-MM-DD) */
  dateKey?: Maybe<Scalars['String']['output']>;
  /** Overall GMV for the SKU */
  gmv?: Maybe<EcomAnalyticsMoney>;
  /** Product ID that owns the SKU */
  productId?: Maybe<Scalars['String']['output']>;
  /** SKU ID */
  skuId: Scalars['String']['output'];
  /** Total orders for the SKU */
  skuOrders?: Maybe<Scalars['Int']['output']>;
  /** Total units sold for the SKU */
  unitsSold?: Maybe<Scalars['Int']['output']>;
}

/** Flat SKU performance result. Serving reads return one row per shop-local date and SKU. */
export interface EcomSkuPerformanceResult {
  /** Per-day per-SKU performance rows */
  items: Array<EcomSkuPerformance>;
  /** Latest date in shop local timezone where platform analytics data is ready (ISO 8601). Only populated for direct platform reads. */
  latestAvailableDate?: Maybe<Scalars['String']['output']>;
  /** Number of rows returned by this query */
  totalCount?: Maybe<Scalars['Int']['output']>;
}

/** Sort field for package search */
export const EcomSortField = {
  CreateTime: 'CREATE_TIME',
  OrderPayTime: 'ORDER_PAY_TIME',
  UpdateTime: 'UPDATE_TIME'
} as const;

export type EcomSortField = typeof EcomSortField[keyof typeof EcomSortField];
/** Sort order */
export const EcomSortOrder = {
  Asc: 'ASC',
  Desc: 'DESC'
} as const;

export type EcomSortOrder = typeof EcomSortOrder[keyof typeof EcomSortOrder];
/** Tracking event */
export interface EcomTrackingEvent {
  description?: Maybe<Scalars['String']['output']>;
  /** Update time in Unix milliseconds (TikTok returns `update_time_millis`; preserved as-is). Float because millis exceed 32-bit Int range. */
  updateTimeMillis?: Maybe<Scalars['Float']['output']>;
}

/** Per-SKU error returned by the inventory update endpoint */
export interface EcomUpdateInventoryError {
  code?: Maybe<Scalars['Int']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  skuId?: Maybe<Scalars['String']['output']>;
  warehouseErrors?: Maybe<Array<EcomUpdateInventoryWarehouseError>>;
}

/** Simplified inventory update request for one SKU */
export interface EcomUpdateInventoryInput {
  /** Desired in-stock quantity for this SKU. The backend expands this into TikTok's warehouse-level payload for single-warehouse SKUs. */
  quantity: Scalars['Int']['input'];
  /** SKU ID to update */
  skuId: Scalars['String']['input'];
}

/** Result of updating product inventory */
export interface EcomUpdateInventoryResult {
  errors?: Maybe<Array<EcomUpdateInventoryError>>;
  message?: Maybe<Scalars['String']['output']>;
  /** Product IDs touched by this request. Multiple products can be updated in one simplified resolver call. */
  productIds?: Maybe<Array<Scalars['String']['output']>>;
  /** True when TikTok reported no per-SKU errors. */
  success: Scalars['Boolean']['output'];
  /** SKU IDs that completed without a SKU-scoped TikTok error. */
  updatedSkuIds?: Maybe<Array<Scalars['String']['output']>>;
}

/** Warehouse-level error returned while updating a SKU's inventory */
export interface EcomUpdateInventoryWarehouseError {
  code?: Maybe<Scalars['Int']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  warehouseId?: Maybe<Scalars['String']['output']>;
}

/** Result of updating a shop through the agent-facing resolver */
export interface EcommerceUpdateShopResult {
  /** Human-readable confirmation message */
  message?: Maybe<Scalars['String']['output']>;
  /** Shop ID that was updated */
  shopId: Scalars['String']['output'];
}

/** Feature entitlement identifiers */
export const EntitlementKey = {
  EcomCsRead: 'ECOM_CS_READ',
  EcomCsWrite: 'ECOM_CS_WRITE',
  EcomFulfillmentRead: 'ECOM_FULFILLMENT_READ',
  EcomProductRead: 'ECOM_PRODUCT_READ',
  EcomProductWrite: 'ECOM_PRODUCT_WRITE',
  EcomReturnRefundRead: 'ECOM_RETURN_REFUND_READ',
  EcomReturnRefundWrite: 'ECOM_RETURN_REFUND_WRITE',
  MultiBrowserProfiles: 'MULTI_BROWSER_PROFILES'
} as const;

export type EntitlementKey = typeof EntitlementKey[keyof typeof EntitlementKey];
export interface GeneratePairingResult {
  code: Scalars['String']['output'];
  qrUrl?: Maybe<Scalars['String']['output']>;
}

/** Image file metadata stored in object storage */
export interface ImageAsset {
  bucket: Scalars['String']['output'];
  createdAt: Scalars['DateTimeISO']['output'];
  deletedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  expiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
  extension: Scalars['String']['output'];
  height?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  linkedEntityId?: Maybe<Scalars['String']['output']>;
  linkedEntityType?: Maybe<Scalars['String']['output']>;
  mimeType: Scalars['String']['output'];
  objectKey: Scalars['String']['output'];
  publicUrl?: Maybe<Scalars['String']['output']>;
  references: Array<ImageAssetReference>;
  sha256: Scalars['String']['output'];
  sizeBytes: Scalars['Int']['output'];
  status: ImageAssetStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  uri: Scalars['String']['output'];
  userId: Scalars['String']['output'];
  width?: Maybe<Scalars['Int']['output']>;
}

/** Entity reference that currently uses an image asset */
export interface ImageAssetReference {
  entityId: Scalars['String']['output'];
  entityType: Scalars['String']['output'];
  linkedAt: Scalars['DateTimeISO']['output'];
}

/** Lifecycle state for a user-uploaded image asset */
export const ImageAssetStatus = {
  Deleted: 'DELETED',
  Permanent: 'PERMANENT',
  Temporary: 'TEMPORARY'
} as const;

export type ImageAssetStatus = typeof ImageAssetStatus[keyof typeof ImageAssetStatus];
/** OAuth initiation response with authorization URL */
export interface InitiateOAuthResponse {
  authUrl: Scalars['String']['output'];
  state: Scalars['String']['output'];
}

/** Dimension unit for inventory goods */
export const InventoryDimensionUnit = {
  Cm: 'CM',
  In: 'IN'
} as const;

export type InventoryDimensionUnit = typeof InventoryDimensionUnit[keyof typeof InventoryDimensionUnit];
/** Canonical merchant-owned stockable inventory item */
export interface InventoryGood {
  barcode?: Maybe<Scalars['String']['output']>;
  countryOfOrigin?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  declaredValue?: Maybe<Scalars['Float']['output']>;
  declaredValueCurrency?: Maybe<Scalars['String']['output']>;
  dimensionUnit?: Maybe<InventoryDimensionUnit>;
  gtin?: Maybe<Scalars['String']['output']>;
  heightValue?: Maybe<Scalars['Float']['output']>;
  hsCode?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  imageAssetId?: Maybe<Scalars['ID']['output']>;
  imageUri?: Maybe<Scalars['String']['output']>;
  isBattery?: Maybe<Scalars['Boolean']['output']>;
  isHazmat?: Maybe<Scalars['Boolean']['output']>;
  lengthValue?: Maybe<Scalars['Float']['output']>;
  name: Scalars['String']['output'];
  /** Merchant-owned stockable SKU. This is matched exactly; the backend does not normalize it. */
  sku: Scalars['String']['output'];
  status: InventoryGoodStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
  weightUnit?: Maybe<InventoryWeightUnit>;
  weightValue?: Maybe<Scalars['Float']['output']>;
  widthValue?: Maybe<Scalars['Float']['output']>;
}

/** Resolution result for an external source SKU against canonical InventoryGood identity */
export interface InventoryGoodIdentityResolution {
  canWrite: Scalars['Boolean']['output'];
  inventoryGood?: Maybe<InventoryGood>;
  mapping?: Maybe<InventoryGoodMapping>;
  reason?: Maybe<Scalars['String']['output']>;
  resolutionType: InventoryGoodIdentityResolutionType;
  sellerSku: Scalars['String']['output'];
  sourceId: Scalars['ID']['output'];
  sourceSystem: InventoryGoodMappingSourceSystem;
}

/** How an external SKU was resolved to a canonical InventoryGood */
export const InventoryGoodIdentityResolutionType = {
  DefaultSku: 'DEFAULT_SKU',
  ExplicitMapping: 'EXPLICIT_MAPPING',
  MappingTargetInvalid: 'MAPPING_TARGET_INVALID',
  NotFound: 'NOT_FOUND',
  UnverifiedMapping: 'UNVERIFIED_MAPPING'
} as const;

export type InventoryGoodIdentityResolutionType = typeof InventoryGoodIdentityResolutionType[keyof typeof InventoryGoodIdentityResolutionType];
/** Sparse override mapping from an external source SKU/unit to a canonical InventoryGood */
export interface InventoryGoodMapping {
  createdAt: Scalars['DateTimeISO']['output'];
  id: Scalars['ID']['output'];
  inventoryGoodId: Scalars['ID']['output'];
  lastSeenAt?: Maybe<Scalars['DateTimeISO']['output']>;
  notes?: Maybe<Scalars['String']['output']>;
  /** External seller SKU or warehouse goods SKU. This is matched exactly; the backend does not normalize it. */
  sellerSku: Scalars['String']['output'];
  /** System-local Mongo ID for the external source connection, such as Shop._id or a WMS connection ID. */
  sourceId: Scalars['ID']['output'];
  sourceSystem: InventoryGoodMappingSourceSystem;
  status: InventoryGoodMappingStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
  verificationStatus: InventoryGoodMappingVerificationStatus;
}

/** External inventory/catalog source system */
export const InventoryGoodMappingSourceSystem = {
  TiktokFbt: 'TIKTOK_FBT',
  TiktokShop: 'TIKTOK_SHOP',
  YejoinWms: 'YEJOIN_WMS'
} as const;

export type InventoryGoodMappingSourceSystem = typeof InventoryGoodMappingSourceSystem[keyof typeof InventoryGoodMappingSourceSystem];
/** Lifecycle state of an external SKU to InventoryGood identity mapping */
export const InventoryGoodMappingStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED'
} as const;

export type InventoryGoodMappingStatus = typeof InventoryGoodMappingStatus[keyof typeof InventoryGoodMappingStatus];
/** Confidence state for an external SKU identity mapping */
export const InventoryGoodMappingVerificationStatus = {
  AutoMatched: 'AUTO_MATCHED',
  Unverified: 'UNVERIFIED',
  UserConfirmed: 'USER_CONFIRMED'
} as const;

export type InventoryGoodMappingVerificationStatus = typeof InventoryGoodMappingVerificationStatus[keyof typeof InventoryGoodMappingVerificationStatus];
/** Lifecycle state of a canonical stockable inventory item */
export const InventoryGoodStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED'
} as const;

export type InventoryGoodStatus = typeof InventoryGoodStatus[keyof typeof InventoryGoodStatus];
/** Weight unit for inventory goods */
export const InventoryWeightUnit = {
  G: 'G',
  Kg: 'KG',
  Lb: 'LB',
  Oz: 'OZ'
} as const;

export type InventoryWeightUnit = typeof InventoryWeightUnit[keyof typeof InventoryWeightUnit];
export interface LlmKey {
  key: Scalars['String']['output'];
  suspendedUntil?: Maybe<Scalars['DateTimeISO']['output']>;
}

export interface LlmQuotaStatus {
  fiveHour: QuotaCircleStatus;
  weekly: QuotaCircleStatus;
}

/** Login input */
export interface LoginInput {
  captchaAnswer: Scalars['String']['input'];
  captchaToken: Scalars['String']['input'];
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
}

/** Current user profile */
export interface MeResponse {
  createdAt: Scalars['DateTimeISO']['output'];
  defaultRunProfileId?: Maybe<Scalars['String']['output']>;
  email: Scalars['String']['output'];
  enrolledModules: Array<ModuleId>;
  entitlementKeys: Array<EntitlementKey>;
  llmKey?: Maybe<LlmKey>;
  name?: Maybe<Scalars['String']['output']>;
  plan: UserPlan;
  userId: Scalars['String']['output'];
}

export interface ModelPricing {
  displayName: Scalars['String']['output'];
  inputPricePerMillion: Scalars['String']['output'];
  modelId: Scalars['String']['output'];
  note?: Maybe<Scalars['String']['output']>;
  outputPricePerMillion: Scalars['String']['output'];
}

/** Product module identifiers */
export const ModuleId = {
  GlobalEcommerceSeller: 'GLOBAL_ECOMMERCE_SELLER'
} as const;

export type ModuleId = typeof ModuleId[keyof typeof ModuleId];
export interface Mutation {
  /** Create a new run profile */
  createRunProfile: RunProfile;
  /** Create a new surface */
  createSurface: Surface;
  /** Get an existing CS session or create a new one for a conversation */
  csGetOrCreateSession: CsSessionResult;
  /** Delete a run profile */
  deleteRunProfile: Scalars['Boolean']['output'];
  /** Delete the session state backup for a profile */
  deleteSessionStateBackup: Scalars['Boolean']['output'];
  /** Disconnect a shop (soft delete — balance preserved for reconnection) */
  deleteShop: Scalars['Boolean']['output'];
  /** Delete a surface */
  deleteSurface: Scalars['Boolean']['output'];
  /** Approve a cancellation request. Returns true on success. */
  ecommerceApproveCancellation: Scalars['Boolean']['output'];
  /** Approve a refund request. Returns true on success. */
  ecommerceApproveRefund: Scalars['Boolean']['output'];
  /** Approve a return/replacement request. Returns true on success. */
  ecommerceApproveReturn: Scalars['Boolean']['output'];
  /** Create a new conversation with a buyer */
  ecommerceCreateConversation: CustomerServiceCreateConversationResult;
  /** Mark a conversation as read. Returns true on success. */
  ecommerceMarkConversationRead: Scalars['Boolean']['output'];
  /** Send a rich card (order, product, or logistics) in a CS conversation. */
  ecommerceSendMessage: CustomerServiceSendMessageResult;
  /** Update inventory for one or more SKUs using a simplified input shape. Each item only accepts skuId and quantity; the backend performs the TikTok-specific product/warehouse expansion. */
  ecommerceUpdateInventory: EcomUpdateInventoryResult;
  /** Update shop settings (agent-facing, flat params) */
  ecommerceUpdateShop: EcommerceUpdateShopResult;
  /** Enroll in a product module */
  enrollModule: MeResponse;
  /** Generate a 6-character pairing code for QR display */
  generatePairingCode: GeneratePairingResult;
  /** Generate TikTok OAuth authorization URL */
  initiateTikTokOAuth: InitiateOAuthResponse;
  /** Log in with email and password */
  login: AuthPayload;
  /** Log out (revoke the provided refresh token) */
  logout: Scalars['Boolean']['output'];
  /** Unified browser profile management: create, update, delete, archive, or batch delete profiles */
  manageBrowserProfile: BrowserProfileManageResult;
  /** Promote a temporary uploaded image into permanent object storage and link it to an entity. Pass the assetId returned by POST /api/uploads/images; imageUri is accepted as a fallback. */
  promoteImageAsset: ImageAsset;
  /** Publish an update notification to all connected clients (admin only) */
  publishUpdate: Scalars['Boolean']['output'];
  /** Redeem a service credit to a shop */
  redeemCredit: Shop;
  /** Refresh an expired access token */
  refreshToken: AuthPayload;
  /** Register a new user account */
  register: AuthPayload;
  /** Request a new captcha challenge */
  requestCaptcha: CaptchaResponse;
  /** Revoke all sessions for the current user (remote logout) */
  revokeAllSessions: Scalars['Int']['output'];
  /** Set or clear the default RunProfile for the current user */
  setDefaultRunProfile: MeResponse;
  /** Pull platform warehouse lists for one shop and auto-map official fulfillment warehouses when possible. */
  syncShopWarehouses: ShopWarehouseSyncPayload;
  /** Import inventory goods from a WMS account into canonical InventoryGood. When overrideExisting is false or omitted, existing InventoryGood rows win and are preserved. When true, WMS attributes overwrite existing rows with the same SKU. */
  syncWmsInventoryGoods: SyncWmsInventoryGoodsPayload;
  /** Pull warehouses from one WMS account and upsert canonical Warehouse records. */
  syncWmsWarehouses: WmsWarehouseSyncPayload;
  /** Unenroll from a product module */
  unenrollModule: MeResponse;
  /** Update an existing run profile */
  updateRunProfile?: Maybe<RunProfile>;
  /** Update an existing shop */
  updateShop?: Maybe<Shop>;
  /** Update an existing surface */
  updateSurface?: Maybe<Surface>;
  /** Upload (upsert) an encrypted session state backup */
  uploadSessionStateBackup: Scalars['Boolean']['output'];
  /** Verify a pairing code from mobile and create relay token */
  verifyPairingCode: VerifyPairingResult;
  /** Write external SKU to InventoryGood mappings in batch. Omit id to locate by sourceSystem + sourceId + sellerSku or create a new mapping. */
  writeInventoryGoodMappings: Array<InventoryGoodMapping>;
  /** Write canonical stockable inventory goods in batch. Omit id to locate by exact sku or create a new good. */
  writeInventoryGoods: Array<InventoryGood>;
  /** Write shop warehouse mappings in batch. Use this after AI or user confirms platform warehouse to canonical warehouse matches. */
  writeShopWarehouseMappings: Array<ShopWarehouse>;
  /** Write canonical warehouses in batch. Omit input.id to create; pass input.id to update. */
  writeWarehouses: Array<Warehouse>;
  /** Write WMS accounts in batch. New accounts and endpoint/apiToken changes automatically sync warehouses. apiToken is write-only. */
  writeWmsAccounts: Array<WriteWmsAccountPayload>;
}


export interface MutationCreateRunProfileArgs {
  input: CreateRunProfileInput;
}


export interface MutationCreateSurfaceArgs {
  input: CreateSurfaceInput;
}


export interface MutationCsGetOrCreateSessionArgs {
  conversationId: Scalars['String']['input'];
  shopId: Scalars['ID']['input'];
}


export interface MutationDeleteRunProfileArgs {
  id: Scalars['ID']['input'];
}


export interface MutationDeleteSessionStateBackupArgs {
  profileId: Scalars['ID']['input'];
}


export interface MutationDeleteShopArgs {
  id: Scalars['ID']['input'];
}


export interface MutationDeleteSurfaceArgs {
  id: Scalars['ID']['input'];
}


export interface MutationEcommerceApproveCancellationArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  cancelId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface MutationEcommerceApproveRefundArgs {
  amount?: InputMaybe<Scalars['String']['input']>;
  buyerKeepItem?: InputMaybe<Scalars['Boolean']['input']>;
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  currency?: InputMaybe<Scalars['String']['input']>;
  decision?: InputMaybe<EcomApproveRefundDecision>;
  returnId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface MutationEcommerceApproveReturnArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  decision: EcomApproveReturnDecision;
  returnId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface MutationEcommerceCreateConversationArgs {
  buyerUserId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface MutationEcommerceMarkConversationReadArgs {
  conversationId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface MutationEcommerceSendMessageArgs {
  content: Scalars['String']['input'];
  conversationId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
  type: EcomMessageType;
}


export interface MutationEcommerceUpdateInventoryArgs {
  shopId: Scalars['String']['input'];
  updates: Array<EcomUpdateInventoryInput>;
}


export interface MutationEcommerceUpdateShopArgs {
  alias?: InputMaybe<Scalars['String']['input']>;
  customerServiceSettings?: InputMaybe<AgentCsSettingsInput>;
  shopId: Scalars['String']['input'];
  wmsSettings?: InputMaybe<WmsSettingsInput>;
}


export interface MutationEnrollModuleArgs {
  moduleId: ModuleId;
}


export interface MutationGeneratePairingCodeArgs {
  desktopDeviceId: Scalars['String']['input'];
}


export interface MutationInitiateTikTokOAuthArgs {
  platformAppId: Scalars['ID']['input'];
}


export interface MutationLoginArgs {
  input: LoginInput;
}


export interface MutationLogoutArgs {
  refreshToken: Scalars['String']['input'];
}


export interface MutationManageBrowserProfileArgs {
  action: BrowserProfileAction;
  id?: InputMaybe<Scalars['ID']['input']>;
  ids?: InputMaybe<Array<Scalars['ID']['input']>>;
  input?: InputMaybe<Scalars['String']['input']>;
}


export interface MutationPromoteImageAssetArgs {
  input: PromoteImageAssetInput;
}


export interface MutationPublishUpdateArgs {
  version: Scalars['String']['input'];
}


export interface MutationRedeemCreditArgs {
  creditId: Scalars['ID']['input'];
  shopId: Scalars['ID']['input'];
}


export interface MutationRefreshTokenArgs {
  refreshToken: Scalars['String']['input'];
}


export interface MutationRegisterArgs {
  input: RegisterInput;
}


export interface MutationSetDefaultRunProfileArgs {
  runProfileId?: InputMaybe<Scalars['String']['input']>;
}


export interface MutationSyncShopWarehousesArgs {
  shopId: Scalars['ID']['input'];
}


export interface MutationSyncWmsInventoryGoodsArgs {
  overrideExisting?: InputMaybe<Scalars['Boolean']['input']>;
  wmsAccountId: Scalars['ID']['input'];
}


export interface MutationSyncWmsWarehousesArgs {
  wmsAccountId: Scalars['ID']['input'];
}


export interface MutationUnenrollModuleArgs {
  moduleId: ModuleId;
}


export interface MutationUpdateRunProfileArgs {
  id: Scalars['ID']['input'];
  input: UpdateRunProfileInput;
}


export interface MutationUpdateShopArgs {
  id: Scalars['ID']['input'];
  input: UpdateShopInput;
}


export interface MutationUpdateSurfaceArgs {
  id: Scalars['ID']['input'];
  input: UpdateSurfaceInput;
}


export interface MutationUploadSessionStateBackupArgs {
  manifest: SessionStateBackupManifestInput;
  payload: Scalars['String']['input'];
  profileId: Scalars['ID']['input'];
}


export interface MutationVerifyPairingCodeArgs {
  mobileDeviceId: Scalars['String']['input'];
  pairingCode: Scalars['String']['input'];
}


export interface MutationWriteInventoryGoodMappingsArgs {
  inputs: Array<WriteInventoryGoodMappingInput>;
}


export interface MutationWriteInventoryGoodsArgs {
  inputs: Array<WriteInventoryGoodInput>;
}


export interface MutationWriteShopWarehouseMappingsArgs {
  inputs: Array<WriteShopWarehouseMappingInput>;
}


export interface MutationWriteWarehousesArgs {
  inputs: Array<WriteWarehouseInput>;
}


export interface MutationWriteWmsAccountsArgs {
  inputs: Array<WriteWmsAccountInput>;
}

/** OAuth flow completed payload (e.g. TikTok shop authorization) */
export interface OAuthCompletePayload {
  platform: Scalars['String']['output'];
  shopId: Scalars['String']['output'];
  shopName: Scalars['String']['output'];
}

/** Paginated browser profiles result */
export interface PaginatedBrowserProfiles {
  items: Array<BrowserProfile>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
}

export interface Plan {
  currency: Scalars['String']['output'];
  planDetail: Array<PlanDetail>;
  planName: Scalars['String']['output'];
  price: Scalars['String']['output'];
}

/** Plan definition with limits and pricing */
export interface PlanDefinition {
  maxSeats: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  planId: UserPlan;
  priceCurrency: Currency;
  priceMonthly: Scalars['String']['output'];
}

export interface PlanDetail {
  modelName: Scalars['String']['output'];
  volume: Scalars['String']['output'];
}

/** ISV application credentials for a platform+market combination */
export interface PlatformApp {
  apiBaseUrl: Scalars['String']['output'];
  authLinkUrl: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  market: PlatformMarket;
  platform: PlatformType;
  status: PlatformAppStatus;
}

/** Platform app credentials (admin-only) */
export interface PlatformAppSecretResult {
  /** Application key */
  appKey: Scalars['String']['output'];
  /** Application secret */
  appSecret: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  market: PlatformMarket;
  platform: PlatformType;
}

/** PlatformApp lifecycle status */
export const PlatformAppStatus = {
  Active: 'ACTIVE',
  Draft: 'DRAFT',
  Suspended: 'SUSPENDED'
} as const;

export type PlatformAppStatus = typeof PlatformAppStatus[keyof typeof PlatformAppStatus];
/** Platform market region */
export const PlatformMarket = {
  Id: 'ID',
  My: 'MY',
  Ph: 'PH',
  Row: 'ROW',
  Th: 'TH',
  Us: 'US'
} as const;

export type PlatformMarket = typeof PlatformMarket[keyof typeof PlatformMarket];
/** Platform type identifier */
export const PlatformType = {
  TiktokShop: 'TIKTOK_SHOP'
} as const;

export type PlatformType = typeof PlatformType[keyof typeof PlatformType];
/** Promote a temporary uploaded image into permanent object storage */
export interface PromoteImageAssetInput {
  /** ImageAsset ID returned by POST /api/uploads/images. Prefer this over imageUri. */
  assetId?: InputMaybe<Scalars['ID']['input']>;
  /** Temporary image URI returned by POST /api/uploads/images. Used only when assetId is unavailable. */
  imageUri?: InputMaybe<Scalars['String']['input']>;
  /** Entity ID that owns this image. May be omitted while creating a new entity. */
  linkedEntityId?: InputMaybe<Scalars['String']['input']>;
  /** Entity type that will own this image, e.g. INVENTORY_GOOD or PRODUCT. */
  linkedEntityType: Scalars['String']['input'];
}

export interface ProviderPricing {
  currency: Scalars['String']['output'];
  models: Array<ModelPricing>;
  pricingUrl: Scalars['String']['output'];
  provider: Scalars['String']['output'];
  subscriptions?: Maybe<Array<ProviderSubscription>>;
}

export interface ProviderSubscription {
  id: Scalars['String']['output'];
  label: Scalars['String']['output'];
  models?: Maybe<Array<ModelPricing>>;
  plans: Array<Plan>;
  pricingUrl: Scalars['String']['output'];
}

export interface Query {
  /** Get a single browser profile by ID */
  browserProfile?: Maybe<BrowserProfile>;
  /** Get audit log for a browser profile */
  browserProfileAuditLog: Array<BrowserProfileAuditEntry>;
  /** List browser profiles for the authenticated user */
  browserProfiles: PaginatedBrowserProfiles;
  /** Check if a newer version is available (public, no auth required) */
  checkUpdate?: Maybe<UpdatePayload>;
  /** Get all preset skills for CS. Returns a JSON object { key: markdownContent, ... } or null if none configured. */
  csGetPresetSkills?: Maybe<Scalars['String']['output']>;
  /** Get aftersale eligibility for an order */
  ecommerceGetAftersaleEligibility: EcomAftersaleEligibility;
  /** Get customer service performance metrics from the warehouse as one row per shop-local date. */
  ecommerceGetCSPerformance: Array<CustomerServicePerformance>;
  /** Get full conversation details including conversation metadata (unread count, status, participants, latest message preview) and a normalized buyer participant slice. */
  ecommerceGetConversationDetails: CustomerServiceConversationDetails;
  /** Get messages of a conversation */
  ecommerceGetConversationMessages: CustomerServiceMessageSummaryPage;
  /** Get conversations for a shop as a flat summary list. Pagination is handled internally by the backend. */
  ecommerceGetConversations: Array<CustomerServiceConversationSummary>;
  /** Get fulfillment tracking for an order. Optional buyerUserId for buyer scoping. */
  ecommerceGetFulfillmentTracking: EcomOrderTracking;
  /** Get order details by order ID. Returns null if the order is not found or does not belong to the optional buyerUserId. */
  ecommerceGetOrder?: Maybe<EcomOrder>;
  /** List/search orders as a flat summary list. Optional buyerUserId for buyer-scoped queries. Pagination is handled internally by the backend. For full order details use ecommerceGetOrder. */
  ecommerceGetOrders: Array<EcomOrderSummary>;
  /** Get package detail by package ID */
  ecommerceGetPackageDetail: EcomPackageDetail;
  /** Get shipping document for a package */
  ecommerceGetPackageShippingDocument: EcomShippingDocument;
  /** Get conversations pending seller reply */
  ecommerceGetPendingConversations: CustomerServicePendingConversationsResult;
  /** Get product details */
  ecommerceGetProduct: EcomProduct;
  /** Get valid reject reasons for a return or cancellation */
  ecommerceGetRejectReasons: Array<EcomRejectReason>;
  /** Get return event records (audit trail) */
  ecommerceGetReturnRecords: Array<EcomReturnRecord>;
  /** Get shop SKU performance analytics from the warehouse as one row per shop-local date and SKU. Returns full item fields plus totalCount metadata. */
  ecommerceGetShopSkuPerformanceList: EcomSkuPerformanceResult;
  /** Search customer service sessions for a shop */
  ecommerceSearchCSSessions: CustomerServiceSessionPage;
  /** Search order cancellation requests and return a flat list. Pagination is handled internally by the backend. */
  ecommerceSearchCancellations: Array<EcomCancellation>;
  /** Search fulfillment packages with optional filters and return a flat list. Pagination is handled internally by the backend. */
  ecommerceSearchPackages: Array<EcomPackage>;
  /** Search/list products with optional filters and return a flat summary list. Pagination is handled internally by the backend. For full product details including images use ecommerceGetProduct. */
  ecommerceSearchProducts: Array<EcomProductSummary>;
  /** Search return/refund/replacement requests and return a flat list. Pagination is handled internally by the backend. */
  ecommerceSearchReturns: Array<EcomReturn>;
  /** List recent image assets for the authenticated user */
  imageAssets: Array<ImageAsset>;
  /** Get LLM quota status for the current user */
  llmQuotaStatus: LlmQuotaStatus;
  /** Get current authenticated user profile */
  me: MeResponse;
  /** Get PWA install URL (base URL without pairing code) */
  mobileInstallUrl: Scalars['String']['output'];
  /** List available credits for the authenticated user */
  myCredits: Array<ServiceCredit>;
  /** List all available plan definitions */
  planDefinitions: Array<PlanDefinition>;
  /** List all active platform app secrets (admin-only, for relay startup) */
  platformAppSecrets: Array<PlatformAppSecretResult>;
  /** List active PlatformApps (for OAuth target selection) */
  platformApps: Array<PlatformApp>;
  /** Get pricing for all providers */
  pricing: Array<ProviderPricing>;
  /** Read external SKU to InventoryGood mappings. Use input.id for one row, or filters for a list. */
  readInventoryGoodMappings: Array<InventoryGoodMapping>;
  /** Read canonical stockable inventory goods. Use input.id for one row, or filters for a list. */
  readInventoryGoods: Array<InventoryGood>;
  /** Read active shop SKU coverage against canonical InventoryGood. Returns unrecognized active shop SKUs and active InventoryGoods that this shop does not currently resolve to. */
  readShopInventoryGoodCoverage: ShopInventoryGoodCoveragePayload;
  /** Read shop-scoped platform warehouses. Use input.id for one row, or filters for a list. */
  readShopWarehouses: Array<ShopWarehouse>;
  /** Read canonical warehouses. Use input.id for one row, or filters for a list. */
  readWarehouses: Array<Warehouse>;
  /** Read WMS accounts. Use input.id for one account, or filters for a list. Credentials are never returned. */
  readWmsAccounts: Array<WmsAccount>;
  /** Read WMS goods coverage against canonical InventoryGood without writing data. Use before syncWmsInventoryGoods to show which WMS goods are not yet active InventoryGoods. */
  readWmsInventoryGoodCoverage: WmsInventoryGoodCoveragePayload;
  /** Resolve an external source seller SKU to a canonical InventoryGood for safe inventory writes. */
  resolveInventoryGoodIdentity: InventoryGoodIdentityResolution;
  /** Get a single run profile by ID */
  runProfile?: Maybe<RunProfile>;
  /** List run profiles for the authenticated user, optionally filtered by surface */
  runProfiles: Array<RunProfile>;
  /** Download the encrypted session state backup for a profile */
  sessionStateBackup?: Maybe<SessionStateBackupDownload>;
  /** Get a single shop by ID */
  shop?: Maybe<Shop>;
  /** Get OAuth token status for a shop */
  shopAuthStatus: ShopAuthStatusResponse;
  /** List shops for the authenticated user */
  shops: Array<Shop>;
  /** Get a single skill by slug */
  skill?: Maybe<Skill>;
  /** Get all skill categories with counts */
  skillCategories: Array<SkillCategoryResult>;
  /** Search and browse marketplace skills */
  skills: SkillConnection;
  /** Get current user subscription status */
  subscriptionStatus?: Maybe<UserSubscription>;
  /** Get a single surface by ID */
  surface?: Maybe<Surface>;
  /** List surfaces for the authenticated user */
  surfaces: Array<Surface>;
  /** Get system preset run profiles (userId=null), optionally filtered by moduleId */
  systemRunProfiles: Array<RunProfile>;
  /** Get tool specifications for dynamic client-side registration (filtered by user entitlements) */
  toolSpecs: Array<ToolSpec>;
  /** Batch-verify relay access tokens */
  verifyRelayTokens: Array<RelayTokenResult>;
  /** Verify whether the authenticated user has access to the given shops */
  verifyShopAccess: VerifyShopAccessResult;
  /** Long-poll for pairing completion (30s timeout) */
  waitForPairing: WaitPairingResult;
}


export interface QueryBrowserProfileArgs {
  id: Scalars['ID']['input'];
}


export interface QueryBrowserProfileAuditLogArgs {
  profileId: Scalars['ID']['input'];
}


export interface QueryBrowserProfilesArgs {
  filter?: InputMaybe<BrowserProfilesFilterInput>;
  pagination?: InputMaybe<BrowserProfilesPaginationInput>;
}


export interface QueryCheckUpdateArgs {
  clientVersion: Scalars['String']['input'];
}


export interface QueryEcommerceGetAftersaleEligibilityArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetCsPerformanceArgs {
  endTime?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
  startTime?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryEcommerceGetConversationDetailsArgs {
  conversationId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetConversationMessagesArgs {
  conversationId: Scalars['String']['input'];
  locale?: InputMaybe<Scalars['String']['input']>;
  pageSize: Scalars['Float']['input'];
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetConversationsArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
  locale?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetFulfillmentTrackingArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetOrderArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetOrdersArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  shopId: Scalars['String']['input'];
  status?: InputMaybe<EcomOrderStatus>;
}


export interface QueryEcommerceGetPackageDetailArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  packageId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetPackageShippingDocumentArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  documentFormat?: InputMaybe<EcomDocumentFormat>;
  documentSize?: InputMaybe<EcomDocumentSize>;
  documentType: EcomDocumentType;
  packageId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetPendingConversationsArgs {
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetProductArgs {
  productId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetRejectReasonsArgs {
  returnOrCancelId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetReturnRecordsArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  returnId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetShopSkuPerformanceListArgs {
  endDateLt: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  productIds?: InputMaybe<Array<Scalars['String']['input']>>;
  shopId: Scalars['String']['input'];
  startDateGe: Scalars['String']['input'];
}


export interface QueryEcommerceSearchCsSessionsArgs {
  beginTimeGe: Scalars['Float']['input'];
  beginTimeLt: Scalars['Float']['input'];
  buyerNickname?: InputMaybe<Scalars['String']['input']>;
  pageSize: Scalars['Float']['input'];
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceSearchCancellationsArgs {
  cancelIds?: InputMaybe<Array<Scalars['String']['input']>>;
  cancelStatus?: InputMaybe<Array<EcomCancelStatusFilter>>;
  cancelTypes?: InputMaybe<Array<EcomCancelTypeFilter>>;
  createTimeGe?: InputMaybe<Scalars['Float']['input']>;
  createTimeLt?: InputMaybe<Scalars['Float']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  orderIds?: InputMaybe<Array<Scalars['String']['input']>>;
  shopId: Scalars['String']['input'];
  updateTimeGe?: InputMaybe<Scalars['Float']['input']>;
  updateTimeLt?: InputMaybe<Scalars['Float']['input']>;
}


export interface QueryEcommerceSearchPackagesArgs {
  createTimeGe?: InputMaybe<Scalars['Float']['input']>;
  createTimeLt?: InputMaybe<Scalars['Float']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  packageStatus?: InputMaybe<EcomPackageStatus>;
  shopId: Scalars['String']['input'];
  sortField?: InputMaybe<EcomSortField>;
  sortOrder?: InputMaybe<EcomSortOrder>;
  updateTimeGe?: InputMaybe<Scalars['Float']['input']>;
  updateTimeLt?: InputMaybe<Scalars['Float']['input']>;
}


export interface QueryEcommerceSearchProductsArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
  shopId: Scalars['String']['input'];
  status?: InputMaybe<EcomProductStatus>;
}


export interface QueryEcommerceSearchReturnsArgs {
  createTimeGe?: InputMaybe<Scalars['Float']['input']>;
  createTimeLt?: InputMaybe<Scalars['Float']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  orderIds?: InputMaybe<Array<Scalars['String']['input']>>;
  returnIds?: InputMaybe<Array<Scalars['String']['input']>>;
  returnStatus?: InputMaybe<Array<EcomReturnStatusFilter>>;
  returnTypes?: InputMaybe<Array<EcomReturnTypeFilter>>;
  shopId: Scalars['String']['input'];
  updateTimeGe?: InputMaybe<Scalars['Float']['input']>;
  updateTimeLt?: InputMaybe<Scalars['Float']['input']>;
}


export interface QueryPricingArgs {
  appVersion?: InputMaybe<Scalars['String']['input']>;
  deviceId?: InputMaybe<Scalars['String']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  platform?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryReadInventoryGoodMappingsArgs {
  input: ReadInventoryGoodMappingsInput;
}


export interface QueryReadInventoryGoodsArgs {
  input: ReadInventoryGoodsInput;
}


export interface QueryReadShopInventoryGoodCoverageArgs {
  input: ReadShopInventoryGoodCoverageInput;
}


export interface QueryReadShopWarehousesArgs {
  input: ReadShopWarehousesInput;
}


export interface QueryReadWarehousesArgs {
  input: ReadWarehousesInput;
}


export interface QueryReadWmsAccountsArgs {
  input: ReadWmsAccountsInput;
}


export interface QueryReadWmsInventoryGoodCoverageArgs {
  wmsAccountId: Scalars['ID']['input'];
}


export interface QueryResolveInventoryGoodIdentityArgs {
  sellerSku: Scalars['String']['input'];
  sourceId: Scalars['ID']['input'];
  sourceSystem: InventoryGoodMappingSourceSystem;
}


export interface QueryRunProfileArgs {
  id: Scalars['ID']['input'];
}


export interface QueryRunProfilesArgs {
  surfaceId?: InputMaybe<Scalars['ID']['input']>;
}


export interface QuerySessionStateBackupArgs {
  profileId: Scalars['ID']['input'];
}


export interface QueryShopArgs {
  id: Scalars['ID']['input'];
}


export interface QueryShopAuthStatusArgs {
  id: Scalars['ID']['input'];
}


export interface QueryShopsArgs {
  platform?: InputMaybe<ShopPlatform>;
  refreshTokenExpiringBefore?: InputMaybe<Scalars['String']['input']>;
  region?: InputMaybe<ShopRegion>;
}


export interface QuerySkillArgs {
  slug: Scalars['String']['input'];
}


export interface QuerySkillsArgs {
  category?: InputMaybe<Scalars['String']['input']>;
  chinaAvailable?: InputMaybe<Scalars['Boolean']['input']>;
  page?: InputMaybe<Scalars['Int']['input']>;
  pageSize?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
}


export interface QuerySurfaceArgs {
  id: Scalars['ID']['input'];
}


export interface QuerySystemRunProfilesArgs {
  moduleId?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryVerifyRelayTokensArgs {
  tokens: Array<Scalars['String']['input']>;
}


export interface QueryVerifyShopAccessArgs {
  shopIds: Array<Scalars['String']['input']>;
}


export interface QueryWaitForPairingArgs {
  code: Scalars['String']['input'];
}

export interface QuotaCircleStatus {
  refreshAt: Scalars['DateTimeISO']['output'];
  remainingPercent: Scalars['Float']['output'];
}

/** Read external SKU to InventoryGood mappings. Pass id to read one mapping, or omit id to list by filters. */
export interface ReadInventoryGoodMappingsInput {
  /** InventoryGoodMapping ID. When provided, the result contains zero or one mapping. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** Canonical InventoryGood ID to find mappings for. */
  inventoryGoodId?: InputMaybe<Scalars['ID']['input']>;
  /** Exact seller SKU or warehouse goods SKU in the external source. */
  sellerSku?: InputMaybe<Scalars['String']['input']>;
  /** Source connection Mongo ID, such as Shop._id or WmsAccount._id. */
  sourceId?: InputMaybe<Scalars['ID']['input']>;
  /** External source system filter, such as TIKTOK_SHOP or YEJOIN_WMS. */
  sourceSystem?: InputMaybe<InventoryGoodMappingSourceSystem>;
  /** Filter by lifecycle status. Defaults to ACTIVE when omitted. */
  status?: InputMaybe<InventoryGoodMappingStatus>;
}

/** Read canonical inventory goods. Pass id to read one good, or omit id to list by filters. */
export interface ReadInventoryGoodsInput {
  /** InventoryGood ID. When provided, the result contains zero or one good. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** Maximum number of goods to return, capped at 500. */
  limit?: InputMaybe<Scalars['Int']['input']>;
  /** Search by exact sku, barcode, GTIN, or text metadata. */
  search?: InputMaybe<Scalars['String']['input']>;
  /** Filter by lifecycle status. Defaults to ACTIVE when omitted. */
  status?: InputMaybe<InventoryGoodStatus>;
}

/** Read active shop SKU coverage against canonical InventoryGood identity. */
export interface ReadShopInventoryGoodCoverageInput {
  /** Shop Mongo ID to audit. */
  shopId: Scalars['ID']['input'];
}

/** Read shop-scoped platform warehouses. Pass id to read one row, or omit id to list by filters. */
export interface ReadShopWarehousesInput {
  /** ShopWarehouse ID. When provided, the result contains zero or one row. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** Connected Shop ID whose platform warehouses should be listed. */
  shopId?: InputMaybe<Scalars['ID']['input']>;
  /** Filter by lifecycle status. Defaults to ACTIVE when omitted. */
  status?: InputMaybe<ShopWarehouseStatus>;
  /** Canonical Warehouse ID to find platform warehouses mapped to it. */
  warehouseId?: InputMaybe<Scalars['ID']['input']>;
}

/** Read canonical warehouses. Pass id to read one warehouse, or omit id to list by filters. */
export interface ReadWarehousesInput {
  /** Canonical Warehouse ID. When provided, the result contains zero or one warehouse. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** Filter by provider, such as YEJOIN or TIKTOK_FBT. */
  provider?: InputMaybe<WarehouseProvider>;
  /** Search by warehouse name, code, or external warehouse ID. */
  search?: InputMaybe<Scalars['String']['input']>;
  /** Filter by source connection ID, such as WmsAccount._id or Shop._id. */
  sourceId?: InputMaybe<Scalars['ID']['input']>;
  /** Filter by lifecycle status. Defaults to ACTIVE when omitted. */
  status?: InputMaybe<WarehouseStatus>;
  /** Filter by warehouse type, such as OFFICIAL_PLATFORM or THIRD_PARTY_WMS. */
  warehouseType?: InputMaybe<WarehouseType>;
}

/** Read WMS accounts. Pass id to read one account, or omit id to list by filters. Credentials are never returned. */
export interface ReadWmsAccountsInput {
  /** WmsAccount ID. When provided, the result contains zero or one account. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** Filter by user-facing WMS account label. */
  label?: InputMaybe<Scalars['String']['input']>;
  /** Filter by WMS provider, such as YEJOIN. */
  provider?: InputMaybe<WmsAccountProvider>;
  /** Filter by lifecycle status. Defaults to ACTIVE when omitted. */
  status?: InputMaybe<WmsAccountStatus>;
}

/** Registration input */
export interface RegisterInput {
  captchaAnswer: Scalars['String']['input'];
  captchaToken: Scalars['String']['input'];
  email: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  password: Scalars['String']['input'];
}

export interface RelayTokenResult {
  desktopDeviceId?: Maybe<Scalars['String']['output']>;
  mobileDeviceId?: Maybe<Scalars['String']['output']>;
  pairingId?: Maybe<Scalars['String']['output']>;
  valid: Scalars['Boolean']['output'];
}

/** RunProfile entity — defines tool selection for a specific run. userId=null for system presets. */
export interface RunProfile {
  createdAt: Scalars['DateTimeISO']['output'];
  id: Scalars['ID']['output'];
  /** Module this system preset belongs to. Null for user-created profiles. */
  moduleId?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  selectedToolIds: Array<Scalars['String']['output']>;
  surfaceId: Scalars['String']['output'];
  updatedAt: Scalars['DateTimeISO']['output'];
  userId?: Maybe<Scalars['String']['output']>;
}

/** A one-time service credit (top-up) that can be redeemed to a shop */
export interface ServiceCredit {
  createdAt: Scalars['DateTimeISO']['output'];
  expiresAt: Scalars['DateTimeISO']['output'];
  id: Scalars['ID']['output'];
  quota: Scalars['Int']['output'];
  redeemedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  redeemedShopId?: Maybe<Scalars['String']['output']>;
  service: ServiceId;
  source: ServiceCreditSource;
  status: ServiceCreditStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
}

/** Origin of a service credit */
export const ServiceCreditSource = {
  Promotion: 'PROMOTION',
  Trial: 'TRIAL'
} as const;

export type ServiceCreditSource = typeof ServiceCreditSource[keyof typeof ServiceCreditSource];
/** Status of a service credit */
export const ServiceCreditStatus = {
  Available: 'AVAILABLE',
  Expired: 'EXPIRED',
  Redeemed: 'REDEEMED'
} as const;

export type ServiceCreditStatus = typeof ServiceCreditStatus[keyof typeof ServiceCreditStatus];
/** Business service type identifiers */
export const ServiceId = {
  CustomerService: 'CUSTOMER_SERVICE',
  OrderManagement: 'ORDER_MANAGEMENT'
} as const;

export type ServiceId = typeof ServiceId[keyof typeof ServiceId];
/** Session state backup with payload for download */
export interface SessionStateBackupDownload {
  manifest: SessionStateBackupManifest;
  payload: Scalars['String']['output'];
}

/** Manifest metadata for a session state backup */
export interface SessionStateBackupManifest {
  cookieCount: Scalars['Float']['output'];
  hash: Scalars['String']['output'];
  profileId: Scalars['String']['output'];
  target: Scalars['String']['output'];
  updatedAt: Scalars['Float']['output'];
}

/** Input for session state backup manifest */
export interface SessionStateBackupManifestInput {
  cookieCount: Scalars['Float']['input'];
  hash: Scalars['String']['input'];
  profileId: Scalars['String']['input'];
  target: Scalars['String']['input'];
  updatedAt: Scalars['Float']['input'];
}

/** A connected e-commerce shop */
export interface Shop {
  accessTokenExpiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
  alias?: Maybe<Scalars['String']['output']>;
  authStatus: ShopAuthStatus;
  createdAt: Scalars['DateTimeISO']['output'];
  grantedScopes: Array<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  platform: ShopPlatform;
  platformAppId: Scalars['String']['output'];
  platformShopId: Scalars['String']['output'];
  refreshTokenExpiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
  region: ShopRegion;
  services: ShopServiceConfig;
  shopName: Scalars['String']['output'];
  /** IANA timezone used for shop-local platform analytics dates */
  timezone: Scalars['String']['output'];
  timezoneSource: ShopTimezoneSource;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
}

/** OAuth authorization status of a connected shop */
export const ShopAuthStatus = {
  Authorized: 'AUTHORIZED',
  Disconnected: 'DISCONNECTED',
  PendingAuth: 'PENDING_AUTH',
  Revoked: 'REVOKED',
  TokenExpired: 'TOKEN_EXPIRED'
} as const;

export type ShopAuthStatus = typeof ShopAuthStatus[keyof typeof ShopAuthStatus];
/** Shop auth/token status */
export interface ShopAuthStatusResponse {
  accessTokenExpiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
  hasToken: Scalars['Boolean']['output'];
  refreshTokenExpiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
}

/** Coverage view for active shop SKUs and canonical InventoryGoods. */
export interface ShopInventoryGoodCoveragePayload {
  /** Product status scanned. This audit intentionally only checks active shop products. */
  productStatus: EcomProductStatus;
  /** Shop Mongo ID that was audited. */
  shopId: Scalars['ID']['output'];
  /** InventoryGoodMapping source ID used for this shop. */
  sourceId: Scalars['ID']['output'];
  /** InventoryGoodMapping source system used for this shop. */
  sourceSystem: InventoryGoodMappingSourceSystem;
  /** Active InventoryGoods that no active shop SKU currently resolves to. */
  unmatchedInventoryGoods: Array<InventoryGood>;
  /** Active shop SKU rows that cannot be safely resolved to InventoryGood. */
  unrecognizedShopSkus: Array<UnrecognizedShopSku>;
}

/** E-commerce platform identifier */
export const ShopPlatform = {
  TiktokShop: 'TIKTOK_SHOP'
} as const;

export type ShopPlatform = typeof ShopPlatform[keyof typeof ShopPlatform];
/** Country/region code for a connected shop */
export const ShopRegion = {
  Gb: 'GB',
  Id: 'ID',
  My: 'MY',
  Ph: 'PH',
  Row: 'ROW',
  Sg: 'SG',
  Th: 'TH',
  Us: 'US',
  Vn: 'VN'
} as const;

export type ShopRegion = typeof ShopRegion[keyof typeof ShopRegion];
/** Per-shop service feature toggles */
export interface ShopServiceConfig {
  customerService: CustomerServiceSettings;
  customerServiceBilling: CustomerServiceBilling;
  wms: WmsSettings;
}

/** Input for updating per-shop service toggles */
export interface ShopServiceConfigInput {
  customerService?: InputMaybe<CustomerServiceSettingsInput>;
  wms?: InputMaybe<WmsSettingsInput>;
}

/** How the shop analytics timezone was resolved */
export const ShopTimezoneSource = {
  Manual: 'MANUAL',
  Platform: 'PLATFORM',
  RegionDefault: 'REGION_DEFAULT'
} as const;

export type ShopTimezoneSource = typeof ShopTimezoneSource[keyof typeof ShopTimezoneSource];
/** Warehouse identity exposed by an e-commerce shop platform */
export interface ShopWarehouse {
  address?: Maybe<WarehouseAddress>;
  createdAt: Scalars['DateTimeISO']['output'];
  effectStatus: ShopWarehouseEffectStatus;
  id: Scalars['ID']['output'];
  isDefault: Scalars['Boolean']['output'];
  lastSyncedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  name: Scalars['String']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  /** Platform physical/entity warehouse ID, such as TikTok entity_id. */
  platformEntityId?: Maybe<Scalars['String']['output']>;
  /** Raw platform sub type, such as DOMESTIC_WAREHOUSE or CB_OVERSEA_WAREHOUSE. */
  platformSubType?: Maybe<Scalars['String']['output']>;
  /** Warehouse ID returned by the shop platform, such as TikTok warehouse_id. */
  platformWarehouseId: Scalars['String']['output'];
  regionCode?: Maybe<Scalars['String']['output']>;
  shopId: Scalars['ID']['output'];
  status: ShopWarehouseStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
  /** Canonical Warehouse ID after matching. Null means this platform warehouse is not safely mapped yet. */
  warehouseId?: Maybe<Scalars['ID']['output']>;
  warehouseType: ShopWarehouseType;
}

/** Platform-side availability state of a shop warehouse */
export const ShopWarehouseEffectStatus = {
  Disabled: 'DISABLED',
  Enabled: 'ENABLED',
  Restricted: 'RESTRICTED',
  Unknown: 'UNKNOWN'
} as const;

export type ShopWarehouseEffectStatus = typeof ShopWarehouseEffectStatus[keyof typeof ShopWarehouseEffectStatus];
/** Lifecycle state of a shop-scoped platform warehouse */
export const ShopWarehouseStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED'
} as const;

export type ShopWarehouseStatus = typeof ShopWarehouseStatus[keyof typeof ShopWarehouseStatus];
/** Result of syncing shop-scoped platform warehouses */
export interface ShopWarehouseSyncPayload {
  /** Official fulfillment warehouse rows auto-mapped through provider APIs such as TikTok FBT. */
  officialFulfillmentWarehouses: Array<ShopWarehouse>;
  /** Platform warehouse rows returned by the shop logistics warehouse API. */
  platformWarehouses: Array<ShopWarehouse>;
}

/** Platform warehouse role in a shop */
export const ShopWarehouseType = {
  Fulfillment: 'FULFILLMENT',
  Return: 'RETURN',
  Sales: 'SALES'
} as const;

export type ShopWarehouseType = typeof ShopWarehouseType[keyof typeof ShopWarehouseType];
export interface Skill {
  author: Scalars['String']['output'];
  chinaAvailable: Scalars['Boolean']['output'];
  desc_en: Scalars['String']['output'];
  desc_zh: Scalars['String']['output'];
  downloads: Scalars['Int']['output'];
  hidden: Scalars['Boolean']['output'];
  labels: Array<SkillLabel>;
  labelsManuallyOverridden: Scalars['Boolean']['output'];
  name_en: Scalars['String']['output'];
  name_zh: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  stars: Scalars['Int']['output'];
  tags: Array<Scalars['String']['output']>;
  version: Scalars['String']['output'];
}

export interface SkillCategoryResult {
  count: Scalars['Int']['output'];
  id: Scalars['String']['output'];
  name_en: Scalars['String']['output'];
  name_zh: Scalars['String']['output'];
}

export interface SkillConnection {
  page: Scalars['Int']['output'];
  pageSize: Scalars['Int']['output'];
  skills: Array<Skill>;
  total: Scalars['Int']['output'];
}

/** Editorial labels for skill promotion */
export const SkillLabel = {
  Recommended: 'RECOMMENDED'
} as const;

export type SkillLabel = typeof SkillLabel[keyof typeof SkillLabel];
export interface Subscription {
  /** Fires when an OAuth flow completes (e.g. TikTok shop authorization) */
  oauthComplete: OAuthCompletePayload;
  /** Fires when a shop is updated. Only receives updates for shops owned by the authenticated user. */
  shopUpdated: Shop;
  updateAvailable: UpdatePayload;
}


export interface SubscriptionUpdateAvailableArgs {
  clientVersion: Scalars['String']['input'];
}

/** Subscription lifecycle states */
export const SubscriptionStatus = {
  Active: 'ACTIVE',
  Canceled: 'CANCELED',
  Expired: 'EXPIRED',
  PastDue: 'PAST_DUE'
} as const;

export type SubscriptionStatus = typeof SubscriptionStatus[keyof typeof SubscriptionStatus];
/** Surface entity — defines tool exposure boundary for a usage scenario. userId=null for system presets. */
export interface Surface {
  allowedToolIds: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTimeISO']['output'];
  userId?: Maybe<Scalars['String']['output']>;
}

/** One inventory good row that failed during WMS inventory good sync. */
export interface SyncWmsInventoryGoodsError {
  /** Failure message for this row. */
  message: Scalars['String']['output'];
  /** WMS goods SKU that failed, when available. */
  sku?: Maybe<Scalars['String']['output']>;
}

/** Result of importing inventory goods from a WMS account into canonical InventoryGood. */
export interface SyncWmsInventoryGoodsPayload {
  /** Number of InventoryGood rows created. */
  created: Scalars['Int']['output'];
  /** Per-row import errors. */
  errors: Array<SyncWmsInventoryGoodsError>;
  /** Number of WMS goods that could not be imported. */
  failed: Scalars['Int']['output'];
  /** Number of WMS goods read from the source account. */
  fetched: Scalars['Int']['output'];
  /** InventoryGood rows created or updated by this sync. */
  goods: Array<InventoryGood>;
  /** Number of WMS product images that could not be copied. The InventoryGood row may still be synced. */
  imageFailed: Scalars['Int']['output'];
  /** Number of WMS product images copied into permanent object storage. */
  imageImported: Scalars['Int']['output'];
  /** Whether existing InventoryGood rows were overwritten by WMS attributes. */
  overrideExisting: Scalars['Boolean']['output'];
  /** Number of existing InventoryGood rows preserved because overrideExisting was false. */
  skippedExisting: Scalars['Int']['output'];
  /** Number of existing InventoryGood rows updated. */
  updated: Scalars['Int']['output'];
  /** WMS account ID used as the source. */
  wmsAccountId: Scalars['ID']['output'];
}

/** System run profile identifiers declared by tool metadata */
export const SystemRunProfile = {
  CustomerService: 'CUSTOMER_SERVICE',
  ShopOperations: 'SHOP_OPERATIONS'
} as const;

export type SystemRunProfile = typeof SystemRunProfile[keyof typeof SystemRunProfile];
/** System surface identifiers declared by tool metadata */
export const SystemSurface = {
  EcommerceSeller: 'ECOMMERCE_SELLER'
} as const;

export type SystemSurface = typeof SystemSurface[keyof typeof SystemSurface];
/** Tool functional category */
export const ToolCategory = {
  BrowserProfiles: 'BROWSER_PROFILES',
  EcommerceShopMgmt: 'ECOMMERCE_SHOP_MGMT',
  EcomCs: 'ECOM_CS',
  EcomFulfillment: 'ECOM_FULFILLMENT',
  EcomOps: 'ECOM_OPS',
  EcomOrder: 'ECOM_ORDER',
  EcomProduct: 'ECOM_PRODUCT',
  EcomReturnRefund: 'ECOM_RETURN_REFUND'
} as const;

export type ToolCategory = typeof ToolCategory[keyof typeof ToolCategory];
/** Context binding for auto-injecting parameters from session context */
export interface ToolContextBinding {
  contextField: Scalars['String']['output'];
  paramName: Scalars['String']['output'];
}

/** Unique tool identifier */
export const ToolId = {
  BrowserProfilesGet: 'BROWSER_PROFILES_GET',
  BrowserProfilesList: 'BROWSER_PROFILES_LIST',
  BrowserProfilesManage: 'BROWSER_PROFILES_MANAGE',
  EcomApproveCancellation: 'ECOM_APPROVE_CANCELLATION',
  EcomApproveRefund: 'ECOM_APPROVE_REFUND',
  EcomApproveReturn: 'ECOM_APPROVE_RETURN',
  EcomCsApproveCancellation: 'ECOM_CS_APPROVE_CANCELLATION',
  EcomCsApproveRefund: 'ECOM_CS_APPROVE_REFUND',
  EcomCsApproveReturn: 'ECOM_CS_APPROVE_RETURN',
  EcomCsGetAftersaleEligibility: 'ECOM_CS_GET_AFTERSALE_ELIGIBILITY',
  EcomCsGetConversationDetails: 'ECOM_CS_GET_CONVERSATION_DETAILS',
  EcomCsGetConversationMessages: 'ECOM_CS_GET_CONVERSATION_MESSAGES',
  EcomCsGetFulfillmentTracking: 'ECOM_CS_GET_FULFILLMENT_TRACKING',
  EcomCsGetOrder: 'ECOM_CS_GET_ORDER',
  EcomCsGetPackageDetail: 'ECOM_CS_GET_PACKAGE_DETAIL',
  EcomCsGetProduct: 'ECOM_CS_GET_PRODUCT',
  EcomCsGetRejectReasons: 'ECOM_CS_GET_REJECT_REASONS',
  EcomCsGetReturnRecords: 'ECOM_CS_GET_RETURN_RECORDS',
  EcomCsGetShippingDocument: 'ECOM_CS_GET_SHIPPING_DOCUMENT',
  EcomCsListOrders: 'ECOM_CS_LIST_ORDERS',
  EcomCsRejectCancellation: 'ECOM_CS_REJECT_CANCELLATION',
  EcomCsRejectReturn: 'ECOM_CS_REJECT_RETURN',
  EcomCsSearchCancellations: 'ECOM_CS_SEARCH_CANCELLATIONS',
  EcomCsSearchProducts: 'ECOM_CS_SEARCH_PRODUCTS',
  EcomCsSearchReturns: 'ECOM_CS_SEARCH_RETURNS',
  EcomCsSendCard: 'ECOM_CS_SEND_CARD',
  EcomCsSendMedia: 'ECOM_CS_SEND_MEDIA',
  EcomGetAftersaleEligibility: 'ECOM_GET_AFTERSALE_ELIGIBILITY',
  EcomGetConversations: 'ECOM_GET_CONVERSATIONS',
  EcomGetConversationMessages: 'ECOM_GET_CONVERSATION_MESSAGES',
  EcomGetCsPerformance: 'ECOM_GET_CS_PERFORMANCE',
  EcomGetFulfillmentTracking: 'ECOM_GET_FULFILLMENT_TRACKING',
  EcomGetOrder: 'ECOM_GET_ORDER',
  EcomGetPackageDetail: 'ECOM_GET_PACKAGE_DETAIL',
  EcomGetPendingConversations: 'ECOM_GET_PENDING_CONVERSATIONS',
  EcomGetProduct: 'ECOM_GET_PRODUCT',
  EcomGetRejectReasons: 'ECOM_GET_REJECT_REASONS',
  EcomGetReturnRecords: 'ECOM_GET_RETURN_RECORDS',
  EcomGetShippingDocument: 'ECOM_GET_SHIPPING_DOCUMENT',
  EcomGetShop: 'ECOM_GET_SHOP',
  EcomGetShopSkuPerformanceList: 'ECOM_GET_SHOP_SKU_PERFORMANCE_LIST',
  EcomListOrders: 'ECOM_LIST_ORDERS',
  EcomListShops: 'ECOM_LIST_SHOPS',
  EcomMarkConversationRead: 'ECOM_MARK_CONVERSATION_READ',
  EcomRejectCancellation: 'ECOM_REJECT_CANCELLATION',
  EcomRejectReturn: 'ECOM_REJECT_RETURN',
  EcomSearchCancellations: 'ECOM_SEARCH_CANCELLATIONS',
  EcomSearchCsSessions: 'ECOM_SEARCH_CS_SESSIONS',
  EcomSearchPackages: 'ECOM_SEARCH_PACKAGES',
  EcomSearchProducts: 'ECOM_SEARCH_PRODUCTS',
  EcomSearchReturns: 'ECOM_SEARCH_RETURNS',
  EcomUpdateInventory: 'ECOM_UPDATE_INVENTORY',
  EcomUpdateShop: 'ECOM_UPDATE_SHOP'
} as const;

export type ToolId = typeof ToolId[keyof typeof ToolId];
/** Parameter specification for a dynamically registered tool */
export interface ToolParamSpec {
  children?: Maybe<Array<ToolParamSpec>>;
  defaultValue?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  enumValues?: Maybe<Array<Scalars['String']['output']>>;
  graphqlVar: Scalars['String']['output'];
  /** True when the parameter accepts a list/array of values */
  isList?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  /** True when the parameter accepts an explicit null value */
  nullable?: Maybe<Scalars['Boolean']['output']>;
  required: Scalars['Boolean']['output'];
  type: Scalars['String']['output'];
}

/** Complete tool specification for dynamic client-side registration */
export interface ToolSpec {
  category: ToolCategory;
  contextBindings?: Maybe<Array<ToolContextBinding>>;
  description: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  /** GraphQL operation string (null for REST tools) */
  graphqlOperation?: Maybe<Scalars['String']['output']>;
  id: ToolId;
  name: Scalars['String']['output'];
  operationType: Scalars['String']['output'];
  parameters: Array<ToolParamSpec>;
  /** Dot-notation field paths hidden from the agent response */
  prune?: Maybe<Array<Scalars['String']['output']>>;
  /** REST content type */
  restContentType?: Maybe<Scalars['String']['output']>;
  /** REST endpoint path (for non-GraphQL tools) */
  restEndpoint?: Maybe<Scalars['String']['output']>;
  /** REST HTTP method */
  restMethod?: Maybe<Scalars['String']['output']>;
  /** Agent-facing result contract schema */
  resultSchema?: Maybe<Scalars['String']['output']>;
  runProfiles?: Maybe<Array<SystemRunProfile>>;
  supportedPlatforms?: Maybe<Array<Scalars['String']['output']>>;
  /** True when clients may expose persistResult for this tool */
  supportsPersistResult?: Maybe<Scalars['Boolean']['output']>;
  surfaces?: Maybe<Array<SystemSurface>>;
}

/** One active shop SKU that cannot be safely resolved to canonical InventoryGood. */
export interface UnrecognizedShopSku {
  /** SKU currency, when available from the platform product search response. */
  currency?: Maybe<Scalars['String']['output']>;
  /** SKU sale price, when available from the platform product search response. */
  price?: Maybe<Scalars['String']['output']>;
  /** Platform product ID that owns this SKU. */
  productId: Scalars['String']['output'];
  /** First platform product image URL, when available. */
  productImageUrl?: Maybe<Scalars['String']['output']>;
  /** Platform product title for review context. */
  productTitle?: Maybe<Scalars['String']['output']>;
  /** Why this SKU needs user or AI mapping work before inventory writes are safe. */
  reason: Scalars['String']['output'];
  /** Resolution state produced by exact SKU and explicit mapping rules. */
  resolutionType: InventoryGoodIdentityResolutionType;
  /** Platform seller SKU. Missing when the platform SKU has no seller SKU. */
  sellerSku?: Maybe<Scalars['String']['output']>;
  /** Platform SKU ID. */
  skuId: Scalars['String']['output'];
  /** Total stock quantity across platform inventory rows, when available. */
  stockQuantity?: Maybe<Scalars['Int']['output']>;
}

/** One WMS inventory good that does not exist as an active canonical InventoryGood. */
export interface UnrecognizedWmsInventoryGood {
  barcode?: Maybe<Scalars['String']['output']>;
  countryOfOrigin?: Maybe<Scalars['String']['output']>;
  declaredValue?: Maybe<Scalars['Float']['output']>;
  declaredValueCurrency?: Maybe<Scalars['String']['output']>;
  dimensionUnit?: Maybe<InventoryDimensionUnit>;
  gtin?: Maybe<Scalars['String']['output']>;
  heightValue?: Maybe<Scalars['Float']['output']>;
  hsCode?: Maybe<Scalars['String']['output']>;
  /** External WMS image URL that can be imported during sync. */
  imageUrl?: Maybe<Scalars['String']['output']>;
  isBattery?: Maybe<Scalars['Boolean']['output']>;
  isHazmat?: Maybe<Scalars['Boolean']['output']>;
  lengthValue?: Maybe<Scalars['Float']['output']>;
  /** WMS goods name. */
  name: Scalars['String']['output'];
  /** Why this WMS good needs InventoryGood sync or review. */
  reason: Scalars['String']['output'];
  /** WMS goods SKU. */
  sku: Scalars['String']['output'];
  weightUnit?: Maybe<InventoryWeightUnit>;
  weightValue?: Maybe<Scalars['Float']['output']>;
  widthValue?: Maybe<Scalars['Float']['output']>;
}

/** Update notification payload */
export interface UpdatePayload {
  version: Scalars['String']['output'];
}

/** Input for updating an existing RunProfile */
export interface UpdateRunProfileInput {
  name?: InputMaybe<Scalars['String']['input']>;
  selectedToolIds?: InputMaybe<Array<Scalars['String']['input']>>;
  surfaceId?: InputMaybe<Scalars['String']['input']>;
}

/** Input for updating an existing shop */
export interface UpdateShopInput {
  alias?: InputMaybe<Scalars['String']['input']>;
  authStatus?: InputMaybe<ShopAuthStatus>;
  grantedScopes?: InputMaybe<Array<Scalars['String']['input']>>;
  region?: InputMaybe<ShopRegion>;
  services?: InputMaybe<ShopServiceConfigInput>;
  shopName?: InputMaybe<Scalars['String']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
  timezoneSource?: InputMaybe<ShopTimezoneSource>;
}

/** Input for updating an existing Surface */
export interface UpdateSurfaceInput {
  allowedToolIds?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
}

/** Subscription plan tiers */
export const UserPlan = {
  Enterprise: 'ENTERPRISE',
  Free: 'FREE',
  Max: 'MAX',
  Plus: 'PLUS',
  Pro: 'PRO'
} as const;

export type UserPlan = typeof UserPlan[keyof typeof UserPlan];
/** User subscription record */
export interface UserSubscription {
  createdAt: Scalars['DateTimeISO']['output'];
  plan: UserPlan;
  seatsMax: Scalars['Int']['output'];
  seatsUsed: Scalars['Int']['output'];
  status: SubscriptionStatus;
  stripeSubscriptionId?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
  validUntil: Scalars['DateTimeISO']['output'];
}

export interface VerifyPairingResult {
  accessToken: Scalars['String']['output'];
  desktopDeviceId: Scalars['String']['output'];
  pairingId: Scalars['String']['output'];
  relayUrl: Scalars['String']['output'];
}

/** Result of shop access verification */
export interface VerifyShopAccessResult {
  authorized: Array<Scalars['String']['output']>;
  unauthorized: Array<Scalars['String']['output']>;
}

export interface WaitPairingResult {
  accessToken?: Maybe<Scalars['String']['output']>;
  desktopDeviceId?: Maybe<Scalars['String']['output']>;
  mobileDeviceId?: Maybe<Scalars['String']['output']>;
  paired: Scalars['Boolean']['output'];
  pairingId?: Maybe<Scalars['String']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  relayUrl?: Maybe<Scalars['String']['output']>;
}

/** Canonical warehouse identity used by inventory management */
export interface Warehouse {
  address?: Maybe<WarehouseAddress>;
  /** Merchant or provider-facing warehouse code, such as DYY-NY. */
  code?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  /** Provider warehouse ID, such as fbt_warehouse_id or Yejoin storage code. */
  externalWarehouseId?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lastSyncedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  name: Scalars['String']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  provider: WarehouseProvider;
  regionCode?: Maybe<Scalars['String']['output']>;
  /** System-local source connection ID, such as WmsAccount._id or Shop._id. */
  sourceId?: Maybe<Scalars['ID']['output']>;
  status: WarehouseStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
  warehouseType: WarehouseType;
}

/** Warehouse address snapshot */
export interface WarehouseAddress {
  addressLine1?: Maybe<Scalars['String']['output']>;
  addressLine2?: Maybe<Scalars['String']['output']>;
  city?: Maybe<Scalars['String']['output']>;
  district?: Maybe<Scalars['String']['output']>;
  fullAddress?: Maybe<Scalars['String']['output']>;
  postalCode?: Maybe<Scalars['String']['output']>;
  region?: Maybe<Scalars['String']['output']>;
  regionCode?: Maybe<Scalars['String']['output']>;
  state?: Maybe<Scalars['String']['output']>;
}

/** Warehouse address patch */
export interface WarehouseAddressInput {
  /** Primary street address line. */
  addressLine1?: InputMaybe<Scalars['String']['input']>;
  /** Secondary address line, suite, unit, or building details. */
  addressLine2?: InputMaybe<Scalars['String']['input']>;
  /** City. */
  city?: InputMaybe<Scalars['String']['input']>;
  /** District, county, or local administrative area. */
  district?: InputMaybe<Scalars['String']['input']>;
  /** Full address string as returned by the source system. */
  fullAddress?: InputMaybe<Scalars['String']['input']>;
  /** Postal or ZIP code. */
  postalCode?: InputMaybe<Scalars['String']['input']>;
  /** Country or region display name returned by the source system. */
  region?: InputMaybe<Scalars['String']['input']>;
  /** Country or region code for the warehouse address, preferably ISO 3166-1 alpha-2. */
  regionCode?: InputMaybe<Scalars['String']['input']>;
  /** State or province. */
  state?: InputMaybe<Scalars['String']['input']>;
}

/** System or provider that owns the physical or platform warehouse */
export const WarehouseProvider = {
  AmazonFba: 'AMAZON_FBA',
  Seller: 'SELLER',
  TiktokFbt: 'TIKTOK_FBT',
  Yejoin: 'YEJOIN'
} as const;

export type WarehouseProvider = typeof WarehouseProvider[keyof typeof WarehouseProvider];
/** Lifecycle state of a canonical warehouse */
export const WarehouseStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED'
} as const;

export type WarehouseStatus = typeof WarehouseStatus[keyof typeof WarehouseStatus];
/** Business type of a canonical warehouse */
export const WarehouseType = {
  OfficialPlatform: 'OFFICIAL_PLATFORM',
  SellerManaged: 'SELLER_MANAGED',
  ThirdPartyWms: 'THIRD_PARTY_WMS'
} as const;

export type WarehouseType = typeof WarehouseType[keyof typeof WarehouseType];
/** Third-party WMS API account connection */
export interface WmsAccount {
  createdAt: Scalars['DateTimeISO']['output'];
  endpoint: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  lastSyncError?: Maybe<Scalars['String']['output']>;
  lastSyncedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  notes?: Maybe<Scalars['String']['output']>;
  provider: WmsAccountProvider;
  status: WmsAccountStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
}

/** Third-party WMS provider */
export const WmsAccountProvider = {
  Yejoin: 'YEJOIN'
} as const;

export type WmsAccountProvider = typeof WmsAccountProvider[keyof typeof WmsAccountProvider];
/** Lifecycle state of a WMS account connection */
export const WmsAccountStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED'
} as const;

export type WmsAccountStatus = typeof WmsAccountStatus[keyof typeof WmsAccountStatus];
/** Read-only coverage view for WMS goods against canonical InventoryGoods. */
export interface WmsInventoryGoodCoveragePayload {
  /** WMS provider that produced these goods. */
  provider: WmsAccountProvider;
  /** WMS goods that need InventoryGood sync or review. */
  unrecognizedWmsInventoryGoods: Array<UnrecognizedWmsInventoryGood>;
  /** WMS account ID that was scanned. */
  wmsAccountId: Scalars['ID']['output'];
}

/** Warehouse management system settings per shop (user-configurable) */
export interface WmsSettings {
  /** Whether WMS/inventory management is enabled for this shop. */
  enabled: Scalars['Boolean']['output'];
}

/** WMS settings patch. Omit a field to keep it, pass null to clear it to default, or pass a value to set it. */
export interface WmsSettingsInput {
  /** WMS/inventory management enabled flag. Omit to keep, null to clear to false, true/false to set. */
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
}

/** Result of syncing warehouses from a WMS account */
export interface WmsWarehouseSyncPayload {
  /** WMS provider that produced the warehouses. */
  provider: WmsAccountProvider;
  /** Number of warehouses read from the WMS and upserted into canonical Warehouse. */
  warehousesSynced: Scalars['Int']['output'];
  /** WMS account ID that was synced. */
  wmsAccountId: Scalars['ID']['output'];
}

/** Write a canonical stockable inventory item. Omit id to locate by exact sku or create a new item. */
export interface WriteInventoryGoodInput {
  barcode?: InputMaybe<Scalars['String']['input']>;
  countryOfOrigin?: InputMaybe<Scalars['String']['input']>;
  declaredValue?: InputMaybe<Scalars['Float']['input']>;
  declaredValueCurrency?: InputMaybe<Scalars['String']['input']>;
  dimensionUnit?: InputMaybe<InventoryDimensionUnit>;
  gtin?: InputMaybe<Scalars['String']['input']>;
  heightValue?: InputMaybe<Scalars['Float']['input']>;
  hsCode?: InputMaybe<Scalars['String']['input']>;
  /** Existing InventoryGood ID to update. Omit to locate by userId + sku. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** Temporary ImageAsset ID to promote. Pass null to clear the current image. */
  imageAssetId?: InputMaybe<Scalars['ID']['input']>;
  /** Temporary image URI to promote. Used only when imageAssetId is unavailable. */
  imageUri?: InputMaybe<Scalars['String']['input']>;
  isBattery?: InputMaybe<Scalars['Boolean']['input']>;
  isHazmat?: InputMaybe<Scalars['Boolean']['input']>;
  lengthValue?: InputMaybe<Scalars['Float']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  sku?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<InventoryGoodStatus>;
  weightUnit?: InputMaybe<InventoryWeightUnit>;
  weightValue?: InputMaybe<Scalars['Float']['input']>;
  widthValue?: InputMaybe<Scalars['Float']['input']>;
}

/** Write a sparse external SKU to InventoryGood mapping. Omit id to locate by sourceSystem + sourceId + sellerSku. */
export interface WriteInventoryGoodMappingInput {
  /** Existing InventoryGoodMapping ID to update. Omit to locate by natural key. */
  id?: InputMaybe<Scalars['ID']['input']>;
  inventoryGoodId?: InputMaybe<Scalars['ID']['input']>;
  lastSeenAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  sellerSku?: InputMaybe<Scalars['String']['input']>;
  sourceId?: InputMaybe<Scalars['ID']['input']>;
  sourceSystem?: InputMaybe<InventoryGoodMappingSourceSystem>;
  status?: InputMaybe<InventoryGoodMappingStatus>;
  verificationStatus?: InputMaybe<InventoryGoodMappingVerificationStatus>;
}

/** Write one shop warehouse to canonical warehouse mapping. Pass warehouseId to confirm a mapping; pass null to clear it. */
export interface WriteShopWarehouseMappingInput {
  /** ShopWarehouse ID to update. */
  shopWarehouseId: Scalars['ID']['input'];
  /** Canonical Warehouse ID. Pass null to clear the mapping. */
  warehouseId?: InputMaybe<Scalars['ID']['input']>;
}

/** Write a canonical warehouse. Omit id to create; pass id to update. */
export interface WriteWarehouseInput {
  /** Warehouse address snapshot. Pass null to clear it. */
  address?: InputMaybe<WarehouseAddressInput>;
  /** Merchant or provider-facing warehouse code, such as DYY-NY. */
  code?: InputMaybe<Scalars['String']['input']>;
  /** Provider warehouse ID, such as Yejoin storage code or TikTok fbt_warehouse_id. */
  externalWarehouseId?: InputMaybe<Scalars['String']['input']>;
  /** Existing Warehouse ID to update. Omit to create a new warehouse. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** Last successful source sync timestamp. Usually system-managed. */
  lastSyncedAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  /** Warehouse display name. */
  name?: InputMaybe<Scalars['String']['input']>;
  /** Optional operator notes about this warehouse. */
  notes?: InputMaybe<Scalars['String']['input']>;
  /** Warehouse provider, such as YEJOIN or TIKTOK_FBT. */
  provider?: InputMaybe<WarehouseProvider>;
  /** Country or region code for the warehouse, preferably ISO 3166-1 alpha-2. */
  regionCode?: InputMaybe<Scalars['String']['input']>;
  /** Source connection ID, such as WmsAccount._id or Shop._id. */
  sourceId?: InputMaybe<Scalars['ID']['input']>;
  /** Lifecycle status. Use ARCHIVED instead of hard deleting. */
  status?: InputMaybe<WarehouseStatus>;
  /** Warehouse business type, such as OFFICIAL_PLATFORM or THIRD_PARTY_WMS. */
  warehouseType?: InputMaybe<WarehouseType>;
}

/** Write a WMS account. Omit id to locate by provider + label or create a new account. apiToken is write-only. */
export interface WriteWmsAccountInput {
  /** WMS API token/key. Stored write-only and never exposed by WmsAccount. */
  apiToken?: InputMaybe<Scalars['String']['input']>;
  /** Base API endpoint for this WMS account. */
  endpoint?: InputMaybe<Scalars['String']['input']>;
  /** Existing WmsAccount ID to update. Omit to create a new account. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** User-facing account label, unique per provider for the user. */
  label?: InputMaybe<Scalars['String']['input']>;
  /** Most recent sync error message, if any. Usually system-managed. */
  lastSyncError?: InputMaybe<Scalars['String']['input']>;
  /** Last successful warehouse sync timestamp. Usually system-managed. */
  lastSyncedAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  /** Optional operator notes about this WMS connection. */
  notes?: InputMaybe<Scalars['String']['input']>;
  /** WMS provider implementation. Required when creating a new account. */
  provider?: InputMaybe<WmsAccountProvider>;
  /** Lifecycle status. Use ARCHIVED instead of hard deleting. */
  status?: InputMaybe<WmsAccountStatus>;
}

/** Result of writing a WMS account */
export interface WriteWmsAccountPayload {
  /** Created or updated WMS account. apiToken is never returned. */
  account: WmsAccount;
  /** Sync result when the account is new or its endpoint/apiToken changed. */
  sync?: Maybe<WmsWarehouseSyncPayload>;
}
