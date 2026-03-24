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

/** Authentication response with JWT tokens */
export interface AuthPayload {
  accessToken: Scalars['String']['output'];
  refreshToken: Scalars['String']['output'];
  user: MeResponse;
}

/** A tool with its availability status for the current user */
export interface AvailableTool {
  allowed: Scalars['Boolean']['output'];
  category: ToolCategory;
  denialReason?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  id: ToolId;
  requiredEntitlements: Array<Scalars['String']['output']>;
  serviceCategory: ServiceCategory;
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

/** Proxy configuration for a browser profile */
export interface BrowserProfileProxyPolicy {
  /** Proxy authentication string — NOT stored directly, reference to secret store */
  auth?: Maybe<Scalars['String']['output']>;
  baseUrl?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
}

/** Result of resolving the best browser profile for a task */
export interface BrowserProfileResolveForTaskResult {
  profile: BrowserProfile;
  totalCandidates: Scalars['Int']['output'];
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

/** Customer service platform configurations (singleton) */
export interface CsConfig {
  wecom?: Maybe<WeComConfig>;
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

/** Input for creating a new browser profile */
export interface CreateBrowserProfileInput {
  name: Scalars['String']['input'];
  notes?: InputMaybe<Scalars['String']['input']>;
  proxyBaseUrl?: InputMaybe<Scalars['String']['input']>;
  proxyEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  sessionStatePolicy?: InputMaybe<SessionStatePolicyInput>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
}

/** Input for creating a new RunProfile */
export interface CreateRunProfileInput {
  name: Scalars['String']['input'];
  selectedToolIds: Array<Scalars['String']['input']>;
  surfaceId: Scalars['String']['input'];
}

/** Input for creating a new shop connection */
export interface CreateShopInput {
  grantedScopes?: InputMaybe<Array<Scalars['String']['input']>>;
  platform: ShopPlatform;
  platformAppId: Scalars['String']['input'];
  platformShopId: Scalars['String']['input'];
  region: ShopRegion;
  shopName: Scalars['String']['input'];
}

/** Input for creating a new Surface */
export interface CreateSurfaceInput {
  allowedCategories: Array<Scalars['String']['input']>;
  allowedToolIds: Array<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
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
  businessPrompt?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
}

/** Input for updating customer service settings */
export interface CustomerServiceSettingsInput {
  businessPrompt?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
}

/** Result of checking a specific entitlement */
export interface EntitlementCheckResult {
  allowed: Scalars['Boolean']['output'];
  key: EntitlementKey;
  /** Human-readable denial reason */
  reason?: Maybe<Scalars['String']['output']>;
}

/** Feature entitlement identifiers */
export const EntitlementKey = {
  BrowserProfilesAgentWrite: 'BROWSER_PROFILES_AGENT_WRITE',
  BrowserProfilesEdit: 'BROWSER_PROFILES_EDIT',
  MultiBrowserProfiles: 'MULTI_BROWSER_PROFILES',
  TiktokCsRead: 'TIKTOK_CS_READ',
  TiktokCsWrite: 'TIKTOK_CS_WRITE',
  TiktokLogisticsRead: 'TIKTOK_LOGISTICS_READ',
  TiktokProductRead: 'TIKTOK_PRODUCT_READ'
} as const;

export type EntitlementKey = typeof EntitlementKey[keyof typeof EntitlementKey];
/** Entitlement set pushed to desktop on login / subscription change */
export interface EntitlementSetModel {
  /** App IDs the plan grants access to */
  appIds: Array<Scalars['String']['output']>;
  /** Tool categories the plan grants access to */
  categories: Array<Scalars['String']['output']>;
  /** Service categories the plan grants access to */
  serviceCategories: Array<Scalars['String']['output']>;
  /** Service IDs the plan grants access to */
  serviceIds: Array<Scalars['String']['output']>;
  /** Tool IDs the user's plan grants access to */
  toolIds: Array<Scalars['String']['output']>;
}

/** Origin of an entitlement grant */
export const EntitlementSource = {
  Override: 'OVERRIDE',
  Plan: 'PLAN',
  Trial: 'TRIAL'
} as const;

export type EntitlementSource = typeof EntitlementSource[keyof typeof EntitlementSource];
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

/** Product module identifiers */
export const ModuleId = {
  GlobalEcommerceSeller: 'GLOBAL_ECOMMERCE_SELLER'
} as const;

export type ModuleId = typeof ModuleId[keyof typeof ModuleId];

/** Current user profile */
export interface MeResponse {
  createdAt: Scalars['DateTimeISO']['output'];
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

export interface Mutation {
  /** Allocate a new seat to a gateway */
  allocateSeat: CsSeat;
  /** Batch archive browser profiles */
  batchArchiveBrowserProfiles: Scalars['Int']['output'];
  /** Batch delete browser profiles */
  batchDeleteBrowserProfiles: Scalars['Int']['output'];
  /** Handle TikTok OAuth callback (exchange code for tokens) */
  completeTikTokOAuth: OAuthCallbackResponse;
  /** Create a new browser profile */
  createBrowserProfile: BrowserProfile;
  /** Create a new run profile */
  createRunProfile: RunProfile;
  /** Create a new shop connection */
  createShop: Shop;
  /** Create a new surface */
  createSurface: Surface;
  /** Deallocate a seat by ID */
  deallocateSeat: Scalars['Boolean']['output'];
  /** Delete a browser profile permanently */
  deleteBrowserProfile: Scalars['Boolean']['output'];
  /** Delete a run profile */
  deleteRunProfile: Scalars['Boolean']['output'];
  /** Delete the session state backup for a profile */
  deleteSessionStateBackup: Scalars['Boolean']['output'];
  /** Delete/disconnect a shop */
  deleteShop: Scalars['Boolean']['output'];
  /** Enroll in a product module */
  enrollModule: MeResponse;
  /** Delete a surface */
  deleteSurface: Scalars['Boolean']['output'];
  /** Delete WeCom customer service credentials */
  deleteWeComConfig: CsConfig;
  /** Generate a 6-character pairing code for QR display */
  generatePairingCode: GeneratePairingResult;
  /** Generate TikTok OAuth authorization URL */
  initiateTikTokOAuth: InitiateOAuthResponse;
  /** Log in with email and password */
  login: AuthPayload;
  /** Log out (revoke the provided refresh token) */
  logout: Scalars['Boolean']['output'];
  /** Publish an update notification to all connected clients (admin only) */
  publishUpdate: Scalars['Boolean']['output'];
  /** Redeem a service credit to a shop */
  redeemCredit: Scalars['Boolean']['output'];
  /** Refresh an expired access token */
  refreshToken: AuthPayload;
  /** Register a new user account */
  register: AuthPayload;
  /** Request a new captcha challenge */
  requestCaptcha: CaptchaResponse;
  /** Revoke all sessions for the current user (remote logout) */
  revokeAllSessions: Scalars['Int']['output'];
  /** Unenroll from a product module */
  unenrollModule: MeResponse;
  /** Save WeCom customer service credentials */
  saveWeComConfig: CsConfig;
  /** Create a new conversation with a buyer */
  tiktokCreateConversation: TikTokApiResult;
  /** Mark messages as read in a conversation */
  tiktokReadMessage: TikTokApiResult;
  /** Send a message in a conversation */
  tiktokSendMessage: TikTokApiResult;
  /** Update agent settings for a shop */
  tiktokUpdateAgentSettings: TikTokApiResult;
  /** Update an existing browser profile */
  updateBrowserProfile?: Maybe<BrowserProfile>;
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


export interface MutationBatchArchiveBrowserProfilesArgs {
  ids: Array<Scalars['ID']['input']>;
}


export interface MutationBatchDeleteBrowserProfilesArgs {
  ids: Array<Scalars['ID']['input']>;
}


export interface MutationCompleteTikTokOAuthArgs {
  code: Scalars['String']['input'];
  state: Scalars['String']['input'];
}


export interface MutationCreateBrowserProfileArgs {
  input: CreateBrowserProfileInput;
}


export interface MutationCreateRunProfileArgs {
  input: CreateRunProfileInput;
}


export interface MutationCreateShopArgs {
  input: CreateShopInput;
}


export interface MutationCreateSurfaceArgs {
  input: CreateSurfaceInput;
}


export interface MutationDeallocateSeatArgs {
  seatId: Scalars['String']['input'];
}


export interface MutationDeleteBrowserProfileArgs {
  id: Scalars['ID']['input'];
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


export interface MutationEnrollModuleArgs {
  moduleId: ModuleId;
}


export interface MutationDeleteWeComConfigArgs {
  corpId: Scalars['String']['input'];
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


export interface MutationSaveWeComConfigArgs {
  input: WeComConfigInput;
}


export interface MutationTiktokCreateConversationArgs {
  buyerUserId: Scalars['String']['input'];
  orderId?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface MutationTiktokReadMessageArgs {
  conversationId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface MutationTiktokSendMessageArgs {
  content: Scalars['String']['input'];
  conversationId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
  type: Scalars['String']['input'];
}


export interface MutationTiktokUpdateAgentSettingsArgs {
  settings: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface MutationUpdateBrowserProfileArgs {
  id: Scalars['ID']['input'];
  input: UpdateBrowserProfileInput;
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


export interface MutationUnenrollModuleArgs {
  moduleId: ModuleId;
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

/** OAuth callback result */
export interface OAuthCallbackResponse {
  shopId: Scalars['String']['output'];
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
  /** Get available tools for the authenticated user */
  availableTools: Array<AvailableTool>;
  /** Get a single browser profile by ID */
  browserProfile?: Maybe<BrowserProfile>;
  /** Get audit log for a browser profile */
  browserProfileAuditLog: Array<BrowserProfileAuditEntry>;
  /** Get the browser profiles prompt addendum (requires entitlement) */
  browserProfilePromptAddendum?: Maybe<Scalars['String']['output']>;
  /** List browser profiles for the authenticated user */
  browserProfiles: PaginatedBrowserProfiles;
  /** Check whether the user has a specific entitlement */
  checkEntitlement: EntitlementCheckResult;
  /** Check if the authenticated user can access a specific tool */
  checkToolAccess: ToolAccessResult;
  /** Get customer service platform configuration */
  csConfig?: Maybe<CsConfig>;
  /** Get CS session stats for a shop */
  csSessionStats: CsSessionStats;
  /** Returns the current user's entitlement set (toolIds, categories, serviceCategories, appIds, serviceIds) */
  entitlementSet: EntitlementSetModel;
  /** List all entitlements for the authenticated user */
  entitlements: Array<UserEntitlement>;
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
  /** List active PlatformApps (for OAuth target selection) */
  platformApps: Array<PlatformApp>;
  /** Get pricing for all providers */
  pricing: Array<ProviderPricing>;
  /** Resolve the best browser profile for a given task description */
  resolveProfileForTask?: Maybe<BrowserProfileResolveForTaskResult>;
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
  /** Get agent settings for a shop */
  tiktokGetAgentSettings: TikTokApiResult;
  /** Get customer service performance metrics */
  tiktokGetCSPerformance: TikTokApiResult;
  /** Get conversation details */
  tiktokGetConversationDetails: TikTokApiResult;
  /** Get messages in a conversation */
  tiktokGetConversationMessages: TikTokApiResult;
  /** Get conversations for a shop */
  tiktokGetConversations: TikTokApiResult;
  /** Get global seller warehouses */
  tiktokGetGlobalWarehouses: TikTokApiResult;
  /** Get logistics tracking for an order. Optional buyerUserId for buyer scoping. */
  tiktokGetLogisticsTracking: TikTokApiResult;
  /** Get order details. Optional buyerUserId for platform-level buyer scoping. */
  tiktokGetOrder: TikTokApiResult;
  /** List/search orders. Optional buyerUserId for buyer-scoped queries. */
  tiktokGetOrders: TikTokApiResult;
  /** Get product details */
  tiktokGetProduct: TikTokApiResult;
  /** Get warehouse list */
  tiktokGetWarehouses: TikTokApiResult;
  /** Get the full tool registry (all defined tools) */
  toolRegistry: Array<ToolDefinition>;
  /** Batch-verify relay access tokens */
  verifyRelayTokens: Array<RelayTokenResult>;
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


export interface QueryCheckEntitlementArgs {
  key: EntitlementKey;
}


export interface QueryCheckToolAccessArgs {
  toolId: Scalars['String']['input'];
}


export interface QueryCsSessionStatsArgs {
  shopId: Scalars['ID']['input'];
}


export interface QueryPricingArgs {
  appVersion?: InputMaybe<Scalars['String']['input']>;
  deviceId?: InputMaybe<Scalars['String']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  platform?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryResolveProfileForTaskArgs {
  input: ResolveProfileForTaskInput;
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


export interface QueryTiktokGetAgentSettingsArgs {
  shopId: Scalars['String']['input'];
}


export interface QueryTiktokGetCsPerformanceArgs {
  endTime?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
  startTime?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryTiktokGetConversationDetailsArgs {
  conversationId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryTiktokGetConversationMessagesArgs {
  conversationId: Scalars['String']['input'];
  locale?: InputMaybe<Scalars['String']['input']>;
  pageSize: Scalars['Float']['input'];
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryTiktokGetConversationsArgs {
  locale?: InputMaybe<Scalars['String']['input']>;
  pageSize: Scalars['Float']['input'];
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryTiktokGetGlobalWarehousesArgs {
  shopId: Scalars['String']['input'];
  warehouseId?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryTiktokGetLogisticsTrackingArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryTiktokGetOrderArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryTiktokGetOrdersArgs {
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  pageSize?: InputMaybe<Scalars['Float']['input']>;
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
  status?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryTiktokGetProductArgs {
  productId: Scalars['String']['input'];
  shopId: Scalars['String']['input'];
}


export interface QueryTiktokGetWarehousesArgs {
  pageSize?: InputMaybe<Scalars['Float']['input']>;
  pageToken?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryVerifyRelayTokensArgs {
  tokens: Array<Scalars['String']['input']>;
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

/** Input for resolving a browser profile for a task */
export interface ResolveProfileForTaskInput {
  /** Preferred tags to bias profile selection */
  preferredTags?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Description of the task that needs a browser profile */
  taskDescription: Scalars['String']['input'];
}

/** RunProfile entity — defines tool selection for a specific run. userId=null for system presets. */
export interface RunProfile {
  createdAt: Scalars['DateTimeISO']['output'];
  id: Scalars['ID']['output'];
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
/** Tool service category */
export const ServiceCategory = {
  BrowserProfiles: 'BROWSER_PROFILES',
  CustomerService: 'CUSTOMER_SERVICE'
} as const;

export type ServiceCategory = typeof ServiceCategory[keyof typeof ServiceCategory];
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
/** Service-level identifiers for subscription gating */
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

/** Input for session state policy fields */
export interface SessionStatePolicyInput {
  checkpointIntervalSec?: InputMaybe<Scalars['Float']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  mode?: InputMaybe<Scalars['String']['input']>;
  storage?: InputMaybe<Scalars['String']['input']>;
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
  name: Scalars['String']['output'];
  presetId?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId?: Maybe<Scalars['String']['output']>;
}

/** Generic JSON result proxied from TikTok API */
export interface TikTokApiResult {
  code: Scalars['Float']['output'];
  data?: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
}

/** Result of checking access to a specific tool */
export interface ToolAccessResult {
  allowed: Scalars['Boolean']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  toolId: Scalars['String']['output'];
}

/** Tool functional category */
export const ToolCategory = {
  BrowserProfiles: 'BROWSER_PROFILES',
  TiktokCs: 'TIKTOK_CS',
  TiktokLogistics: 'TIKTOK_LOGISTICS',
  TiktokProduct: 'TIKTOK_PRODUCT',
  EcommerceShopMgmt: 'ECOMMERCE_SHOP_MGMT'
} as const;

export type ToolCategory = typeof ToolCategory[keyof typeof ToolCategory];
/** Definition of a tool in the registry */
export interface ToolDefinition {
  category: ToolCategory;
  description: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  id: ToolId;
  requiredEntitlements: Array<Scalars['String']['output']>;
  serviceCategory: ServiceCategory;
}

/** Unique tool identifier */
export const ToolId = {
  BrowserProfilesFind: 'BROWSER_PROFILES_FIND',
  BrowserProfilesGet: 'BROWSER_PROFILES_GET',
  BrowserProfilesList: 'BROWSER_PROFILES_LIST',
  BrowserProfilesManage: 'BROWSER_PROFILES_MANAGE',
  BrowserProfilesTestProxy: 'BROWSER_PROFILES_TEST_PROXY',
  TiktokCreateConversation: 'TIKTOK_CREATE_CONVERSATION',
  TiktokGetAgentSettings: 'TIKTOK_GET_AGENT_SETTINGS',
  TiktokGetConversations: 'TIKTOK_GET_CONVERSATIONS',
  TiktokGetConversationDetails: 'TIKTOK_GET_CONVERSATION_DETAILS',
  TiktokGetConversationMessages: 'TIKTOK_GET_CONVERSATION_MESSAGES',
  TiktokGetCsPerformance: 'TIKTOK_GET_CS_PERFORMANCE',
  EcommerceGetCurrentShop: 'ECOMMERCE_GET_CURRENT_SHOP',
  TiktokGetProduct: 'TIKTOK_GET_PRODUCT',
  TiktokGetShippingProviders: 'TIKTOK_GET_SHIPPING_PROVIDERS',
  EcommerceGetShopAuthStatus: 'ECOMMERCE_GET_SHOP_AUTH_STATUS',
  TiktokGetWarehouses: 'TIKTOK_GET_WAREHOUSES',
  EcommerceListShops: 'ECOMMERCE_LIST_SHOPS',
  TiktokReadMessage: 'TIKTOK_READ_MESSAGE',
  TiktokSearchSessions: 'TIKTOK_SEARCH_SESSIONS',
  TiktokSendMessage: 'TIKTOK_SEND_MESSAGE',
  TiktokUpdateAgentSettings: 'TIKTOK_UPDATE_AGENT_SETTINGS',
  TiktokUploadImage: 'TIKTOK_UPLOAD_IMAGE'
} as const;

export type ToolId = typeof ToolId[keyof typeof ToolId];
/** Input for updating an existing browser profile */
export interface UpdateBrowserProfileInput {
  name?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  proxyBaseUrl?: InputMaybe<Scalars['String']['input']>;
  proxyEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  sessionStatePolicy?: InputMaybe<SessionStatePolicyInput>;
  status?: InputMaybe<BrowserProfileStatus>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
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

/** A single entitlement granted to a user */
export interface UserEntitlement {
  enabled: Scalars['Boolean']['output'];
  key: EntitlementKey;
  source: EntitlementSource;
}

/** Subscription plan tiers */
export const UserPlan = {
  Enterprise: 'ENTERPRISE',
  Free: 'FREE',
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

export interface WaitPairingResult {
  accessToken?: Maybe<Scalars['String']['output']>;
  desktopDeviceId?: Maybe<Scalars['String']['output']>;
  mobileDeviceId?: Maybe<Scalars['String']['output']>;
  paired: Scalars['Boolean']['output'];
  pairingId?: Maybe<Scalars['String']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  relayUrl?: Maybe<Scalars['String']['output']>;
}

/** WeCom (企业微信) customer service credentials */
export interface WeComConfig {
  appSecret: Scalars['String']['output'];
  corpId: Scalars['String']['output'];
  encodingAesKey: Scalars['String']['output'];
  kfLinkId: Scalars['String']['output'];
  openKfId: Scalars['String']['output'];
  token: Scalars['String']['output'];
}

/** Input for saving WeCom customer service credentials */
export interface WeComConfigInput {
  appSecret: Scalars['String']['input'];
  corpId: Scalars['String']['input'];
  encodingAesKey: Scalars['String']['input'];
  kfLinkId: Scalars['String']['input'];
  token: Scalars['String']['input'];
}
