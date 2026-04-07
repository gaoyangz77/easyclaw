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

/** Agent-facing CS settings (no device-level fields) */
export interface AgentCsSettingsInput {
  /** Business-specific instructions appended to the platform CS prompt (e.g. return policy, greeting style). Shown to the AI agent as 'Store Instructions'. */
  businessPrompt?: InputMaybe<Scalars['String']['input']>;
  /** LLM model override for CS sessions (e.g. 'claude-opus-4-5-20251101'). Null or empty = use the account default model. Must be available in the provider's catalog. */
  csModelOverride?: InputMaybe<Scalars['String']['input']>;
  /** LLM provider override for CS sessions (e.g. 'claude', 'zhipu'). Null or empty = use the account default provider. */
  csProviderOverride?: InputMaybe<Scalars['String']['input']>;
  /** Enable or disable CS for this shop. When enabled together with a device assignment, the shop goes online for customer service. */
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** Channel ID for human escalation messages, format: 'channel:accountId' (e.g. 'telegram:acct_abc123'). Null = escalation not configured. */
  escalationChannelId?: InputMaybe<Scalars['String']['input']>;
  /** Recipient ID who receives escalation messages (e.g. a Telegram user ID or group ID). Null = escalation not configured. */
  escalationRecipientId?: InputMaybe<Scalars['String']['input']>;
  /** RunProfile ID that controls which tools the CS agent can use. Must reference a valid system preset (e.g. CUSTOMER_SERVICE) or a user-created RunProfile. */
  runProfileId?: InputMaybe<Scalars['String']['input']>;
}

/** Assembled CS system prompt with version */
export interface AssembledPromptResult {
  systemPrompt: Scalars['String']['output'];
  version: Scalars['String']['output'];
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

/** Customer service seat allocation */
export interface CsSeat {
  connectedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  gatewayId: Scalars['String']['output'];
  status: SeatStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
}

/** Session statistics for a shop */
export interface CsSessionStats {
  activeSessions: Scalars['Int']['output'];
  balance: Scalars['Int']['output'];
  balanceExpiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
  totalSessions: Scalars['Int']['output'];
}

/** Per-seat usage record for a billing period */
export interface CsUsageRecord {
  createdAt: Scalars['DateTimeISO']['output'];
  messageCount: Scalars['Int']['output'];
  period: Scalars['String']['output'];
  seatId: Scalars['String']['output'];
  tokenUsage: Scalars['Int']['output'];
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
}

/** Captcha challenge response */
export interface CaptchaResponse {
  svg: Scalars['String']['output'];
  token: Scalars['String']['output'];
}

/** Customer info extracted from conversation participants */
export interface ConversationCustomer {
  nickname: Scalars['String']['output'];
  userId: Scalars['String']['output'];
}

/** Conversation details with typed customer info */
export interface ConversationDetailsResult {
  code: Scalars['Float']['output'];
  customer?: Maybe<ConversationCustomer>;
  data?: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
}

/** Input for creating a new RunProfile */
export interface CreateRunProfileInput {
  name: Scalars['String']['input'];
  selectedToolIds: Array<Scalars['String']['input']>;
  surfaceId: Scalars['String']['input'];
}

/** Input for creating a new Surface */
export interface CreateSurfaceInput {
  allowedCategories: Array<Scalars['String']['input']>;
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

/** Customer service settings per shop (user-configurable) */
export interface CustomerServiceSettings {
  /** Assembled CS system prompt (platform prompt + business prompt). Computed at query time, not stored. */
  assembledPrompt?: Maybe<Scalars['String']['output']>;
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
  /** RunProfile ID for CS agent sessions */
  runProfileId?: Maybe<Scalars['String']['output']>;
}

/** Full CS settings including device-level fields (Panel/backend use) */
export interface CustomerServiceSettingsInput {
  /** Business-specific instructions appended to the platform CS prompt (e.g. return policy, greeting style). Shown to the AI agent as 'Store Instructions'. */
  businessPrompt?: InputMaybe<Scalars['String']['input']>;
  /** Device ID (machine fingerprint) of the desktop instance handling CS. Set by desktop app via Panel UI. Null = no device assigned. */
  csDeviceId?: InputMaybe<Scalars['String']['input']>;
  /** LLM model override for CS sessions (e.g. 'claude-opus-4-5-20251101'). Null or empty = use the account default model. Must be available in the provider's catalog. */
  csModelOverride?: InputMaybe<Scalars['String']['input']>;
  /** LLM provider override for CS sessions (e.g. 'claude', 'zhipu'). Null or empty = use the account default provider. */
  csProviderOverride?: InputMaybe<Scalars['String']['input']>;
  /** Enable or disable CS for this shop. When enabled together with a device assignment, the shop goes online for customer service. */
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** Channel ID for human escalation messages, format: 'channel:accountId' (e.g. 'telegram:acct_abc123'). Null = escalation not configured. */
  escalationChannelId?: InputMaybe<Scalars['String']['input']>;
  /** Recipient ID who receives escalation messages (e.g. a Telegram user ID or group ID). Null = escalation not configured. */
  escalationRecipientId?: InputMaybe<Scalars['String']['input']>;
  /** RunProfile ID that controls which tools the CS agent can use. Must reference a valid system preset (e.g. CUSTOMER_SERVICE) or a user-created RunProfile. */
  runProfileId?: InputMaybe<Scalars['String']['input']>;
}

/** Rich card message type for CS conversations */
export const EcomCardType = {
  LogisticsCard: 'LOGISTICS_CARD',
  OrderCard: 'ORDER_CARD',
  ProductCard: 'PRODUCT_CARD'
} as const;

export type EcomCardType = typeof EcomCardType[keyof typeof EcomCardType];
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
/** Order status filter values */
export const EcomOrderStatus = {
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
/** Package status filter values */
export const EcomPackageStatus = {
  Cancelled: 'CANCELLED',
  Completed: 'COMPLETED',
  Fulfilling: 'FULFILLING',
  Processing: 'PROCESSING'
} as const;

export type EcomPackageStatus = typeof EcomPackageStatus[keyof typeof EcomPackageStatus];
/** Product status filter values */
export const EcomProductStatus = {
  Activate: 'ACTIVATE',
  Deleted: 'DELETED',
  Draft: 'DRAFT',
  Failed: 'FAILED',
  Freeze: 'FREEZE',
  Pending: 'PENDING',
  PlatformDeactivated: 'PLATFORM_DEACTIVATED',
  SellerDeactivated: 'SELLER_DEACTIVATED'
} as const;

export type EcomProductStatus = typeof EcomProductStatus[keyof typeof EcomProductStatus];
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
/** Generic JSON result proxied from e-commerce platform API */
export interface EcommerceApiResult {
  code: Scalars['Float']['output'];
  data?: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
}

/** Feature entitlement identifiers */
export const EntitlementKey = {
  EcomCsRead: 'ECOM_CS_READ',
  EcomCsWrite: 'ECOM_CS_WRITE',
  EcomFulfillmentRead: 'ECOM_FULFILLMENT_READ',
  EcomProductRead: 'ECOM_PRODUCT_READ',
  MultiBrowserProfiles: 'MULTI_BROWSER_PROFILES'
} as const;

export type EntitlementKey = typeof EntitlementKey[keyof typeof EntitlementKey];
export interface GeneratePairingResult {
  code: Scalars['String']['output'];
  qrUrl?: Maybe<Scalars['String']['output']>;
}

/** OAuth initiation response with authorization URL */
export interface InitiateOAuthResponse {
  authUrl: Scalars['String']['output'];
  state: Scalars['String']['output'];
}

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
  /** Allocate a new seat to a gateway */
  allocateSeat: CsSeat;
  /** Create a new run profile */
  createRunProfile: RunProfile;
  /** Create a new surface */
  createSurface: Surface;
  /** End an active CS session for a conversation (idempotent) */
  csEndSession: Scalars['Boolean']['output'];
  /** Get an existing active session or create a new one for a conversation */
  csGetOrCreateSession: CsSessionResult;
  /** Deallocate a seat by ID */
  deallocateSeat: Scalars['Boolean']['output'];
  /** Delete a run profile */
  deleteRunProfile: Scalars['Boolean']['output'];
  /** Delete the session state backup for a profile */
  deleteSessionStateBackup: Scalars['Boolean']['output'];
  /** Disconnect a shop (soft delete — balance preserved for reconnection) */
  deleteShop: Scalars['Boolean']['output'];
  /** Delete a surface */
  deleteSurface: Scalars['Boolean']['output'];
  /** Create a new conversation with a buyer */
  ecommerceCreateConversation: EcommerceApiResult;
  /** Mark a conversation as read */
  ecommerceMarkConversationRead: EcommerceApiResult;
  /** Send a rich card (order, product, or logistics) in a CS conversation. */
  ecommerceSendMessage: EcommerceApiResult;
  /** Update shop settings (agent-facing, flat params) */
  ecommerceUpdateShop: EcommerceApiResult;
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
}


export interface MutationAllocateSeatArgs {
  gatewayId: Scalars['String']['input'];
}


export interface MutationCreateRunProfileArgs {
  input: CreateRunProfileInput;
}


export interface MutationCreateSurfaceArgs {
  input: CreateSurfaceInput;
}


export interface MutationCsEndSessionArgs {
  conversationId: Scalars['String']['input'];
  shopId: Scalars['ID']['input'];
}


export interface MutationCsGetOrCreateSessionArgs {
  buyerUserId: Scalars['String']['input'];
  conversationId: Scalars['String']['input'];
  shopId: Scalars['ID']['input'];
}


export interface MutationDeallocateSeatArgs {
  seatId: Scalars['String']['input'];
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


export interface MutationEcommerceCreateConversationArgs {
  buyerUserId: Scalars['String']['input'];
  orderId?: InputMaybe<Scalars['String']['input']>;
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
  type: EcomCardType;
}


export interface MutationEcommerceUpdateShopArgs {
  customerServiceSettings?: InputMaybe<AgentCsSettingsInput>;
  shopId: Scalars['String']['input'];
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


export interface MutationPublishUpdateArgs {
  downloadUrl?: InputMaybe<Scalars['String']['input']>;
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
  Row: 'ROW',
  Us: 'US'
} as const;

export type PlatformMarket = typeof PlatformMarket[keyof typeof PlatformMarket];
/** Platform type identifier */
export const PlatformType = {
  TiktokShop: 'TIKTOK_SHOP'
} as const;

export type PlatformType = typeof PlatformType[keyof typeof PlatformType];
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
  /** Assemble the full CS system prompt for a shop. DEPRECATED: use the assembledPrompt field on CustomerServiceSettings instead. */
  csAssemblePrompt: AssembledPromptResult;
  /** Get CS session stats for a shop */
  csSessionStats: CsSessionStats;
  /** Get the platform CS skill template content (markdown). Returns null if not configured. */
  csSkillTemplate?: Maybe<Scalars['String']['output']>;
  /** Get customer service performance metrics */
  ecommerceGetCSPerformance: EcommerceApiResult;
  /** Get conversation details */
  ecommerceGetConversationDetails: ConversationDetailsResult;
  /** Get messages of a conversation */
  ecommerceGetConversationMessages: EcommerceApiResult;
  /** Get conversations for a shop */
  ecommerceGetConversations: EcommerceApiResult;
  /** Get fulfillment tracking for an order. Optional buyerUserId for buyer scoping. */
  ecommerceGetFulfillmentTracking: EcommerceApiResult;
  /** Get order details by order ID. */
  ecommerceGetOrder: EcommerceApiResult;
  /** List/search orders. Optional buyerUserId for buyer-scoped queries. */
  ecommerceGetOrders: EcommerceApiResult;
  /** Get package detail by package ID */
  ecommerceGetPackageDetail: EcommerceApiResult;
  /** Get shipping document for a package */
  ecommerceGetPackageShippingDocument: EcommerceApiResult;
  /** Get conversations pending seller reply */
  ecommerceGetPendingConversations: EcommerceApiResult;
  /** Get product details */
  ecommerceGetProduct: EcommerceApiResult;
  /** Search fulfillment packages with optional filters */
  ecommerceSearchPackages: EcommerceApiResult;
  /** Search/list products with optional filters */
  ecommerceSearchProducts: EcommerceApiResult;
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
  /** Get a single run profile by ID */
  runProfile?: Maybe<RunProfile>;
  /** List run profiles for the authenticated user, optionally filtered by surface */
  runProfiles: Array<RunProfile>;
  /** Get seat usage records for a billing period */
  seatUsage: Array<CsUsageRecord>;
  /** List all allocated seats for the current user */
  seats: Array<CsSeat>;
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
  /** Get system preset surfaces (userId=null), optionally filtered by moduleId */
  systemSurfaces: Array<Surface>;
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


export interface QueryCsAssemblePromptArgs {
  shopId: Scalars['String']['input'];
}


export interface QueryCsSessionStatsArgs {
  shopId: Scalars['ID']['input'];
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
  locale?: InputMaybe<Scalars['String']['input']>;
  pageSize: Scalars['Float']['input'];
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetFulfillmentTrackingArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetOrderArgs {
  orderId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
  userId?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryEcommerceGetOrdersArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  pageSize?: InputMaybe<Scalars['Float']['input']>;
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
  status?: InputMaybe<EcomOrderStatus>;
}


export interface QueryEcommerceGetPackageDetailArgs {
  packageId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetPackageShippingDocumentArgs {
  documentFormat?: InputMaybe<EcomDocumentFormat>;
  documentSize?: InputMaybe<EcomDocumentSize>;
  documentType: EcomDocumentType;
  packageId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetPendingConversationsArgs {
  locale?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceGetProductArgs {
  productId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryEcommerceSearchPackagesArgs {
  createTimeGe?: InputMaybe<Scalars['Float']['input']>;
  createTimeLt?: InputMaybe<Scalars['Float']['input']>;
  packageStatus?: InputMaybe<EcomPackageStatus>;
  pageSize: Scalars['Float']['input'];
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
  sortField?: InputMaybe<EcomSortField>;
  sortOrder?: InputMaybe<EcomSortOrder>;
  updateTimeGe?: InputMaybe<Scalars['Float']['input']>;
  updateTimeLt?: InputMaybe<Scalars['Float']['input']>;
}


export interface QueryEcommerceSearchProductsArgs {
  pageSize?: InputMaybe<Scalars['Float']['input']>;
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
  status?: InputMaybe<EcomProductStatus>;
}


export interface QueryPricingArgs {
  appVersion?: InputMaybe<Scalars['String']['input']>;
  deviceId?: InputMaybe<Scalars['String']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  platform?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryRunProfileArgs {
  id: Scalars['ID']['input'];
}


export interface QueryRunProfilesArgs {
  surfaceId?: InputMaybe<Scalars['ID']['input']>;
}


export interface QuerySeatUsageArgs {
  period?: InputMaybe<Scalars['String']['input']>;
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


export interface QuerySystemSurfacesArgs {
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

/** Seat connection states */
export const SeatStatus = {
  Active: 'ACTIVE',
  Suspended: 'SUSPENDED'
} as const;

export type SeatStatus = typeof SeatStatus[keyof typeof SeatStatus];
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
}

/** Input for updating per-shop service toggles */
export interface ShopServiceConfigInput {
  customerService?: InputMaybe<CustomerServiceSettingsInput>;
}

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
  allowedCategories: Array<Scalars['String']['output']>;
  allowedToolIds: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** Module this system preset belongs to. Null for user-created surfaces. */
  moduleId?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  presetId?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId?: Maybe<Scalars['String']['output']>;
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
  EcomProduct: 'ECOM_PRODUCT'
} as const;

export type ToolCategory = typeof ToolCategory[keyof typeof ToolCategory];
/** Context binding for auto-injecting parameters from session context */
export interface ToolContextBinding {
  contextField: Scalars['String']['output'];
  paramName: Scalars['String']['output'];
}

/** Unique tool identifier */
export const ToolId = {
  BrowserProfilesFind: 'BROWSER_PROFILES_FIND',
  BrowserProfilesGet: 'BROWSER_PROFILES_GET',
  BrowserProfilesList: 'BROWSER_PROFILES_LIST',
  BrowserProfilesManage: 'BROWSER_PROFILES_MANAGE',
  EcomCreateConversation: 'ECOM_CREATE_CONVERSATION',
  EcomCsCreateConversation: 'ECOM_CS_CREATE_CONVERSATION',
  EcomCsGetConversations: 'ECOM_CS_GET_CONVERSATIONS',
  EcomCsGetConversationDetails: 'ECOM_CS_GET_CONVERSATION_DETAILS',
  EcomCsGetConversationMessages: 'ECOM_CS_GET_CONVERSATION_MESSAGES',
  EcomCsGetFulfillmentTracking: 'ECOM_CS_GET_FULFILLMENT_TRACKING',
  EcomCsGetOrder: 'ECOM_CS_GET_ORDER',
  EcomCsGetPackageDetail: 'ECOM_CS_GET_PACKAGE_DETAIL',
  EcomCsGetProduct: 'ECOM_CS_GET_PRODUCT',
  EcomCsGetShippingDocument: 'ECOM_CS_GET_SHIPPING_DOCUMENT',
  EcomCsListOrders: 'ECOM_CS_LIST_ORDERS',
  EcomCsSearchPackages: 'ECOM_CS_SEARCH_PACKAGES',
  EcomCsSearchProducts: 'ECOM_CS_SEARCH_PRODUCTS',
  EcomCsSendCard: 'ECOM_CS_SEND_CARD',
  EcomCsSendMedia: 'ECOM_CS_SEND_MEDIA',
  EcomGetConversations: 'ECOM_GET_CONVERSATIONS',
  EcomGetConversationDetails: 'ECOM_GET_CONVERSATION_DETAILS',
  EcomGetConversationMessages: 'ECOM_GET_CONVERSATION_MESSAGES',
  EcomGetCsPerformance: 'ECOM_GET_CS_PERFORMANCE',
  EcomGetFulfillmentTracking: 'ECOM_GET_FULFILLMENT_TRACKING',
  EcomGetOrder: 'ECOM_GET_ORDER',
  EcomGetPackageDetail: 'ECOM_GET_PACKAGE_DETAIL',
  EcomGetPendingConversations: 'ECOM_GET_PENDING_CONVERSATIONS',
  EcomGetProduct: 'ECOM_GET_PRODUCT',
  EcomGetShippingDocument: 'ECOM_GET_SHIPPING_DOCUMENT',
  EcomListOrders: 'ECOM_LIST_ORDERS',
  EcomListShops: 'ECOM_LIST_SHOPS',
  EcomMarkConversationRead: 'ECOM_MARK_CONVERSATION_READ',
  EcomSearchPackages: 'ECOM_SEARCH_PACKAGES',
  EcomSearchProducts: 'ECOM_SEARCH_PRODUCTS',
  EcomSearchSessions: 'ECOM_SEARCH_SESSIONS',
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
  name: Scalars['String']['output'];
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
  /** REST content type */
  restContentType?: Maybe<Scalars['String']['output']>;
  /** REST endpoint path (for non-GraphQL tools) */
  restEndpoint?: Maybe<Scalars['String']['output']>;
  /** REST HTTP method */
  restMethod?: Maybe<Scalars['String']['output']>;
  runProfiles?: Maybe<Array<SystemRunProfile>>;
  supportedPlatforms?: Maybe<Array<Scalars['String']['output']>>;
  surfaces?: Maybe<Array<SystemSurface>>;
}

/** Update notification payload */
export interface UpdatePayload {
  downloadUrl?: Maybe<Scalars['String']['output']>;
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
  authStatus?: InputMaybe<ShopAuthStatus>;
  grantedScopes?: InputMaybe<Array<Scalars['String']['input']>>;
  region?: InputMaybe<ShopRegion>;
  services?: InputMaybe<ShopServiceConfigInput>;
  shopName?: InputMaybe<Scalars['String']['input']>;
}

/** Input for updating an existing Surface */
export interface UpdateSurfaceInput {
  allowedCategories?: InputMaybe<Array<Scalars['String']['input']>>;
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
