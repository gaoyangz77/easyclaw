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

/** Input for acknowledging a CS escalation event */
export interface AckCsEscalationEventInput {
  eventId: Scalars['ID']['input'];
  success: Scalars['Boolean']['input'];
}

/** Human-reviewable action proposed by an agent after policy evaluation. */
export interface ActionProposal {
  approvalPolicyUpdateIntent?: Maybe<ActionProposalApprovalPolicyUpdateIntent>;
  blockCreatorIntent?: Maybe<ActionProposalBlockCreatorIntent>;
  campaignId?: Maybe<Scalars['ID']['output']>;
  campaignProductUpdateIntent?: Maybe<ActionProposalCampaignProductUpdateIntent>;
  candidateDecisionIntent?: Maybe<ActionProposalCandidateDecisionIntent>;
  collaborationRecordId?: Maybe<Scalars['ID']['output']>;
  collaborationRecordLastSignalAt?: Maybe<Scalars['DateTimeISO']['output']>;
  collaborationRecordStateUpdatedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  creatorId?: Maybe<Scalars['ID']['output']>;
  /** Best-known creator identity for staff review display. This is a profile projection, not proposal execution input. */
  creatorProfile?: Maybe<CreatorGlobalProfile>;
  creatorTagIntent?: Maybe<ActionProposalCreatorTagIntent>;
  decision?: Maybe<ActionProposalDecisionSnapshot>;
  executionResult?: Maybe<ActionProposalExecutionResultSnapshot>;
  expiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
  id: Scalars['ID']['output'];
  messageIntent?: Maybe<ActionProposalMessageIntent>;
  /** Staff-facing proposal summary. Creator-facing text, if any, lives in messageIntent.text or a message step. */
  operatorSummary: Scalars['String']['output'];
  policySnapshot?: Maybe<ActionProposalPolicySnapshot>;
  sampleReviewIntent?: Maybe<ActionProposalSampleReviewIntent>;
  sampleShipmentIntent?: Maybe<ActionProposalSampleShipmentIntent>;
  shopId: Scalars['ID']['output'];
  status: ActionProposalStatus;
  /** Frozen ordered action steps. Current single-action proposals contain exactly one step. */
  steps: Array<ActionProposalStep>;
  targetCollaborationIntent?: Maybe<ActionProposalTargetCollaborationIntent>;
  type: ActionProposalType;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

export interface ActionProposalApprovalPolicyUpdateIntent {
  action: AffiliatePolicyAction;
  campaignIds?: Maybe<Array<Scalars['ID']['output']>>;
  creatorTagIds?: Maybe<Array<Scalars['ID']['output']>>;
  enabled: Scalars['Boolean']['output'];
  policyId?: Maybe<Scalars['ID']['output']>;
  productIds?: Maybe<Array<Scalars['String']['output']>>;
  reason?: Maybe<Scalars['String']['output']>;
}

export interface ActionProposalApprovalPolicyUpdateIntentInput {
  action: AffiliatePolicyAction;
  campaignIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  creatorTagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  enabled: Scalars['Boolean']['input'];
  policyId?: InputMaybe<Scalars['ID']['input']>;
  productIds?: InputMaybe<Array<Scalars['String']['input']>>;
  reason?: InputMaybe<Scalars['String']['input']>;
}

export interface ActionProposalBlockCreatorIntent {
  creatorId: Scalars['ID']['output'];
  reason?: Maybe<Scalars['String']['output']>;
}

export interface ActionProposalBlockCreatorIntentInput {
  creatorId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
}

export interface ActionProposalCampaignProductUpdateIntent {
  campaignId: Scalars['ID']['output'];
  campaignProductId?: Maybe<Scalars['ID']['output']>;
  commissionRate?: Maybe<Scalars['Float']['output']>;
  maxCommissionRate?: Maybe<Scalars['Float']['output']>;
  productId: Scalars['String']['output'];
  promotionPriority?: Maybe<CampaignProductPromotionPriority>;
  sampleOfferMode?: Maybe<CampaignProductSampleOfferMode>;
  sampleQuota?: Maybe<Scalars['Int']['output']>;
  sampleUnitCostAmount?: Maybe<Scalars['Float']['output']>;
  sampleUnitCostCurrency?: Maybe<EcomProductSkuCurrency>;
}

export interface ActionProposalCampaignProductUpdateIntentInput {
  campaignId: Scalars['ID']['input'];
  campaignProductId?: InputMaybe<Scalars['ID']['input']>;
  commissionRate?: InputMaybe<Scalars['Float']['input']>;
  maxCommissionRate?: InputMaybe<Scalars['Float']['input']>;
  productId: Scalars['String']['input'];
  promotionPriority?: InputMaybe<CampaignProductPromotionPriority>;
  sampleOfferMode?: InputMaybe<CampaignProductSampleOfferMode>;
  sampleQuota?: InputMaybe<Scalars['Int']['input']>;
  sampleUnitCostAmount?: InputMaybe<Scalars['Float']['input']>;
  sampleUnitCostCurrency?: InputMaybe<EcomProductSkuCurrency>;
}

export interface ActionProposalCandidateDecisionIntent {
  candidateIds: Array<Scalars['ID']['output']>;
  evidenceItems?: Maybe<Array<CreatorCandidateEvidence>>;
  rationale?: Maybe<Scalars['String']['output']>;
  status: CreatorCandidateStatus;
}

export interface ActionProposalCandidateDecisionIntentInput {
  candidateIds: Array<Scalars['ID']['input']>;
  evidenceItems?: InputMaybe<Array<CreatorCandidateEvidenceInput>>;
  rationale?: InputMaybe<Scalars['String']['input']>;
  status: CreatorCandidateStatus;
}

export interface ActionProposalCreatorTagIntent {
  creatorId: Scalars['ID']['output'];
  tagId: Scalars['ID']['output'];
}

export interface ActionProposalCreatorTagIntentInput {
  creatorId: Scalars['ID']['input'];
  tagId: Scalars['ID']['input'];
}

export interface ActionProposalDecisionSnapshot {
  decidedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  decidedByActorId?: Maybe<Scalars['String']['output']>;
  note?: Maybe<Scalars['String']['output']>;
}

export interface ActionProposalDecisionSnapshotInput {
  decidedAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  decidedByActorId?: InputMaybe<Scalars['String']['input']>;
  note?: InputMaybe<Scalars['String']['input']>;
}

export interface ActionProposalExecutionResultSnapshot {
  domainObjectId?: Maybe<Scalars['ID']['output']>;
  errorMessage?: Maybe<Scalars['String']['output']>;
  executedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  lifecycleEventIds: Array<Scalars['ID']['output']>;
  platformObjectId?: Maybe<Scalars['String']['output']>;
}

export interface ActionProposalMessageIntent {
  affiliateCollaborationId?: Maybe<Scalars['ID']['output']>;
  conversationId?: Maybe<Scalars['String']['output']>;
  creatorId?: Maybe<Scalars['ID']['output']>;
  creatorOpenId?: Maybe<Scalars['String']['output']>;
  imageHeight?: Maybe<Scalars['Int']['output']>;
  imageUrl?: Maybe<Scalars['String']['output']>;
  imageWidth?: Maybe<Scalars['Int']['output']>;
  messageType: AffiliateOutboundMessageType;
  platformApplicationId?: Maybe<Scalars['String']['output']>;
  platformTargetCollaborationId?: Maybe<Scalars['String']['output']>;
  productId?: Maybe<Scalars['String']['output']>;
  sampleApplicationRecordId?: Maybe<Scalars['ID']['output']>;
  text?: Maybe<Scalars['String']['output']>;
}

export interface ActionProposalMessageIntentInput {
  affiliateCollaborationId?: InputMaybe<Scalars['ID']['input']>;
  conversationId?: InputMaybe<Scalars['String']['input']>;
  creatorId?: InputMaybe<Scalars['ID']['input']>;
  creatorOpenId?: InputMaybe<Scalars['String']['input']>;
  imageHeight?: InputMaybe<Scalars['Int']['input']>;
  imageUrl?: InputMaybe<Scalars['String']['input']>;
  imageWidth?: InputMaybe<Scalars['Int']['input']>;
  messageType: AffiliateOutboundMessageType;
  platformApplicationId?: InputMaybe<Scalars['String']['input']>;
  platformTargetCollaborationId?: InputMaybe<Scalars['String']['input']>;
  productId?: InputMaybe<Scalars['String']['input']>;
  sampleApplicationRecordId?: InputMaybe<Scalars['ID']['input']>;
  text?: InputMaybe<Scalars['String']['input']>;
}

export interface ActionProposalPolicySnapshot {
  action: AffiliatePolicyAction;
  matchedPolicyIds: Array<Scalars['ID']['output']>;
  reasons: Array<Scalars['String']['output']>;
  requiresApproval: Scalars['Boolean']['output'];
}

export interface ActionProposalSampleReviewIntent {
  decision?: Maybe<AffiliateSampleReviewDecision>;
  platformApplicationId: Scalars['String']['output'];
  rejectReason?: Maybe<AffiliateSampleRejectReason>;
  sampleApplicationRecordId: Scalars['ID']['output'];
}

export interface ActionProposalSampleReviewIntentInput {
  decision?: InputMaybe<AffiliateSampleReviewDecision>;
  platformApplicationId: Scalars['String']['input'];
  rejectReason?: InputMaybe<AffiliateSampleRejectReason>;
  sampleApplicationRecordId: Scalars['ID']['input'];
}

export interface ActionProposalSampleShipmentIntent {
  platformApplicationId?: Maybe<Scalars['String']['output']>;
  quantity?: Maybe<Scalars['Int']['output']>;
  sampleApplicationRecordId: Scalars['ID']['output'];
  skuId?: Maybe<Scalars['String']['output']>;
  warehouseId?: Maybe<Scalars['ID']['output']>;
}

export interface ActionProposalSampleShipmentIntentInput {
  platformApplicationId?: InputMaybe<Scalars['String']['input']>;
  quantity?: InputMaybe<Scalars['Int']['input']>;
  sampleApplicationRecordId: Scalars['ID']['input'];
  skuId?: InputMaybe<Scalars['String']['input']>;
  warehouseId?: InputMaybe<Scalars['ID']['input']>;
}

export interface ActionProposalSellerContactInfoIntent {
  email: Scalars['String']['output'];
  line?: Maybe<Scalars['String']['output']>;
  phoneNumber?: Maybe<Scalars['String']['output']>;
  telegram?: Maybe<Scalars['String']['output']>;
  whatsapp?: Maybe<Scalars['String']['output']>;
}

export interface ActionProposalSellerContactInfoIntentInput {
  email: Scalars['String']['input'];
  line?: InputMaybe<Scalars['String']['input']>;
  phoneNumber?: InputMaybe<Scalars['String']['input']>;
  telegram?: InputMaybe<Scalars['String']['input']>;
  whatsapp?: InputMaybe<Scalars['String']['input']>;
}

export const ActionProposalStatus = {
  Approved: 'APPROVED',
  Executed: 'EXECUTED',
  Expired: 'EXPIRED',
  Modified: 'MODIFIED',
  Pending: 'PENDING',
  Rejected: 'REJECTED',
  Superseded: 'SUPERSEDED'
} as const;

export type ActionProposalStatus = typeof ActionProposalStatus[keyof typeof ActionProposalStatus];
export interface ActionProposalStep {
  approvalPolicyUpdateIntent?: Maybe<ActionProposalApprovalPolicyUpdateIntent>;
  blockCreatorIntent?: Maybe<ActionProposalBlockCreatorIntent>;
  campaignProductUpdateIntent?: Maybe<ActionProposalCampaignProductUpdateIntent>;
  candidateDecisionIntent?: Maybe<ActionProposalCandidateDecisionIntent>;
  creatorTagIntent?: Maybe<ActionProposalCreatorTagIntent>;
  messageIntent?: Maybe<ActionProposalMessageIntent>;
  /** Staff-facing summary for this action step. Use the desktop/operator language. */
  operatorSummary: Scalars['String']['output'];
  sampleReviewIntent?: Maybe<ActionProposalSampleReviewIntent>;
  sampleShipmentIntent?: Maybe<ActionProposalSampleShipmentIntent>;
  stepId: Scalars['String']['output'];
  targetCollaborationIntent?: Maybe<ActionProposalTargetCollaborationIntent>;
  type: ActionProposalType;
}

export interface ActionProposalTargetCollaborationIntent {
  creatorIds?: Maybe<Array<Scalars['ID']['output']>>;
  creatorOpenIds?: Maybe<Array<Scalars['String']['output']>>;
  endTime: Scalars['DateTimeISO']['output'];
  hasFreeSample: Scalars['Boolean']['output'];
  isSampleApprovalExempt: Scalars['Boolean']['output'];
  message?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  products: Array<ActionProposalTargetCollaborationProductIntent>;
  sellerContactInfo: ActionProposalSellerContactInfoIntent;
}

export interface ActionProposalTargetCollaborationIntentInput {
  creatorIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  creatorOpenIds?: InputMaybe<Array<Scalars['String']['input']>>;
  endTime: Scalars['DateTimeISO']['input'];
  hasFreeSample: Scalars['Boolean']['input'];
  isSampleApprovalExempt: Scalars['Boolean']['input'];
  message?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  products: Array<ActionProposalTargetCollaborationProductIntentInput>;
  sellerContactInfo: ActionProposalSellerContactInfoIntentInput;
}

export interface ActionProposalTargetCollaborationProductIntent {
  productId: Scalars['String']['output'];
  shopAdsCommissionRateBps?: Maybe<Scalars['Int']['output']>;
  targetCommissionRateBps: Scalars['Int']['output'];
}

export interface ActionProposalTargetCollaborationProductIntentInput {
  productId: Scalars['String']['input'];
  shopAdsCommissionRateBps?: InputMaybe<Scalars['Int']['input']>;
  targetCommissionRateBps: Scalars['Int']['input'];
}

export const ActionProposalType = {
  AddCreatorTag: 'ADD_CREATOR_TAG',
  ApproveSample: 'APPROVE_SAMPLE',
  BlockCreator: 'BLOCK_CREATOR',
  CreateTargetCollaboration: 'CREATE_TARGET_COLLABORATION',
  RecordCandidateDecision: 'RECORD_CANDIDATE_DECISION',
  RejectSample: 'REJECT_SAMPLE',
  RemoveCreatorTag: 'REMOVE_CREATOR_TAG',
  SendMessage: 'SEND_MESSAGE',
  ShipSample: 'SHIP_SAMPLE',
  UpdateApprovalPolicy: 'UPDATE_APPROVAL_POLICY',
  UpdateCampaignProduct: 'UPDATE_CAMPAIGN_PRODUCT'
} as const;

export type ActionProposalType = typeof ActionProposalType[keyof typeof ActionProposalType];
/** Subscription payload for a changed affiliate action proposal. */
export interface AffiliateActionProposalChanged {
  proposal: ActionProposal;
}

/** Result mode for an affiliate action request after backend policy evaluation. */
export const AffiliateActionRequestMode = {
  Executed: 'EXECUTED',
  ProposalCreated: 'PROPOSAL_CREATED'
} as const;

export type AffiliateActionRequestMode = typeof AffiliateActionRequestMode[keyof typeof AffiliateActionRequestMode];
/** Approval interception policy for affiliate actions. If all non-empty condition arrays match, the backend creates an ActionProposal instead of executing automatically. */
export interface AffiliateApprovalPolicy {
  action: AffiliatePolicyAction;
  /** AND condition dimension. Empty means any campaign. */
  campaignIds: Array<Scalars['ID']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  /** AND condition dimension. Empty means any creator tags. Non-empty matches when the creator has at least one listed tag. */
  creatorTagIds: Array<Scalars['ID']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  /** AND condition dimension. Empty means any product. */
  productIds: Array<Scalars['String']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  shopId: Scalars['ID']['output'];
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

/** One affiliate campaign objective owned by a TikTok seller shop. */
export interface AffiliateCampaign {
  createdAt: Scalars['DateTimeISO']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  objectiveType: AffiliateCampaignObjectiveType;
  personalizationMode: AffiliateOutreachPersonalizationMode;
  researchDepth: AffiliateResearchDepth;
  shopId: Scalars['ID']['output'];
  status: AffiliateCampaignStatus;
  targetContentCount?: Maybe<Scalars['Int']['output']>;
  targetCreatorCount?: Maybe<Scalars['Int']['output']>;
  targetGmvAmount?: Maybe<Scalars['Float']['output']>;
  targetGmvCurrency?: Maybe<EcomProductSkuCurrency>;
  targetInviteCount?: Maybe<Scalars['Int']['output']>;
  targetOrderCount?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

/** Primary business objective that guides affiliate campaign skills and reporting. */
export const AffiliateCampaignObjectiveType = {
  ContentCount: 'CONTENT_COUNT',
  CreatorCount: 'CREATOR_COUNT',
  Gmv: 'GMV',
  InviteCount: 'INVITE_COUNT',
  OrderCount: 'ORDER_COUNT',
  ProductLaunch: 'PRODUCT_LAUNCH',
  RelationshipMaintenance: 'RELATIONSHIP_MAINTENANCE'
} as const;

export type AffiliateCampaignObjectiveType = typeof AffiliateCampaignObjectiveType[keyof typeof AffiliateCampaignObjectiveType];
export const AffiliateCampaignStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED',
  Completed: 'COMPLETED',
  Draft: 'DRAFT',
  Paused: 'PAUSED'
} as const;

export type AffiliateCampaignStatus = typeof AffiliateCampaignStatus[keyof typeof AffiliateCampaignStatus];
/** Platform-level affiliate collaboration, normalized across TikTok open and target collaborations. */
export interface AffiliateCollaboration {
  campaignId?: Maybe<Scalars['ID']['output']>;
  commissionRate?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  creatorIds: Array<Scalars['ID']['output']>;
  creatorOpenIds: Array<Scalars['String']['output']>;
  effectiveTime?: Maybe<Scalars['DateTimeISO']['output']>;
  id: Scalars['ID']['output'];
  platformCollaborationId: Scalars['String']['output'];
  platformUpdatedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  productIds: Array<Scalars['String']['output']>;
  shopId: Scalars['ID']['output'];
  status: AffiliateCollaborationStatus;
  type: AffiliateCollaborationType;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

/** One creator-product collaboration attempt. If a creator promotes the same product twice, create two collaborations. */
export interface AffiliateCollaborationRecord {
  affiliateCollaborationId?: Maybe<Scalars['ID']['output']>;
  collaborationType?: Maybe<AffiliateCollaborationType>;
  createdAt: Scalars['DateTimeISO']['output'];
  creatorId: Scalars['ID']['output'];
  creatorImId?: Maybe<Scalars['String']['output']>;
  endedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  id: Scalars['ID']['output'];
  lastCreatorMessageAt?: Maybe<Scalars['DateTimeISO']['output']>;
  lastCreatorMessageId?: Maybe<Scalars['String']['output']>;
  lastSignalAt?: Maybe<Scalars['DateTimeISO']['output']>;
  lifecycleStage: AffiliateLifecycleStage;
  nextSellerActionAt?: Maybe<Scalars['DateTimeISO']['output']>;
  platformCollaborationId?: Maybe<Scalars['String']['output']>;
  platformConversationId?: Maybe<Scalars['String']['output']>;
  processReasons: Array<AffiliateCollaborationRecordProcessReason>;
  processingStatus: AffiliateCollaborationRecordProcessingStatus;
  productId?: Maybe<Scalars['String']['output']>;
  sampleApplicationRecordId?: Maybe<Scalars['ID']['output']>;
  shopId: Scalars['ID']['output'];
  startedAt: Scalars['DateTimeISO']['output'];
  stateUpdatedAt: Scalars['DateTimeISO']['output'];
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
  workHandledUntil?: Maybe<Scalars['DateTimeISO']['output']>;
}

/** Typed backend reasons explaining why a creator collaboration is in its processing state. */
export const AffiliateCollaborationRecordProcessReason = {
  AgentRunFailed: 'AGENT_RUN_FAILED',
  ContentPublished: 'CONTENT_PUBLISHED',
  CreatorIdentityUnresolved: 'CREATOR_IDENTITY_UNRESOLVED',
  CreatorMessageNeedsReply: 'CREATOR_MESSAGE_NEEDS_REPLY',
  OrderAttributed: 'ORDER_ATTRIBUTED',
  ProductContextMissing: 'PRODUCT_CONTEXT_MISSING',
  ProposalWaitingApproval: 'PROPOSAL_WAITING_APPROVAL',
  SampleAwaitingShipment: 'SAMPLE_AWAITING_SHIPMENT',
  SamplePendingReview: 'SAMPLE_PENDING_REVIEW',
  SampleShippedContentFollowUpDue: 'SAMPLE_SHIPPED_CONTENT_FOLLOW_UP_DUE',
  StaffReviewRequested: 'STAFF_REVIEW_REQUESTED',
  TargetCollaborationAccepted: 'TARGET_COLLABORATION_ACCEPTED',
  UserLevelBlocked: 'USER_LEVEL_BLOCKED',
  WorkDeferred: 'WORK_DEFERRED'
} as const;

export type AffiliateCollaborationRecordProcessReason = typeof AffiliateCollaborationRecordProcessReason[keyof typeof AffiliateCollaborationRecordProcessReason];
/** Backend-materialized state that tells Desktop/agents whether a creator collaboration needs processing. */
export const AffiliateCollaborationRecordProcessingStatus = {
  Blocked: 'BLOCKED',
  Done: 'DONE',
  NeedProcess: 'NEED_PROCESS',
  WaitingApproval: 'WAITING_APPROVAL',
  WaitingCreator: 'WAITING_CREATOR',
  WaitingPlatform: 'WAITING_PLATFORM',
  WaitingStaff: 'WAITING_STAFF'
} as const;

export type AffiliateCollaborationRecordProcessingStatus = typeof AffiliateCollaborationRecordProcessingStatus[keyof typeof AffiliateCollaborationRecordProcessingStatus];
/** Normalized platform collaboration status for open and target collaborations. */
export const AffiliateCollaborationStatus = {
  Active: 'ACTIVE',
  Cancelled: 'CANCELLED',
  Deleted: 'DELETED',
  Expired: 'EXPIRED',
  Expiring: 'EXPIRING',
  Failed: 'FAILED',
  Paused: 'PAUSED',
  Terminating: 'TERMINATING',
  Unknown: 'UNKNOWN'
} as const;

export type AffiliateCollaborationStatus = typeof AffiliateCollaborationStatus[keyof typeof AffiliateCollaborationStatus];
/** TikTok affiliate collaboration shape: open collaboration or target collaboration. */
export const AffiliateCollaborationType = {
  Open: 'OPEN',
  Target: 'TARGET'
} as const;

export type AffiliateCollaborationType = typeof AffiliateCollaborationType[keyof typeof AffiliateCollaborationType];
/** Direction of an observed affiliate IM message. */
export const AffiliateConversationMessageDirection = {
  Creator: 'CREATOR',
  Seller: 'SELLER',
  System: 'SYSTEM'
} as const;

export type AffiliateConversationMessageDirection = typeof AffiliateConversationMessageDirection[keyof typeof AffiliateConversationMessageDirection];
/** Ephemeral affiliate work signal pushed to desktop after backend materializes a reducer event. */
export interface AffiliateConversationSignal {
  /** AffiliateCollaboration ID when this signal can be tied to a platform collaboration. */
  affiliateCollaborationId?: Maybe<Scalars['ID']['output']>;
  /** AffiliateCollaborationRecord ID produced or updated by the reducer. */
  collaborationRecordId?: Maybe<Scalars['ID']['output']>;
  /** Open or target collaboration type when known. */
  collaborationType?: Maybe<AffiliateCollaborationType>;
  /** Observed content comment count when available. */
  contentCommentCount?: Maybe<Scalars['Float']['output']>;
  /** Observed content description/title when available. */
  contentDescription?: Maybe<Scalars['String']['output']>;
  /** Observed content format, e.g. VIDEO or LIVE. */
  contentFormat?: Maybe<Scalars['String']['output']>;
  /** Platform content ID when tied to content/order attribution sync. */
  contentId?: Maybe<Scalars['String']['output']>;
  /** Observed content like count when available. */
  contentLikeCount?: Maybe<Scalars['Float']['output']>;
  /** Observed TikTok content page link when available. */
  contentPageLink?: Maybe<Scalars['String']['output']>;
  /** Observed paid order count attributed to the content when available. */
  contentPaidOrderCount?: Maybe<Scalars['Float']['output']>;
  /** Observed content source URL when available. */
  contentUrl?: Maybe<Scalars['String']['output']>;
  /** Observed content view count when available. */
  contentViewCount?: Maybe<Scalars['Float']['output']>;
  /** Platform conversation/thread ID when the signal is message-related. */
  conversationId?: Maybe<Scalars['String']['output']>;
  /** Best-known creator avatar URL carried by platform sync when available. */
  creatorAvatarUrl?: Maybe<Scalars['String']['output']>;
  /** Best-known creator follower count carried by platform sync when available. */
  creatorFollowerCount?: Maybe<Scalars['Float']['output']>;
  /** Creator IM user ID when available from the platform event. */
  creatorImId?: Maybe<Scalars['String']['output']>;
  /** Best-known creator display nickname carried by platform sync when available. */
  creatorNickname?: Maybe<Scalars['String']['output']>;
  /** Creator open ID when carried by the webhook/API event. */
  creatorOpenId?: Maybe<Scalars['String']['output']>;
  /** Best-known creator username carried by platform sync when available. */
  creatorUsername?: Maybe<Scalars['String']['output']>;
  /** When the platform event happened or the affiliate condition was detected. */
  eventTime: Scalars['DateTimeISO']['output'];
  /** Observed direction of an affiliate IM message. */
  messageDirection?: Maybe<AffiliateConversationMessageDirection>;
  /** Platform message ID when tied to a creator message. */
  messageId?: Maybe<Scalars['String']['output']>;
  /** Platform message index when available from the creator chat webhook. */
  messageIndex?: Maybe<Scalars['String']['output']>;
  /** Platform message type, e.g. TEXT or IMAGE, when tied to a message. */
  messageType?: Maybe<Scalars['String']['output']>;
  /** Platform notification ID for webhook de-duplication or diagnostics. */
  notificationId?: Maybe<Scalars['String']['output']>;
  /** Order ID when tied to an affiliate order attribution. */
  orderId?: Maybe<Scalars['String']['output']>;
  /** Platform sample application ID when tied to a sample workflow update. */
  platformApplicationId?: Maybe<Scalars['String']['output']>;
  /** Platform collaboration ID normalized across open and target collaborations. */
  platformCollaborationId?: Maybe<Scalars['String']['output']>;
  /** Platform content/fulfillment ID when tied to content fulfillment sync. */
  platformFulfillmentId?: Maybe<Scalars['String']['output']>;
  /** Platform content fulfillment status when tied to sample fulfillment sync. */
  platformFulfillmentStatus?: Maybe<TikTokSampleContentFulfillmentPlatformStatus>;
  /** Platform open collaboration ID when tied to an open collaboration sample/update. */
  platformOpenCollaborationId?: Maybe<Scalars['String']['output']>;
  /** Platform affiliate program ID when tied to order attribution. */
  platformProgramId?: Maybe<Scalars['String']['output']>;
  /** Platform shop ID from the commerce platform webhook/API. */
  platformShopId: Scalars['String']['output'];
  /** Platform status string carried by the webhook/API event. */
  platformStatus?: Maybe<Scalars['String']['output']>;
  /** Platform target collaboration ID when tied to a target-collaboration update. */
  platformTargetCollaborationId?: Maybe<Scalars['String']['output']>;
  /** Backend-computed seller-turn reasons after materializing the event. */
  processReasons?: Maybe<Array<AffiliateCollaborationRecordProcessReason>>;
  /** Backend-computed processing status after materializing the event. */
  processingStatus?: Maybe<AffiliateCollaborationRecordProcessingStatus>;
  /** Product ID when carried by a sample or collaboration event. */
  productId?: Maybe<Scalars['String']['output']>;
  /** Platform sender ID when available. */
  senderId?: Maybe<Scalars['String']['output']>;
  /** Sender role from the platform event, e.g. CREATOR. */
  senderRole?: Maybe<Scalars['String']['output']>;
  /** MongoDB shop ID. Used for ownership checks and desktop shop routing. */
  shopId: Scalars['ID']['output'];
  /** System that emitted this signal. */
  source: AffiliateConversationSignalSource;
  /** Business event that happened or was detected for affiliate operations. */
  type: AffiliateConversationSignalType;
  /** True when this payload represents seller-turn work that should be considered for desktop agent dispatch. */
  workSignal: Scalars['Boolean']['output'];
}

/** Origin of an affiliate signal */
export const AffiliateConversationSignalSource = {
  Airflow: 'AIRFLOW',
  Manual: 'MANUAL',
  Webhook: 'WEBHOOK'
} as const;

export type AffiliateConversationSignalSource = typeof AffiliateConversationSignalSource[keyof typeof AffiliateConversationSignalSource];
/** Affiliate reducer event type. Legacy values remain accepted for relay compatibility. */
export const AffiliateConversationSignalType = {
  AffiliateActionResultObserved: 'AFFILIATE_ACTION_RESULT_OBSERVED',
  AffiliateConversationMessageObserved: 'AFFILIATE_CONVERSATION_MESSAGE_OBSERVED',
  AffiliateSampleApplicationObserved: 'AFFILIATE_SAMPLE_APPLICATION_OBSERVED',
  AffiliateSampleFulfillmentObserved: 'AFFILIATE_SAMPLE_FULFILLMENT_OBSERVED',
  AffiliateTargetCollaborationObserved: 'AFFILIATE_TARGET_COLLABORATION_OBSERVED',
  AffiliateTimerDue: 'AFFILIATE_TIMER_DUE',
  CreatorMessageReceived: 'CREATOR_MESSAGE_RECEIVED',
  OrderAttributed: 'ORDER_ATTRIBUTED',
  SampleApplicationUpdated: 'SAMPLE_APPLICATION_UPDATED',
  TargetCollaborationUpdated: 'TARGET_COLLABORATION_UPDATED'
} as const;

export type AffiliateConversationSignalType = typeof AffiliateConversationSignalType[keyof typeof AffiliateConversationSignalType];
export const AffiliateLifecycleActorType = {
  Agent: 'AGENT',
  CloudWorker: 'CLOUD_WORKER',
  Human: 'HUMAN',
  PlatformWebhook: 'PLATFORM_WEBHOOK',
  System: 'SYSTEM'
} as const;

export type AffiliateLifecycleActorType = typeof AffiliateLifecycleActorType[keyof typeof AffiliateLifecycleActorType];
export const AffiliateLifecycleStage = {
  Blocked: 'BLOCKED',
  Contacted: 'CONTACTED',
  ContentPending: 'CONTENT_PENDING',
  Converting: 'CONVERTING',
  Discovered: 'DISCOVERED',
  Dormant: 'DORMANT',
  Invited: 'INVITED',
  Qualified: 'QUALIFIED',
  Retained: 'RETAINED',
  SamplePending: 'SAMPLE_PENDING'
} as const;

export type AffiliateLifecycleStage = typeof AffiliateLifecycleStage[keyof typeof AffiliateLifecycleStage];
export const AffiliateOutboundMessageType = {
  FreeSampleCard: 'FREE_SAMPLE_CARD',
  Image: 'IMAGE',
  ProductCard: 'PRODUCT_CARD',
  TargetCollaborationCard: 'TARGET_COLLABORATION_CARD',
  Text: 'TEXT'
} as const;

export type AffiliateOutboundMessageType = typeof AffiliateOutboundMessageType[keyof typeof AffiliateOutboundMessageType];
/** How customized affiliate outreach copy should be for this campaign. */
export const AffiliateOutreachPersonalizationMode = {
  Deep: 'DEEP',
  Light: 'LIGHT',
  Template: 'TEMPLATE'
} as const;

export type AffiliateOutreachPersonalizationMode = typeof AffiliateOutreachPersonalizationMode[keyof typeof AffiliateOutreachPersonalizationMode];
export const AffiliatePolicyAction = {
  AddCreatorTag: 'ADD_CREATOR_TAG',
  ApproveSample: 'APPROVE_SAMPLE',
  BlockCreator: 'BLOCK_CREATOR',
  ChangeCampaignSetup: 'CHANGE_CAMPAIGN_SETUP',
  ChangeCommission: 'CHANGE_COMMISSION',
  CreateTargetInvite: 'CREATE_TARGET_INVITE',
  RecordCandidateDecision: 'RECORD_CANDIDATE_DECISION',
  RemoveCreator: 'REMOVE_CREATOR',
  SendFollowUp: 'SEND_FOLLOW_UP',
  SendOutreach: 'SEND_OUTREACH',
  ShipSample: 'SHIP_SAMPLE'
} as const;

export type AffiliatePolicyAction = typeof AffiliatePolicyAction[keyof typeof AffiliatePolicyAction];
/** How much creator research the desktop skill should spend before acting. */
export const AffiliateResearchDepth = {
  Balanced: 'BALANCED',
  Broad: 'BROAD',
  Deep: 'DEEP'
} as const;

export type AffiliateResearchDepth = typeof AffiliateResearchDepth[keyof typeof AffiliateResearchDepth];
export const AffiliateSampleRejectReason = {
  NotMatch: 'NOT_MATCH',
  Offline: 'OFFLINE',
  Other: 'OTHER',
  OutOfStock: 'OUT_OF_STOCK'
} as const;

export type AffiliateSampleRejectReason = typeof AffiliateSampleRejectReason[keyof typeof AffiliateSampleRejectReason];
export const AffiliateSampleReviewDecision = {
  Approve: 'APPROVE',
  Reject: 'REJECT'
} as const;

export type AffiliateSampleReviewDecision = typeof AffiliateSampleReviewDecision[keyof typeof AffiliateSampleReviewDecision];
/** Affiliate creator-management settings per shop (user-configurable) */
export interface AffiliateServiceSettings {
  /** Per-shop affiliate business instructions injected into affiliate agent runs. */
  businessPrompt?: Maybe<Scalars['String']['output']>;
  /** Device ID of the desktop instance handling affiliate inbound signals for this shop. Null = no device assigned. */
  csDeviceId?: Maybe<Scalars['String']['output']>;
  /** Whether affiliate creator-management inbound automation is enabled for this shop. */
  enabled: Scalars['Boolean']['output'];
  /** RunProfile ID for affiliate creator-management agent sessions. */
  runProfileId?: Maybe<Scalars['String']['output']>;
}

/** Affiliate creator-management settings patch. Omit a field to keep it, pass null to clear it, or pass a value to set it. */
export interface AffiliateServiceSettingsInput {
  /** Per-shop affiliate business instructions. Omit to keep, null or empty string to clear. */
  businessPrompt?: InputMaybe<Scalars['String']['input']>;
  /** Device ID of the desktop instance handling affiliate inbound signals. Omit to keep, null or empty string to clear. */
  csDeviceId?: InputMaybe<Scalars['String']['input']>;
  /** Affiliate service enabled flag. Omit to keep, null to clear to false, true/false to set. */
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** RunProfile ID for affiliate sessions. Omit to keep, null or empty string to clear. */
  runProfileId?: InputMaybe<Scalars['String']['input']>;
}

/** Record-level merged work bundle kind consumed by the affiliate agent-run factory. */
export const AffiliateWorkBundleKind = {
  ApprovalReviewOnly: 'APPROVAL_REVIEW_ONLY',
  ContentFollowUp: 'CONTENT_FOLLOW_UP',
  CreatorReplyOnly: 'CREATOR_REPLY_ONLY',
  CreatorReplyWithSampleReview: 'CREATOR_REPLY_WITH_SAMPLE_REVIEW',
  GeneralReview: 'GENERAL_REVIEW',
  ObservationOnly: 'OBSERVATION_ONLY',
  SampleReviewOnly: 'SAMPLE_REVIEW_ONLY',
  SampleShipmentStaffReview: 'SAMPLE_SHIPMENT_STAFF_REVIEW',
  StaffReviewOnly: 'STAFF_REVIEW_ONLY'
} as const;

export type AffiliateWorkBundleKind = typeof AffiliateWorkBundleKind[keyof typeof AffiliateWorkBundleKind];
/** Record-centered context resolved by backend before Desktop dispatches an affiliate agent. */
export interface AffiliateWorkContext {
  affiliateCollaboration?: Maybe<AffiliateCollaboration>;
  creatorProfile?: Maybe<CreatorGlobalProfile>;
  creatorRelation?: Maybe<CreatorUserRelation>;
  missingContext: Array<AffiliateWorkMissingContext>;
  pendingProposals: Array<ActionProposal>;
  primarySampleApplication?: Maybe<SampleApplicationRecord>;
  productContext?: Maybe<AffiliateWorkProductContext>;
  recommendedActionTypes: Array<ActionProposalType>;
  relatedSampleApplications: Array<SampleApplicationRecord>;
}

/** Backend-materialized affiliate work projection. Desktop should treat this as the current source of truth for dispatch/review, not reconstruct work from raw signals. */
export interface AffiliateWorkItem {
  /** True when desktop should consider starting an affiliate agent run for this work item. */
  agentDispatchRecommended: Scalars['Boolean']['output'];
  collaboration: AffiliateCollaborationRecord;
  collaborationRecordId: Scalars['ID']['output'];
  context: AffiliateWorkContext;
  /** Stable work-item ID. Currently the AffiliateCollaborationRecord ID. */
  id: Scalars['ID']['output'];
  latestPendingProposal?: Maybe<ActionProposal>;
  platformShopId: Scalars['String']['output'];
  processReasons: Array<AffiliateCollaborationRecordProcessReason>;
  processingStatus: AffiliateCollaborationRecordProcessingStatus;
  recommendedActionTypes: Array<ActionProposalType>;
  sampleApplicationRecord?: Maybe<SampleApplicationRecord>;
  shopId: Scalars['ID']['output'];
  /** True when the item should appear in staff review surfaces even if no agent run should start. */
  staffReviewRequired: Scalars['Boolean']['output'];
  /** Projection version timestamp. Desktop can use this for idempotent upsert. */
  versionAt: Scalars['DateTimeISO']['output'];
  workBundleKind: AffiliateWorkBundleKind;
  workKind: AffiliateWorkKind;
}

/** Subscription payload for a changed affiliate work projection. */
export interface AffiliateWorkItemChanged {
  workItem: AffiliateWorkItem;
}

/** Terminal decision for an agent-dispatched affiliate work item. */
export const AffiliateWorkItemResolutionDecision = {
  Deferred: 'DEFERRED',
  FailedOrIncomplete: 'FAILED_OR_INCOMPLETE',
  NeedsStaffReview: 'NEEDS_STAFF_REVIEW',
  NoActionNeeded: 'NO_ACTION_NEEDED',
  RequestAction: 'REQUEST_ACTION'
} as const;

export type AffiliateWorkItemResolutionDecision = typeof AffiliateWorkItemResolutionDecision[keyof typeof AffiliateWorkItemResolutionDecision];
/** Backend-derived affiliate work item kind consumed by desktop agent-run factories and review UI. */
export const AffiliateWorkKind = {
  ApprovalWaiting: 'APPROVAL_WAITING',
  ContentFollowUpDue: 'CONTENT_FOLLOW_UP_DUE',
  ContentPublishedObserved: 'CONTENT_PUBLISHED_OBSERVED',
  CreatorIdentityUnresolved: 'CREATOR_IDENTITY_UNRESOLVED',
  CreatorReplyNeeded: 'CREATOR_REPLY_NEEDED',
  GeneralReviewNeeded: 'GENERAL_REVIEW_NEEDED',
  OrderAttributedObserved: 'ORDER_ATTRIBUTED_OBSERVED',
  ProductContextMissing: 'PRODUCT_CONTEXT_MISSING',
  SampleReviewNeeded: 'SAMPLE_REVIEW_NEEDED',
  SampleShipmentNeeded: 'SAMPLE_SHIPMENT_NEEDED',
  StaffReviewNeeded: 'STAFF_REVIEW_NEEDED',
  TargetCollaborationObserved: 'TARGET_COLLABORATION_OBSERVED'
} as const;

export type AffiliateWorkKind = typeof AffiliateWorkKind[keyof typeof AffiliateWorkKind];
export interface AffiliateWorkMissingContext {
  message: Scalars['String']['output'];
  reason: AffiliateWorkMissingContextReason;
  severity: AffiliateWorkMissingContextSeverity;
}

/** Typed missing-context diagnostic for backend-resolved affiliate work context. */
export const AffiliateWorkMissingContextReason = {
  CollaborationOfferMissing: 'COLLABORATION_OFFER_MISSING',
  ConversationIdMissing: 'CONVERSATION_ID_MISSING',
  CreatorOpenIdMissing: 'CREATOR_OPEN_ID_MISSING',
  CreatorProfileMissing: 'CREATOR_PROFILE_MISSING',
  ProductContextMissing: 'PRODUCT_CONTEXT_MISSING',
  SampleApplicationMissing: 'SAMPLE_APPLICATION_MISSING'
} as const;

export type AffiliateWorkMissingContextReason = typeof AffiliateWorkMissingContextReason[keyof typeof AffiliateWorkMissingContextReason];
/** Severity of a missing-context diagnostic for affiliate work. */
export const AffiliateWorkMissingContextSeverity = {
  Blocking: 'BLOCKING',
  Info: 'INFO',
  Warning: 'WARNING'
} as const;

export type AffiliateWorkMissingContextSeverity = typeof AffiliateWorkMissingContextSeverity[keyof typeof AffiliateWorkMissingContextSeverity];
/** Backend-materialized affiliate work projection. Desktop should treat this as the current source of truth for dispatch/review, not reconstruct work from raw signals. */
export interface AffiliateWorkProductContext {
  imageUrl?: Maybe<Scalars['String']['output']>;
  productId: Scalars['String']['output'];
  /** Where this product context was resolved from, e.g. collaboration, sample application, or offer. */
  source?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
}

export interface AffiliateWorkspaceInput {
  campaignId?: InputMaybe<Scalars['ID']['input']>;
  candidateStatus?: InputMaybe<CreatorCandidateStatus>;
  collaborationProcessingStatus?: InputMaybe<AffiliateCollaborationRecordProcessingStatus>;
  creatorId?: InputMaybe<Scalars['ID']['input']>;
  includePolicies?: InputMaybe<Scalars['Boolean']['input']>;
  lifecycleStage?: InputMaybe<AffiliateLifecycleStage>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  platformApplicationId?: InputMaybe<Scalars['String']['input']>;
  platformConversationId?: InputMaybe<Scalars['String']['input']>;
  productId?: InputMaybe<Scalars['String']['input']>;
  proposalStatus?: InputMaybe<ActionProposalStatus>;
  sampleApplicationRecordId?: InputMaybe<Scalars['ID']['input']>;
  shopId: Scalars['ID']['input'];
}

/** Compressed affiliate management workspace for agent planning and review. */
export interface AffiliateWorkspacePayload {
  actionProposals: Array<ActionProposal>;
  affiliateCollaborations: Array<AffiliateCollaboration>;
  approvalPolicies: Array<AffiliateApprovalPolicy>;
  campaignProducts: Array<CampaignProduct>;
  campaigns: Array<AffiliateCampaign>;
  candidates: Array<CreatorCandidate>;
  collaborationRecords: Array<AffiliateCollaborationRecord>;
  /** Best-known creator profile facts for the selected workspace filters. Use this when a dynamic decision needs creator metrics such as follower count. */
  creatorProfiles: Array<CreatorGlobalProfile>;
  creatorRelations: Array<CreatorUserRelation>;
  creatorTags: Array<CreatorTag>;
  sampleApplicationRecords: Array<SampleApplicationRecord>;
  searchRuns: Array<CreatorSearchRun>;
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

export interface ApplyCreatorTagInput {
  creatorId: Scalars['ID']['input'];
  shopId: Scalars['ID']['input'];
  tagId: Scalars['ID']['input'];
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

/** One product/SKU included in an affiliate campaign setup. */
export interface CampaignProduct {
  campaignId: Scalars['ID']['output'];
  /** Configured commission rate percentage when available. */
  commissionRate?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  id: Scalars['ID']['output'];
  /** Hard product-level commission ceiling for backend validation and human approval context. */
  maxCommissionRate?: Maybe<Scalars['Float']['output']>;
  productId: Scalars['String']['output'];
  promotionPriority: CampaignProductPromotionPriority;
  sampleOfferMode: CampaignProductSampleOfferMode;
  sampleQuota?: Maybe<Scalars['Int']['output']>;
  sampleUnitCostAmount?: Maybe<Scalars['Float']['output']>;
  sampleUnitCostCurrency?: Maybe<EcomProductSkuCurrency>;
  shopId: Scalars['ID']['output'];
  title?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

/** Relative priority for choosing this product in affiliate outreach and follow-up. */
export const CampaignProductPromotionPriority = {
  High: 'HIGH',
  Low: 'LOW',
  Normal: 'NORMAL'
} as const;

export type CampaignProductPromotionPriority = typeof CampaignProductPromotionPriority[keyof typeof CampaignProductPromotionPriority];
/** How this campaign product should offer and approve free samples. */
export const CampaignProductSampleOfferMode = {
  AutoApprove: 'AUTO_APPROVE',
  ManualReview: 'MANUAL_REVIEW',
  None: 'NONE'
} as const;

export type CampaignProductSampleOfferMode = typeof CampaignProductSampleOfferMode[keyof typeof CampaignProductSampleOfferMode];
/** Captcha challenge response */
export interface CaptchaResponse {
  svg: Scalars['String']['output'];
  token: Scalars['String']['output'];
}

/** Input for claiming a CS escalation event for local execution */
export interface ClaimCsEscalationEventInput {
  eventId: Scalars['ID']['input'];
}

/** Public TikTok OAuth callback completion result. */
export interface CompleteTikTokOAuthResponse {
  platform: Scalars['String']['output'];
  shopId: Scalars['ID']['output'];
  shopName: Scalars['String']['output'];
}

/** Local OpenClaw-session anchor used to bound a platform conversation delta without maintaining an external cursor. */
export interface ConversationMessageDeltaAnchorInput {
  /** Visible text of the local OpenClaw session message used as the seen-after anchor. The backend uses it as a fuzzy containment check against platform message text. */
  sessionMessageText?: InputMaybe<Scalars['String']['input']>;
  /** Timestamp in milliseconds from the local OpenClaw session message used as the seen-after anchor. */
  sessionMessageTimestampMs?: InputMaybe<Scalars['Float']['input']>;
}

/** How the backend matched the local session anchor against platform messages. */
export const ConversationMessageDeltaAnchorMatchType = {
  ContentAndTime: 'CONTENT_AND_TIME',
  ContentOnly: 'CONTENT_ONLY',
  None: 'NONE'
} as const;

export type ConversationMessageDeltaAnchorMatchType = typeof ConversationMessageDeltaAnchorMatchType[keyof typeof ConversationMessageDeltaAnchorMatchType];
/** Whether a platform conversation delta was bounded cleanly. */
export const ConversationMessageDeltaCompleteness = {
  AnchorNotFound: 'ANCHOR_NOT_FOUND',
  Complete: 'COMPLETE',
  CurrentMessageNotFound: 'CURRENT_MESSAGE_NOT_FOUND',
  PageLimitReached: 'PAGE_LIMIT_REACHED'
} as const;

export type ConversationMessageDeltaCompleteness = typeof ConversationMessageDeltaCompleteness[keyof typeof ConversationMessageDeltaCompleteness];
/** Debug/quality metadata for a conversation message delta. */
export interface ConversationMessageDeltaMeta {
  /** Unix seconds of the matched platform anchor message. */
  anchorCreateTime?: Maybe<Scalars['Int']['output']>;
  anchorMatchType: ConversationMessageDeltaAnchorMatchType;
  anchorMatched: Scalars['Boolean']['output'];
  anchorMessageId?: Maybe<Scalars['String']['output']>;
  completeness: ConversationMessageDeltaCompleteness;
  currentMessageFound: Scalars['Boolean']['output'];
  fetchedMessageCount: Scalars['Int']['output'];
  pageLimitReached: Scalars['Boolean']['output'];
}

/** Create a provider-backed payment. */
export interface CreatePaymentGraphqlInput {
  /** Amount in the currency minor unit: cents for USD, fen for CNY. */
  amountMinor: Scalars['Int']['input'];
  /** Stripe Checkout cancel URL. Required for STRIPE. */
  cancelUrl?: InputMaybe<Scalars['String']['input']>;
  /** Payment currency. STRIPE currently expects USD; LAKALA expects CNY. */
  currency: Currency;
  description?: InputMaybe<Scalars['String']['input']>;
  /** Optional caller-supplied merchant order ID. Must be unique per provider. */
  merchantOrderId?: InputMaybe<Scalars['String']['input']>;
  /** Payment provider to use. STRIPE for USD cards, LAKALA for CNY QR code. */
  provider: PaymentProviderName;
  /** Short order title shown to the payment provider. */
  subject: Scalars['String']['input'];
  /** Stripe Checkout success URL. Required for STRIPE. */
  successUrl?: InputMaybe<Scalars['String']['input']>;
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

/** Creator candidate discovered by search before or during qualification. */
export interface CreatorCandidate {
  campaignId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  creatorId?: Maybe<Scalars['ID']['output']>;
  creatorOpenId?: Maybe<Scalars['String']['output']>;
  evidenceItems: Array<CreatorCandidateEvidence>;
  id: Scalars['ID']['output'];
  rationale?: Maybe<Scalars['String']['output']>;
  score?: Maybe<Scalars['Float']['output']>;
  shopId: Scalars['ID']['output'];
  sourceSearchRunId?: Maybe<Scalars['ID']['output']>;
  /** Raw source evidence for agent/debug display only. Backend execution must not depend on this field. */
  sourceSnapshotJson?: Maybe<Scalars['String']['output']>;
  sourceType: CreatorCandidateSourceType;
  status: CreatorCandidateStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

export interface CreatorCandidateEvidence {
  label: Scalars['String']['output'];
  source?: Maybe<Scalars['String']['output']>;
  type: CreatorCandidateEvidenceType;
  value?: Maybe<Scalars['String']['output']>;
}

export interface CreatorCandidateEvidenceInput {
  label: Scalars['String']['input'];
  source?: InputMaybe<Scalars['String']['input']>;
  type: CreatorCandidateEvidenceType;
  value?: InputMaybe<Scalars['String']['input']>;
}

/** Typed evidence categories used when an agent or human qualifies a creator candidate. */
export const CreatorCandidateEvidenceType = {
  CategoryMatch: 'CATEGORY_MATCH',
  ContentPerformance: 'CONTENT_PERFORMANCE',
  FollowerCount: 'FOLLOWER_COUNT',
  Gmv: 'GMV',
  ManualNote: 'MANUAL_NOTE',
  Other: 'OTHER',
  PastCollaboration: 'PAST_COLLABORATION',
  ProductFit: 'PRODUCT_FIT'
} as const;

export type CreatorCandidateEvidenceType = typeof CreatorCandidateEvidenceType[keyof typeof CreatorCandidateEvidenceType];
export const CreatorCandidateSourceType = {
  Manual: 'MANUAL',
  MarketplaceSearch: 'MARKETPLACE_SEARCH',
  PlatformReply: 'PLATFORM_REPLY',
  RpaImport: 'RPA_IMPORT',
  SampleApplication: 'SAMPLE_APPLICATION',
  TargetCollaborationSync: 'TARGET_COLLABORATION_SYNC'
} as const;

export type CreatorCandidateSourceType = typeof CreatorCandidateSourceType[keyof typeof CreatorCandidateSourceType];
export const CreatorCandidateStatus = {
  Discovered: 'DISCOVERED',
  Excluded: 'EXCLUDED',
  Qualified: 'QUALIFIED'
} as const;

export type CreatorCandidateStatus = typeof CreatorCandidateStatus[keyof typeof CreatorCandidateStatus];
/** Marketplace creator identity and durable marketplace facts. Shop-specific relationship state lives elsewhere. */
export interface CreatorGlobalProfile {
  /** Aggregated, privacy-safe creator signals produced by RivonClaw. Not merchant-private raw history. */
  aggregatedSignalsSnapshotJson?: Maybe<Scalars['String']['output']>;
  avatarUrl?: Maybe<Scalars['String']['output']>;
  categoryIds: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  creatorImId?: Maybe<Scalars['String']['output']>;
  creatorOpenId?: Maybe<Scalars['String']['output']>;
  followerCount?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  nickname?: Maybe<Scalars['String']['output']>;
  platform: ShopPlatform;
  updatedAt: Scalars['DateTimeISO']['output'];
  username?: Maybe<Scalars['String']['output']>;
}

export interface CreatorMarketplaceSearchParams {
  advancedFilters?: Maybe<CreatorSearchAdvancedFilter>;
  affiliateData?: Maybe<CreatorSearchAffiliateDataFilter>;
  categories?: Maybe<Array<CreatorSearchCategoryFilter>>;
  contentPerformance?: Maybe<CreatorSearchContentPerformanceFilter>;
  followerDemographics?: Maybe<CreatorSearchFollowerDemographics>;
  keyword?: Maybe<Scalars['String']['output']>;
  pageSize: Scalars['Int']['output'];
  pageToken?: Maybe<Scalars['String']['output']>;
  region?: Maybe<ShopRegion>;
  searchKey?: Maybe<Scalars['String']['output']>;
}

export interface CreatorMarketplaceSearchParamsInput {
  advancedFilters?: InputMaybe<CreatorSearchAdvancedFilterInput>;
  affiliateData?: InputMaybe<CreatorSearchAffiliateDataFilterInput>;
  categories?: InputMaybe<Array<CreatorSearchCategoryFilterInput>>;
  contentPerformance?: InputMaybe<CreatorSearchContentPerformanceFilterInput>;
  followerDemographics?: InputMaybe<CreatorSearchFollowerDemographicsInput>;
  keyword?: InputMaybe<Scalars['String']['input']>;
  pageSize: Scalars['Int']['input'];
  pageToken?: InputMaybe<Scalars['String']['input']>;
  region?: InputMaybe<ShopRegion>;
  searchKey?: InputMaybe<Scalars['String']['input']>;
}

/** Embedded shop-specific lifecycle and tag state for a user-level creator relation. */
export interface CreatorRelationShopState {
  lastContactedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  lastInvitedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  lastQualifiedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  lifecycleStage: AffiliateLifecycleStage;
  shopId: Scalars['ID']['output'];
  tagIds: Array<Scalars['ID']['output']>;
}

export interface CreatorSearchAdvancedFilter {
  categoryPros?: Maybe<Array<Scalars['String']['output']>>;
  creatorLevels?: Maybe<Array<Scalars['String']['output']>>;
  languages?: Maybe<Array<Scalars['String']['output']>>;
}

export interface CreatorSearchAdvancedFilterInput {
  categoryPros?: InputMaybe<Array<Scalars['String']['input']>>;
  creatorLevels?: InputMaybe<Array<Scalars['String']['input']>>;
  languages?: InputMaybe<Array<Scalars['String']['input']>>;
}

export interface CreatorSearchAffiliateDataFilter {
  maxAvgCommissionRateBps?: Maybe<Scalars['Int']['output']>;
  maxGmvAmount?: Maybe<Scalars['Float']['output']>;
  minAvgCommissionRateBps?: Maybe<Scalars['Int']['output']>;
  minGmvAmount?: Maybe<Scalars['Float']['output']>;
  notInvitedLast90Days?: Maybe<Scalars['Boolean']['output']>;
}

export interface CreatorSearchAffiliateDataFilterInput {
  maxAvgCommissionRateBps?: InputMaybe<Scalars['Int']['input']>;
  maxGmvAmount?: InputMaybe<Scalars['Float']['input']>;
  minAvgCommissionRateBps?: InputMaybe<Scalars['Int']['input']>;
  minGmvAmount?: InputMaybe<Scalars['Float']['input']>;
  notInvitedLast90Days?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface CreatorSearchCategoryFilter {
  categoryId: Scalars['String']['output'];
  subCategoryIds?: Maybe<Array<Scalars['String']['output']>>;
}

export interface CreatorSearchCategoryFilterInput {
  categoryId: Scalars['String']['input'];
  subCategoryIds?: InputMaybe<Array<Scalars['String']['input']>>;
}

export interface CreatorSearchContentPerformanceFilter {
  minAverageLiveViews?: Maybe<Scalars['Int']['output']>;
  minAverageVideoViews?: Maybe<Scalars['Int']['output']>;
  minShoppableVideoCount?: Maybe<Scalars['Int']['output']>;
}

export interface CreatorSearchContentPerformanceFilterInput {
  minAverageLiveViews?: InputMaybe<Scalars['Int']['input']>;
  minAverageVideoViews?: InputMaybe<Scalars['Int']['input']>;
  minShoppableVideoCount?: InputMaybe<Scalars['Int']['input']>;
}

/** Stable TikTok follower age range filter values for creator marketplace search. */
export const CreatorSearchFollowerAgeRange = {
  AgeRange_18_24: 'AGE_RANGE_18_24',
  AgeRange_25_34: 'AGE_RANGE_25_34',
  AgeRange_35_44: 'AGE_RANGE_35_44',
  AgeRange_45_54: 'AGE_RANGE_45_54',
  AgeRange_55AndAbove: 'AGE_RANGE_55_AND_ABOVE'
} as const;

export type CreatorSearchFollowerAgeRange = typeof CreatorSearchFollowerAgeRange[keyof typeof CreatorSearchFollowerAgeRange];
export interface CreatorSearchFollowerDemographics {
  ageRanges?: Maybe<Array<CreatorSearchFollowerAgeRange>>;
  genders?: Maybe<Array<CreatorSearchFollowerGender>>;
  maxFollowerCount?: Maybe<Scalars['Int']['output']>;
  minFollowerCount?: Maybe<Scalars['Int']['output']>;
}

export interface CreatorSearchFollowerDemographicsInput {
  ageRanges?: InputMaybe<Array<CreatorSearchFollowerAgeRange>>;
  genders?: InputMaybe<Array<CreatorSearchFollowerGender>>;
  maxFollowerCount?: InputMaybe<Scalars['Int']['input']>;
  minFollowerCount?: InputMaybe<Scalars['Int']['input']>;
}

/** Stable TikTok follower gender filter values for creator marketplace search. */
export const CreatorSearchFollowerGender = {
  Female: 'FEMALE',
  Male: 'MALE'
} as const;

export type CreatorSearchFollowerGender = typeof CreatorSearchFollowerGender[keyof typeof CreatorSearchFollowerGender];
/** One concrete marketplace creator search request/result page. This is a platform fact, not an AI-authored workflow plan. */
export interface CreatorSearchRun {
  campaignId?: Maybe<Scalars['ID']['output']>;
  completedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  createdCandidateIds: Array<Scalars['ID']['output']>;
  errorMessage?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  nextPageToken?: Maybe<Scalars['String']['output']>;
  platformRequestId?: Maybe<Scalars['String']['output']>;
  /** Raw platform response for agent/debug display only. Backend execution must not depend on this field. */
  rawResponseSnapshotJson?: Maybe<Scalars['String']['output']>;
  requestedByActorId?: Maybe<Scalars['String']['output']>;
  requestedByActorType?: Maybe<AffiliateLifecycleActorType>;
  requestedByRunId?: Maybe<Scalars['String']['output']>;
  resultCount?: Maybe<Scalars['Int']['output']>;
  searchParams: CreatorMarketplaceSearchParams;
  shopId: Scalars['ID']['output'];
  status: CreatorSearchRunStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

export const CreatorSearchRunStatus = {
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  Requested: 'REQUESTED',
  Running: 'RUNNING'
} as const;

export type CreatorSearchRunStatus = typeof CreatorSearchRunStatus[keyof typeof CreatorSearchRunStatus];
export const CreatorSystemTagKey = {
  Blocked: 'BLOCKED',
  Dormant: 'DORMANT',
  GoodFulfillment: 'GOOD_FULFILLMENT',
  HighGmv: 'HIGH_GMV',
  NoSampleAgain: 'NO_SAMPLE_AGAIN',
  SampleRisk: 'SAMPLE_RISK',
  Vip: 'VIP'
} as const;

export type CreatorSystemTagKey = typeof CreatorSystemTagKey[keyof typeof CreatorSystemTagKey];
/** Tag used by approval policies, segmentation, and human review boundaries. */
export interface CreatorTag {
  createdAt: Scalars['DateTimeISO']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  sensitive: Scalars['Boolean']['output'];
  shopId: Scalars['ID']['output'];
  /** Stable system key for default tags such as VIP or BLOCKED. */
  systemKey?: Maybe<CreatorSystemTagKey>;
  type: CreatorTagType;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

export const CreatorTagType = {
  Custom: 'CUSTOM',
  System: 'SYSTEM'
} as const;

export type CreatorTagType = typeof CreatorTagType[keyof typeof CreatorTagType];
/** User-scoped creator relationship. Shop-specific lifecycle and tags are embedded because a user's shop count is bounded. */
export interface CreatorUserRelation {
  blocked: Scalars['Boolean']['output'];
  /** When blocked=true and this list is empty, the user-level block applies to all current/future shops. */
  blockedShopIds: Array<Scalars['ID']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  creatorId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  lastBlockedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  shopStates: Array<CreatorRelationShopState>;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

/** Ephemeral customer-service conversation signal pushed to desktop. The platform API remains the source of truth for messages and conversation state. */
export interface CsConversationSignal {
  /** Platform buyer user ID if already known. */
  buyerUserId?: Maybe<Scalars['String']['output']>;
  /** Platform conversation/thread ID that desktop should inspect. */
  conversationId: Scalars['String']['output'];
  /** When the platform event happened or the unread condition was detected. */
  eventTime: Scalars['DateTimeISO']['output'];
  /** Platform IM user ID if available from webhook/API context. */
  imUserId?: Maybe<Scalars['String']['output']>;
  /** Platform message ID when this signal is tied to a specific buyer message. */
  messageId?: Maybe<Scalars['String']['output']>;
  /** Platform message index when available for event ordering. */
  messageIndex?: Maybe<Scalars['String']['output']>;
  /** Platform message type, e.g. TEXT or IMAGE, if tied to a message. */
  messageType?: Maybe<Scalars['String']['output']>;
  /** Optional operator instruction/comment to inject into the local CS agent catch-up prompt. */
  operatorInstruction?: Maybe<Scalars['String']['output']>;
  /** Related order ID if the platform event already carried one. */
  orderId?: Maybe<Scalars['String']['output']>;
  /** Platform shop ID from the commerce platform webhook/API. */
  platformShopId: Scalars['String']['output'];
  /** Sender role from the platform event, e.g. BUYER. */
  senderRole?: Maybe<Scalars['String']['output']>;
  /** MongoDB shop ID. Used for ownership checks and desktop shop routing. */
  shopId: Scalars['ID']['output'];
  /** System that emitted this signal. */
  source: CsConversationSignalSource;
  /** Business event that happened or was detected for this CS conversation. */
  type: CsConversationSignalType;
}

/** Origin of a customer-service conversation signal */
export const CsConversationSignalSource = {
  Airflow: 'AIRFLOW',
  Manual: 'MANUAL',
  Webhook: 'WEBHOOK'
} as const;

export type CsConversationSignalSource = typeof CsConversationSignalSource[keyof typeof CsConversationSignalSource];
/** Business-level customer-service conversation signal type */
export const CsConversationSignalType = {
  ManualStart: 'MANUAL_START',
  MessageReceived: 'MESSAGE_RECEIVED',
  UnreadDetected: 'UNREAD_DETECTED'
} as const;

export type CsConversationSignalType = typeof CsConversationSignalType[keyof typeof CsConversationSignalType];
/** Result of creating a CS escalation */
export interface CsEscalateResult {
  error?: Maybe<Scalars['String']['output']>;
  escalationId?: Maybe<Scalars['ID']['output']>;
  ok: Scalars['Boolean']['output'];
  status?: Maybe<CsEscalationStatus>;
}

/** Cloud-authoritative customer-service escalation */
export interface CsEscalation {
  buyerNickname?: Maybe<Scalars['String']['output']>;
  buyerUserId: Scalars['String']['output'];
  context?: Maybe<Scalars['String']['output']>;
  conversationId: Scalars['String']['output'];
  createdAt: Scalars['DateTimeISO']['output'];
  /** Short user-scoped escalation code, e.g. A1B2C3 */
  id: Scalars['ID']['output'];
  orderId?: Maybe<Scalars['String']['output']>;
  reason: Scalars['String']['output'];
  result?: Maybe<CsEscalationResult>;
  shopId: Scalars['String']['output'];
  status: CsEscalationStatus;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
  version: Scalars['Int']['output'];
}

/** CS escalation process event. The parent escalation owns routing/context; this record only stores the process step and local side-effect delivery state. */
export interface CsEscalationEvent {
  /** Time when this process event was created. */
  createdAt: Scalars['DateTimeISO']['output'];
  /** Manager decision captured on this event, present for response events. */
  decision?: Maybe<Scalars['String']['output']>;
  /** Stable public ID for this event, e.g. csevt_a1b2c3d4. */
  id: Scalars['ID']['output'];
  /** Manager instructions captured on this event, present for response events. */
  instructions?: Maybe<Scalars['String']['output']>;
  /** Current delivery state of the local side effect for this event. */
  status: CsEscalationEventStatus;
  /** Kind of process event the desktop actuator should handle. */
  type: CsEscalationEventType;
  /** Time when this event's delivery state was last updated. */
  updatedAt: Scalars['DateTimeISO']['output'];
}

/** Desktop delivery payload for a nested CS escalation event */
export interface CsEscalationEventDelivery {
  /** Parent escalation that owns the event and provides routing/context for local execution. */
  escalation: CsEscalation;
  /** Nested process event to claim, execute, and acknowledge. */
  event: CsEscalationEvent;
}

/** Filter for pending CS escalation side-effect events */
export interface CsEscalationEventFilterInput {
  limit?: InputMaybe<Scalars['Int']['input']>;
  shopIds?: InputMaybe<Array<Scalars['ID']['input']>>;
}

/** Filter for open CS escalations awaiting manager or agent completion */
export interface CsOpenEscalationFilterInput {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  /** Case-insensitive search across escalation id, reason, context, conversation id, buyer id, and order id */
  search?: InputMaybe<Scalars['String']['input']>;
  shopIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  statuses?: InputMaybe<Array<CsEscalationStatus>>;
}

/** Paged CS escalation list */
export interface CsOpenEscalationPage {
  items: Array<CsEscalation>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
}

/** Delivery/execution status of a CS escalation event */
export const CsEscalationEventStatus = {
  Claimed: 'CLAIMED',
  Failed: 'FAILED',
  Handled: 'HANDLED',
  Pending: 'PENDING'
} as const;

export type CsEscalationEventStatus = typeof CsEscalationEventStatus[keyof typeof CsEscalationEventStatus];
/** Durable event type for local CS side-effect actuators */
export const CsEscalationEventType = {
  EscalationCreated: 'ESCALATION_CREATED',
  EscalationResolved: 'ESCALATION_RESOLVED',
  EscalationUpdated: 'ESCALATION_UPDATED'
} as const;

export type CsEscalationEventType = typeof CsEscalationEventType[keyof typeof CsEscalationEventType];
/** Escalation result plus guidance for the CS agent */
export interface CsEscalationLookupResult {
  buyerNickname?: Maybe<Scalars['String']['output']>;
  buyerUserId: Scalars['String']['output'];
  conversationId: Scalars['String']['output'];
  context?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  guidance?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  orderId?: Maybe<Scalars['String']['output']>;
  reason: Scalars['String']['output'];
  result?: Maybe<CsEscalationResult>;
  shopId: Scalars['String']['output'];
  status: CsEscalationStatus;
  version: Scalars['Int']['output'];
}

/** Manager decision and instructions for a CS escalation */
export interface CsEscalationResult {
  decision: Scalars['String']['output'];
  instructions: Scalars['String']['output'];
  resolved: Scalars['Boolean']['output'];
  resolvedAt: Scalars['DateTimeISO']['output'];
}

/** Lifecycle status of a CS escalation */
export const CsEscalationStatus = {
  Closed: 'CLOSED',
  InProgress: 'IN_PROGRESS',
  Pending: 'PENDING',
  Resolved: 'RESOLVED'
} as const;

export type CsEscalationStatus = typeof CsEscalationStatus[keyof typeof CsEscalationStatus];
/** Result returned after a manager responds to a CS escalation */
export interface CsRespondResult {
  error?: Maybe<Scalars['String']['output']>;
  escalationId?: Maybe<Scalars['ID']['output']>;
  ok: Scalars['Boolean']['output'];
  status?: Maybe<CsEscalationStatus>;
  version?: Maybe<Scalars['Int']['output']>;
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

/** Bounded customer-service conversation delta from a local OpenClaw session anchor through a current inbound message. */
export interface CustomerServiceMessageDelta {
  items: Array<CustomerServiceMessageSummary>;
  meta: ConversationMessageDeltaMeta;
}

/** Preview of the latest message in a conversation */
export interface CustomerServiceMessagePreview {
  /** JSON-stringified message content per message type */
  content?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  /** Opaque platform message index for ordering */
  index?: Maybe<Scalars['String']['output']>;
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
  /** Platform message ID. */
  messageId?: Maybe<Scalars['String']['output']>;
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

export interface DecideActionProposalInput {
  decision?: InputMaybe<ActionProposalDecisionSnapshotInput>;
  id: Scalars['ID']['input'];
  status: ActionProposalStatus;
}

/** Affiliate message */
export interface EcomAffiliateMessage {
  content?: Maybe<Scalars['String']['output']>;
  conversationId?: Maybe<Scalars['String']['output']>;
  conversationIndex?: Maybe<Scalars['String']['output']>;
  createTime?: Maybe<Scalars['Int']['output']>;
  messageId?: Maybe<Scalars['String']['output']>;
  senderId?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
}

/** Bounded affiliate creator conversation delta from a local OpenClaw session anchor through a current inbound message. */
export interface EcomAffiliateMessageDelta {
  items: Array<EcomAffiliateMessage>;
  meta: ConversationMessageDeltaMeta;
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

/** Definitions for interpreting order-derived ecommerce sales statistics. */
export interface EcomOrderSalesStatsDefinitions {
  /** Definition of cancelled_* metrics. */
  cancelled: Scalars['String']['output'];
  /** Definition of completed_* metrics. */
  completed: Scalars['String']['output'];
  /** Business date definition used by DAILY rows. */
  dateKey: Scalars['String']['output'];
  /** Definition of effective_* metrics. */
  effective: Scalars['String']['output'];
  /** Definition of *_gmv metrics. */
  gmv: Scalars['String']['output'];
  /** How row grain is selected. */
  grain: Scalars['String']['output'];
  /** Definition of gross_* metrics. */
  gross: Scalars['String']['output'];
  /** Definition of *_order_count metrics. */
  orderCount: Scalars['String']['output'];
  /** Whether return/refund events are excluded. */
  returnsRefunds: Scalars['String']['output'];
  /** Definition of *_units metrics. */
  units: Scalars['String']['output'];
}

/** Read order-derived sales statistics for one or more shops at shop, product, or SKU level. endDateLt is exclusive. */
export interface EcomOrderSalesStatsInput {
  /** End date exclusive in shop-local analytics date format (YYYY-MM-DD). */
  endDateLt: Scalars['String']['input'];
  /** Aggregation level to query: SHOP, PRODUCT, or SKU. */
  level: EcomOrderSalesStatsLevel;
  /** Maximum number of rows to return. Leave empty or use 0 to return all matching rows. */
  limit?: InputMaybe<Scalars['Int']['input']>;
  /** Optional product IDs. Supported for PRODUCT and SKU level reads. */
  productIds?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Optional exact seller SKUs. Supported for SKU level reads. */
  sellerSkus?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Shop Mongo IDs (the id field from ecommerce_list_shops). */
  shopIds: Array<Scalars['ID']['input']>;
  /** Optional SKU IDs. Supported for SKU level reads. */
  skuIds?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Optional sort field. Defaults to DATE_KEY for DAILY reads and EFFECTIVE_GMV for TOTAL reads. */
  sortBy?: InputMaybe<EcomOrderSalesStatsSortField>;
  /** Optional sort order. Defaults to ASC for DAILY reads and DESC for TOTAL reads. */
  sortOrder?: InputMaybe<EcomSortOrder>;
  /** Start date inclusive in shop-local analytics date format (YYYY-MM-DD). */
  startDateGe: Scalars['String']['input'];
  /** Return daily rows or one aggregated row per selected entity over the full date range. Defaults to DAILY. */
  timeGrouping?: InputMaybe<EcomOrderSalesStatsTimeGrouping>;
}

/** Ecommerce sales statistics aggregation level. */
export const EcomOrderSalesStatsLevel = {
  Product: 'PRODUCT',
  Shop: 'SHOP',
  Sku: 'SKU'
} as const;

export type EcomOrderSalesStatsLevel = typeof EcomOrderSalesStatsLevel[keyof typeof EcomOrderSalesStatsLevel];
/** Fixed order-derived metric bundle for a shop, product, or SKU row. */
export interface EcomOrderSalesStatsMetrics {
  /** Cancelled GMV. */
  cancelledGmv?: Maybe<EcomAnalyticsMoney>;
  /** Cancelled order count. */
  cancelledOrderCount: Scalars['Int']['output'];
  /** Cancelled units. */
  cancelledUnits: Scalars['Int']['output'];
  /** Completed GMV. */
  completedGmv?: Maybe<EcomAnalyticsMoney>;
  /** Completed order count. */
  completedOrderCount: Scalars['Int']['output'];
  /** Completed units. */
  completedUnits: Scalars['Int']['output'];
  /** Effective GMV. */
  effectiveGmv?: Maybe<EcomAnalyticsMoney>;
  /** Effective order count. */
  effectiveOrderCount: Scalars['Int']['output'];
  /** Effective units. */
  effectiveUnits: Scalars['Int']['output'];
  /** Gross GMV. */
  grossGmv?: Maybe<EcomAnalyticsMoney>;
  /** Gross order count. */
  grossOrderCount: Scalars['Int']['output'];
  /** Gross units. */
  grossUnits: Scalars['Int']['output'];
}

/** Order-derived ecommerce sales statistics result. */
export interface EcomOrderSalesStatsResult {
  /** Metric and date definitions for interpreting this result. */
  definitions: EcomOrderSalesStatsDefinitions;
  /** Sales statistics rows. */
  items: Array<EcomOrderSalesStatsRow>;
  /** Number of rows returned by this query. */
  totalCount: Scalars['Int']['output'];
}

/** One fixed-shape ecommerce sales statistics row. Product and SKU fields are nullable depending on the requested level. */
export interface EcomOrderSalesStatsRow {
  /** Currency for monetary metrics when available. */
  currency?: Maybe<Scalars['String']['output']>;
  /** Business date for DAILY rows; see definitions.dateKey. */
  dateKey?: Maybe<Scalars['String']['output']>;
  /** Aggregation level represented by this row. */
  level: EcomOrderSalesStatsLevel;
  /** Order-derived metric bundle. */
  metrics: EcomOrderSalesStatsMetrics;
  /** End date exclusive for this row's metric period (YYYY-MM-DD). */
  periodEnd: Scalars['String']['output'];
  /** Start date inclusive for this row's metric period (YYYY-MM-DD). */
  periodStart: Scalars['String']['output'];
  /** Product ID. Populated for PRODUCT and SKU level rows. */
  productId?: Maybe<Scalars['String']['output']>;
  /** Product display name when available. */
  productName?: Maybe<Scalars['String']['output']>;
  /** Seller SKU when available. */
  sellerSku?: Maybe<Scalars['String']['output']>;
  /** Shop Mongo ID. */
  shopId: Scalars['ID']['output'];
  /** Shop display name when available. */
  shopName?: Maybe<Scalars['String']['output']>;
  /** SKU ID. Populated for SKU level rows. */
  skuId?: Maybe<Scalars['String']['output']>;
  /** SKU display name when available. */
  skuName?: Maybe<Scalars['String']['output']>;
}

/** Sort field for ecommerce order-derived sales statistics. */
export const EcomOrderSalesStatsSortField = {
  CancelledGmv: 'CANCELLED_GMV',
  CancelledOrderCount: 'CANCELLED_ORDER_COUNT',
  CancelledUnits: 'CANCELLED_UNITS',
  CompletedGmv: 'COMPLETED_GMV',
  CompletedOrderCount: 'COMPLETED_ORDER_COUNT',
  CompletedUnits: 'COMPLETED_UNITS',
  DateKey: 'DATE_KEY',
  EffectiveGmv: 'EFFECTIVE_GMV',
  EffectiveOrderCount: 'EFFECTIVE_ORDER_COUNT',
  EffectiveUnits: 'EFFECTIVE_UNITS',
  GrossGmv: 'GROSS_GMV',
  GrossOrderCount: 'GROSS_ORDER_COUNT',
  GrossUnits: 'GROSS_UNITS',
  ProductId: 'PRODUCT_ID',
  ShopId: 'SHOP_ID',
  SkuId: 'SKU_ID'
} as const;

export type EcomOrderSalesStatsSortField = typeof EcomOrderSalesStatsSortField[keyof typeof EcomOrderSalesStatsSortField];
/** Whether ecommerce sales statistics are returned per day or aggregated over the full date range. */
export const EcomOrderSalesStatsTimeGrouping = {
  Daily: 'DAILY',
  Total: 'TOTAL'
} as const;

export type EcomOrderSalesStatsTimeGrouping = typeof EcomOrderSalesStatsTimeGrouping[keyof typeof EcomOrderSalesStatsTimeGrouping];
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
  brand?: Maybe<EcomProductBrand>;
  categoryChains?: Maybe<Array<EcomProductCategory>>;
  /** Unix seconds */
  createTime?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  images?: Maybe<Array<EcomImage>>;
  productId: Scalars['String']['output'];
  productTypes?: Maybe<Array<Scalars['String']['output']>>;
  skus?: Maybe<Array<EcomProductSku>>;
  status?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  /** Unix seconds */
  updateTime?: Maybe<Scalars['Int']['output']>;
}

/** Product brand metadata */
export interface EcomProductBrand {
  id?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
}

/** Product category node in the platform category hierarchy */
export interface EcomProductCategory {
  id?: Maybe<Scalars['String']['output']>;
  isLeaf?: Maybe<Scalars['Boolean']['output']>;
  localName?: Maybe<Scalars['String']['output']>;
  parentId?: Maybe<Scalars['String']['output']>;
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

/** Inventory updates for one shop */
export interface EcomShopUpdateInventoryInput {
  /** Shop ID (the 'id' field from ecommerce_list_shops) */
  shopId: Scalars['String']['input'];
  /** SKU inventory updates to apply to this shop. */
  updates: Array<EcomUpdateInventoryInput>;
}

/** Order-derived per-SKU demand metrics for shop analytics */
export interface EcomSkuPerformance {
  /** Shop-local date for this SKU demand row (YYYY-MM-DD) */
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

/** Flat order-derived SKU demand result. Serving reads return one row per shop-local date and SKU. */
export interface EcomSkuPerformanceResult {
  /** Per-day per-SKU demand rows */
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

/** Per-SKU inventory update failure returned by the platform */
export interface EcomUpdateInventoryFailure {
  code?: Maybe<Scalars['Int']['output']>;
  /** Human-readable failure reason returned by the platform. */
  reason?: Maybe<Scalars['String']['output']>;
  skuId?: Maybe<Scalars['String']['output']>;
  warehouseFailures?: Maybe<Array<EcomUpdateInventoryWarehouseFailure>>;
}

/** Inventory update request for one SKU */
export interface EcomUpdateInventoryInput {
  /** Warehouse-level inventory rows for this SKU. For multi-warehouse SKUs, include every assigned warehouse with its desired quantity. */
  inventory: Array<EcomUpdateInventoryWarehouseInput>;
  /** Product ID that owns this SKU. TikTok's update inventory endpoint is product-scoped. */
  productId: Scalars['String']['input'];
  /** SKU ID to update */
  skuId: Scalars['String']['input'];
}

/** Result of updating product inventory */
export interface EcomUpdateInventoryResult {
  /** Only SKU updates that failed, with platform failure reasons. */
  failures?: Maybe<Array<EcomUpdateInventoryFailure>>;
  /** Shop ID that this result belongs to, when returned from the multi-shop resolver. */
  shopId?: Maybe<Scalars['String']['output']>;
  /** True when the platform returned no SKU-scoped failures for this shop. */
  success: Scalars['Boolean']['output'];
}

/** Warehouse-level inventory update failure returned by the platform */
export interface EcomUpdateInventoryWarehouseFailure {
  code?: Maybe<Scalars['Int']['output']>;
  /** Human-readable failure reason returned by the platform. */
  reason?: Maybe<Scalars['String']['output']>;
  warehouseId?: Maybe<Scalars['String']['output']>;
}

/** Warehouse-level inventory update for one SKU */
export interface EcomUpdateInventoryWarehouseInput {
  /** Optional backorder quantity for this warehouse. Omit to keep TikTok's existing value. */
  backorderQuantity?: InputMaybe<Scalars['Int']['input']>;
  /** Optional backorder handling time in working days. TikTok requires the same handling time across warehouses for a SKU. */
  handlingTime?: InputMaybe<Scalars['Int']['input']>;
  /** Desired in-stock quantity for this SKU in this warehouse. TikTok requires an integer between 1 and 99,999. */
  quantity: Scalars['Int']['input'];
  /** Warehouse ID to update. TikTok allows this to be omitted only when the SKU is assigned to exactly one warehouse. */
  warehouseId?: InputMaybe<Scalars['String']['input']>;
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
  EcomCsEscalationRead: 'ECOM_CS_ESCALATION_READ',
  EcomCsEscalationWrite: 'ECOM_CS_ESCALATION_WRITE',
  EcomCsRead: 'ECOM_CS_READ',
  EcomCsWrite: 'ECOM_CS_WRITE',
  EcomFulfillmentRead: 'ECOM_FULFILLMENT_READ',
  EcomInventoryManagement: 'ECOM_INVENTORY_MANAGEMENT',
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

/** Shop backend's observed inventory quantity for a third-party WMS warehouse mapping. */
export interface InventoryAnalysisInShopWarehouseQuantity {
  /** Shop platform warehouse ID used for inventory updates, copied from ShopWarehouse.platformWarehouseId. */
  platformWarehouseId?: Maybe<Scalars['String']['output']>;
  /** Shop platform product ID for this seller SKU when available. */
  productId?: Maybe<Scalars['String']['output']>;
  /** Quantity recorded in the shop backend for this platform warehouse mapping. */
  quantity: Scalars['Int']['output'];
  /** Shop alias/name. */
  shopAlias?: Maybe<Scalars['String']['output']>;
  /** Shop Mongo ID. */
  shopId: Scalars['ID']['output'];
  /** Shop platform SKU ID for this seller SKU when available. */
  skuId?: Maybe<Scalars['String']['output']>;
}

/** Full current inventory facts for one seller SKU. */
export interface InventoryAnalysisInventoryFacts {
  /** Platform official/seller warehouse quantities where the shop platform is the source of truth. */
  officialPlatformWarehouses: Array<InventoryAnalysisOfficialPlatformWarehouseStock>;
  /** Third-party WMS warehouse quantities plus mapped shop backend observations. */
  thirdPartyWmsWarehouses: Array<InventoryAnalysisThirdPartyWmsWarehouseStock>;
}

/** Inventory quantity for a shop platform warehouse where the platform is the source of truth. */
export interface InventoryAnalysisOfficialPlatformWarehouseStock {
  /** Units currently in transit to this platform warehouse when available. */
  inTransitQuantity?: Maybe<Scalars['Int']['output']>;
  /** Shop platform warehouse ID used for inventory updates, copied from ShopWarehouse.platformWarehouseId. */
  platformWarehouseId?: Maybe<Scalars['String']['output']>;
  /** Authoritative platform warehouse quantity. */
  quantity: Scalars['Int']['output'];
  /** Units being received by this platform warehouse when available. */
  receivingQuantity?: Maybe<Scalars['Int']['output']>;
  /** Units shipped toward this platform warehouse when available. */
  shippedQuantity?: Maybe<Scalars['Int']['output']>;
  /** Shop alias/name. */
  shopAlias?: Maybe<Scalars['String']['output']>;
  /** Shop Mongo ID. */
  shopId: Scalars['ID']['output'];
  /** Source system label, such as TIKTOK_FBT or TIKTOK_SHOP. */
  sourceSystem: Scalars['String']['output'];
  /** Warehouse display name when available. */
  warehouseName?: Maybe<Scalars['String']['output']>;
}

/** Source-of-truth inventory and performance bundle for desktop agent analysis. */
export interface InventoryAnalysisPayload {
  /** One row per seller SKU / canonical InventoryGood identity. */
  rows: Array<InventoryAnalysisRow>;
  /** Number of seller SKU rows returned. */
  totalCount: Scalars['Int']['output'];
}

/** One seller SKU inventory analysis row. */
export interface InventoryAnalysisRow {
  /** Current inventory facts grouped for agent-side analysis. */
  inventory: InventoryAnalysisInventoryFacts;
  /** Best available display name for this seller SKU. */
  name?: Maybe<Scalars['String']['output']>;
  /** Exact seller SKU / canonical merchant SKU for this row. */
  sellerSku: Scalars['String']['output'];
  /** Concrete shop SKUs/listings connected to this inventory row. Present even when there is no performance in the requested date range. */
  shopSkus: Array<InventoryAnalysisShopSku>;
}

/** Concrete shop product SKU/listing connected to one inventory analysis row. */
export interface InventoryAnalysisShopSku {
  /** Historical order-derived SKU demand facts for this concrete shop SKU. */
  performance: InventoryAnalysisShopSkuPerformanceFacts;
  /** Shop platform product ID. */
  productId: Scalars['String']['output'];
  /** Product lifecycle status on the shop platform. */
  productStatus?: Maybe<Scalars['String']['output']>;
  /** Product title on the shop platform. */
  productTitle?: Maybe<Scalars['String']['output']>;
  /** Exact seller SKU on the shop SKU/listing. */
  sellerSku: Scalars['String']['output'];
  /** Shop alias/name. */
  shopAlias?: Maybe<Scalars['String']['output']>;
  /** Shop Mongo ID. */
  shopId: Scalars['ID']['output'];
  /** Shop platform SKU ID. */
  skuId: Scalars['String']['output'];
  /** Shop SKU display label, usually sellerSku. */
  skuName?: Maybe<Scalars['String']['output']>;
  /** SKU lifecycle status on the shop platform. */
  skuStatus?: Maybe<Scalars['String']['output']>;
}

/** Daily order-derived performance facts for one concrete shop SKU. */
export interface InventoryAnalysisShopSkuDatePerformance {
  /** Shop-local analytics date (YYYY-MM-DD). */
  dateKey: Scalars['String']['output'];
  /** GMV for this shop/date/SKU row. */
  gmv?: Maybe<EcomAnalyticsMoney>;
  /** Orders for this shop/date/SKU row. */
  skuOrders?: Maybe<Scalars['Int']['output']>;
  /** Units sold for this shop/date/SKU row. */
  unitsSold?: Maybe<Scalars['Int']['output']>;
}

/** Order-derived performance facts for one concrete shop SKU. */
export interface InventoryAnalysisShopSkuPerformanceFacts {
  /** Raw daily demand facts for this shop SKU. */
  byDate: Array<InventoryAnalysisShopSkuDatePerformance>;
  /** End date exclusive in shop-local analytics date format (YYYY-MM-DD). */
  endDateLt: Scalars['String']['output'];
  /** Start date inclusive in shop-local analytics date format (YYYY-MM-DD). */
  startDateGe: Scalars['String']['output'];
}

/** Inventory quantity for a third-party WMS warehouse where WMS is the source of truth. */
export interface InventoryAnalysisThirdPartyWmsWarehouseStock {
  /** Shop backend observations mapped to this WMS warehouse. */
  inShopQuantities: Array<InventoryAnalysisInShopWarehouseQuantity>;
  /** Units currently in transit to this WMS warehouse when available. */
  inTransitQuantity?: Maybe<Scalars['Int']['output']>;
  /** Whether the linked canonical inventory_good is ACTIVE in MongoDB. */
  isActive: Scalars['Boolean']['output'];
  /** Authoritative WMS warehouse quantity when available. */
  quantity?: Maybe<Scalars['Int']['output']>;
  /** Source system label, such as YEJOIN_WMS. */
  sourceSystem: Scalars['String']['output'];
  /** Warehouse display name when available. */
  warehouseName?: Maybe<Scalars['String']['output']>;
  /** WMS account Mongo ID. */
  wmsAccountId: Scalars['ID']['output'];
  /** WMS account label. */
  wmsAccountLabel?: Maybe<Scalars['String']['output']>;
}

/** ISO 3166-1 alpha-2 country code for inventory goods */
export const InventoryCountryCode = {
  Au: 'AU',
  Ca: 'CA',
  Cn: 'CN',
  De: 'DE',
  Fr: 'FR',
  Gb: 'GB',
  Jp: 'JP',
  Us: 'US',
  Vn: 'VN'
} as const;

export type InventoryCountryCode = typeof InventoryCountryCode[keyof typeof InventoryCountryCode];
/** Dimension unit for inventory goods */
export const InventoryDimensionUnit = {
  Cm: 'CM',
  In: 'IN'
} as const;

export type InventoryDimensionUnit = typeof InventoryDimensionUnit[keyof typeof InventoryDimensionUnit];
/** Canonical merchant-owned stockable inventory item */
export interface InventoryGood {
  barcode?: Maybe<Scalars['String']['output']>;
  countryOfOrigin?: Maybe<InventoryCountryCode>;
  createdAt: Scalars['DateTimeISO']['output'];
  declaredValue?: Maybe<Scalars['Float']['output']>;
  declaredValueCurrency?: Maybe<Currency>;
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
/** ISO 3166-1 alpha-2 country or region code used by inventory warehouse metadata */
export const InventoryRegionCode = {
  Au: 'AU',
  Ca: 'CA',
  Cn: 'CN',
  De: 'DE',
  Fr: 'FR',
  Gb: 'GB',
  Id: 'ID',
  Jp: 'JP',
  My: 'MY',
  Ph: 'PH',
  Sg: 'SG',
  Th: 'TH',
  Us: 'US',
  Vn: 'VN'
} as const;

export type InventoryRegionCode = typeof InventoryRegionCode[keyof typeof InventoryRegionCode];
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
  support?: Maybe<UserSupport>;
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
  /** Publish an ephemeral affiliate signal to active desktop subscribers. This does not persist conversation, creator, or order data. */
  affiliatePublishConversationSignal: AffiliateConversationSignal;
  /** Apply a shop-scoped tag inside a user-level creator relation. */
  applyCreatorTag: CreatorUserRelation;
  /** Complete TikTok OAuth from a public website callback using the one-time OAuth code and CSRF state. */
  completeTikTokOAuth: CompleteTikTokOAuthResponse;
  /** Create a payment through Stripe or Lakala. */
  createPayment: Payment;
  /** Create a new run profile */
  createRunProfile: RunProfile;
  /** Create a new surface */
  createSurface: Surface;
  /** Acknowledge success/failure after executing a local CS escalation side-effect */
  csAckEscalationEvent?: Maybe<CsEscalationEventDelivery>;
  /** Claim a CS escalation side-effect event for exactly-once local execution */
  csClaimEscalationEvent?: Maybe<CsEscalationEventDelivery>;
  /** Create a cloud CS escalation and queue a local manager-notification side-effect event */
  csEscalate: CsEscalateResult;
  /** Get an existing CS session or create a new one for a conversation */
  csGetOrCreateSession: CsSessionResult;
  /** Publish a CS conversation signal. Buyer-message and unread-detected signals also mark the conversation pending. */
  csPublishConversationSignal: CsConversationSignal;
  /** Admin/Airflow hook: re-publish failed CS escalation side-effect events to active GraphQL subscribers. Only the latest event per escalation is considered; older failed events are ignored once a newer event exists. */
  csPublishFailedEscalationEvents: Scalars['Int']['output'];
  /** Admin/Airflow hook: re-publish failed CS escalation side-effect events to active GraphQL subscribers. Only the latest event per escalation is considered; older failed events are ignored once a newer event exists. */
  csPublishPendingEscalationEvents: Scalars['Int']['output'];
  /** Write a manager response to a CS escalation and queue a local CS-agent wake event */
  csRespond: CsRespondResult;
  /** Publish a manual CS conversation signal that asks the assigned desktop to start a CS agent session */
  csStartSession: CsConversationSignal;
  /** Record an approval/rejection/modification decision. APPROVED executes the frozen action intent through the backend proposal service. */
  decideActionProposal: ActionProposal;
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
  /** Update inventory for one or more shops. Each input item contains shopId and its SKU inventory updates. */
  ecommerceUpdateInventory: Array<EcomUpdateInventoryResult>;
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
  /** Query the provider and refresh a payment's status. */
  refreshPayment: Payment;
  /** Refresh an expired access token */
  refreshToken: AuthPayload;
  /** Refund a Stripe or Lakala payment. */
  refundPayment: Payment;
  /** Register a new user account */
  register: AuthPayload;
  /** Remove a shop-scoped tag from a user-level creator relation. */
  removeCreatorTag: CreatorUserRelation;
  /** Request one typed affiliate action. Backend policy decides direct execution vs ActionProposal. */
  requestAffiliateAction: RequestAffiliateActionPayload;
  /** Request a new captcha challenge */
  requestCaptcha: CaptchaResponse;
  /** Resolve one affiliate work item. REQUEST_ACTION may execute immediately or create an ActionProposal; non-action decisions ack the work boundary and update collaboration state. */
  resolveAffiliateWorkItem: ResolveAffiliateWorkItemPayload;
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
  /** Create or update an affiliate approval interception policy. */
  writeAffiliateApprovalPolicy: AffiliateApprovalPolicy;
  /** Create or update an affiliate campaign. */
  writeAffiliateCampaign: AffiliateCampaign;
  /** Create or update a campaign product setup row. */
  writeCampaignProduct: CampaignProduct;
  /** Create or update a concrete creator marketplace search run. This is platform/search audit state, not workflow planning state. */
  writeCreatorSearchRun: CreatorSearchRun;
  /** Create or update a creator tag. */
  writeCreatorTag: CreatorTag;
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


export interface MutationAffiliatePublishConversationSignalArgs {
  input: PublishAffiliateConversationSignalInput;
}


export interface MutationApplyCreatorTagArgs {
  input: ApplyCreatorTagInput;
}


export interface MutationCompleteTikTokOAuthArgs {
  code: Scalars['String']['input'];
  state: Scalars['String']['input'];
}


export interface MutationCreatePaymentArgs {
  input: CreatePaymentGraphqlInput;
}


export interface MutationCreateRunProfileArgs {
  input: CreateRunProfileInput;
}


export interface MutationCreateSurfaceArgs {
  input: CreateSurfaceInput;
}


export interface MutationCsAckEscalationEventArgs {
  input: AckCsEscalationEventInput;
}


export interface MutationCsClaimEscalationEventArgs {
  input: ClaimCsEscalationEventInput;
}


export interface MutationCsEscalateArgs {
  buyerNickname?: InputMaybe<Scalars['String']['input']>;
  buyerUserId: Scalars['String']['input'];
  context?: InputMaybe<Scalars['String']['input']>;
  conversationId: Scalars['String']['input'];
  orderId?: InputMaybe<Scalars['String']['input']>;
  reason: Scalars['String']['input'];
  shopId: Scalars['ID']['input'];
}


export interface MutationCsGetOrCreateSessionArgs {
  conversationId: Scalars['String']['input'];
  shopId: Scalars['ID']['input'];
}


export interface MutationCsPublishConversationSignalArgs {
  input: PublishCsConversationSignalInput;
}


export interface MutationCsPublishFailedEscalationEventsArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
}


export interface MutationCsPublishPendingEscalationEventsArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
}


export interface MutationCsRespondArgs {
  decision: Scalars['String']['input'];
  escalationId: Scalars['ID']['input'];
  instructions: Scalars['String']['input'];
  resolved?: Scalars['Boolean']['input'];
}


export interface MutationCsStartSessionArgs {
  conversationId: Scalars['String']['input'];
  operatorInstruction?: InputMaybe<Scalars['String']['input']>;
  orderId?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['ID']['input'];
}


export interface MutationDecideActionProposalArgs {
  input: DecideActionProposalInput;
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
  updates: Array<EcomShopUpdateInventoryInput>;
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


export interface MutationRefreshPaymentArgs {
  paymentId: Scalars['ID']['input'];
}


export interface MutationRefreshTokenArgs {
  refreshToken: Scalars['String']['input'];
}


export interface MutationRefundPaymentArgs {
  input: RefundPaymentGraphqlInput;
}


export interface MutationRegisterArgs {
  input: RegisterInput;
}


export interface MutationRemoveCreatorTagArgs {
  input: ApplyCreatorTagInput;
}


export interface MutationRequestAffiliateActionArgs {
  input: RequestAffiliateActionInput;
}


export interface MutationResolveAffiliateWorkItemArgs {
  input: ResolveAffiliateWorkItemInput;
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


export interface MutationWriteAffiliateApprovalPolicyArgs {
  input: WriteAffiliateApprovalPolicyInput;
}


export interface MutationWriteAffiliateCampaignArgs {
  input: WriteAffiliateCampaignInput;
}


export interface MutationWriteCampaignProductArgs {
  input: WriteCampaignProductInput;
}


export interface MutationWriteCreatorSearchRunArgs {
  input: WriteCreatorSearchRunInput;
}


export interface MutationWriteCreatorTagArgs {
  input: WriteCreatorTagInput;
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

/** Unified payment record across payment providers. */
export interface Payment {
  /** Amount in the currency minor unit: cents for USD, fen for CNY. */
  amountMinor: Scalars['Int']['output'];
  /** Redirect checkout URL when the provider creates one. */
  checkoutUrl?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTimeISO']['output'];
  currency: Currency;
  description?: Maybe<Scalars['String']['output']>;
  expiresAt?: Maybe<Scalars['DateTimeISO']['output']>;
  id: Scalars['ID']['output'];
  /** Last provider error code or message. */
  lastError?: Maybe<Scalars['String']['output']>;
  lastProviderEventAt?: Maybe<Scalars['DateTimeISO']['output']>;
  /** EasyClaw merchant order ID sent to the provider. */
  merchantOrderId: Scalars['String']['output'];
  method: PaymentMethod;
  paidAt?: Maybe<Scalars['DateTimeISO']['output']>;
  provider: PaymentProviderName;
  /** Provider order/transaction ID, such as Lakala transactionId. */
  providerOrderId?: Maybe<Scalars['String']['output']>;
  /** Provider primary payment/session ID, such as Stripe checkout session ID. */
  providerPaymentId?: Maybe<Scalars['String']['output']>;
  /** Raw QR code payload when the provider returns one. */
  qrCode?: Maybe<Scalars['String']['output']>;
  /** QR code URL when the provider returns one. */
  qrCodeUrl?: Maybe<Scalars['String']['output']>;
  status: PaymentStatus;
  subject: Scalars['String']['output'];
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['String']['output'];
}

/** Public, limited checkout status for a payment callback page. */
export interface PaymentCheckoutStatus {
  amountMinor: Scalars['Int']['output'];
  currency: Currency;
  method: PaymentMethod;
  paidAt?: Maybe<Scalars['DateTimeISO']['output']>;
  provider: PaymentProviderName;
  status: PaymentStatus;
  subject: Scalars['String']['output'];
  updatedAt?: Maybe<Scalars['DateTimeISO']['output']>;
}

/** Customer-facing payment method family. */
export const PaymentMethod = {
  Card: 'CARD',
  QrCode: 'QR_CODE'
} as const;

export type PaymentMethod = typeof PaymentMethod[keyof typeof PaymentMethod];
/** External payment processor used for a payment. */
export const PaymentProviderName = {
  Lakala: 'LAKALA',
  Stripe: 'STRIPE'
} as const;

export type PaymentProviderName = typeof PaymentProviderName[keyof typeof PaymentProviderName];
/** Unified payment lifecycle state. */
export const PaymentStatus = {
  Canceled: 'CANCELED',
  Failed: 'FAILED',
  PartiallyRefunded: 'PARTIALLY_REFUNDED',
  Pending: 'PENDING',
  Refunded: 'REFUNDED',
  RequiresPayment: 'REQUIRES_PAYMENT',
  Succeeded: 'SUCCEEDED'
} as const;

export type PaymentStatus = typeof PaymentStatus[keyof typeof PaymentStatus];
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
  De: 'DE',
  Fr: 'FR',
  Gb: 'GB',
  Id: 'ID',
  Ie: 'IE',
  It: 'IT',
  Mx: 'MX',
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

/** Input for publishing an ephemeral affiliate signal */
export interface PublishAffiliateConversationSignalInput {
  /** Existing AffiliateCollaboration ID when the publisher already resolved it. */
  affiliateCollaborationId?: InputMaybe<Scalars['ID']['input']>;
  /** Existing AffiliateCollaborationRecord ID for timer/action-result reducer events. */
  collaborationRecordId?: InputMaybe<Scalars['ID']['input']>;
  /** Open or target collaboration type when known. */
  collaborationType?: InputMaybe<AffiliateCollaborationType>;
  /** Observed content comment count when available. */
  contentCommentCount?: InputMaybe<Scalars['Float']['input']>;
  /** Observed content description/title when available. */
  contentDescription?: InputMaybe<Scalars['String']['input']>;
  /** Observed content format, e.g. VIDEO or LIVE. */
  contentFormat?: InputMaybe<Scalars['String']['input']>;
  /** Platform content ID if available. */
  contentId?: InputMaybe<Scalars['String']['input']>;
  /** Observed content like count when available. */
  contentLikeCount?: InputMaybe<Scalars['Float']['input']>;
  /** Observed TikTok content page link when available. */
  contentPageLink?: InputMaybe<Scalars['String']['input']>;
  /** Observed paid order count attributed to the content when available. */
  contentPaidOrderCount?: InputMaybe<Scalars['Float']['input']>;
  /** Observed content source URL when available. */
  contentUrl?: InputMaybe<Scalars['String']['input']>;
  /** Observed content view count when available. */
  contentViewCount?: InputMaybe<Scalars['Float']['input']>;
  /** Platform conversation/thread ID when message-related. */
  conversationId?: InputMaybe<Scalars['String']['input']>;
  /** Best-known creator avatar URL from platform sync. */
  creatorAvatarUrl?: InputMaybe<Scalars['String']['input']>;
  /** Best-known creator follower count from platform sync. */
  creatorFollowerCount?: InputMaybe<Scalars['Float']['input']>;
  /** Creator IM user ID if available. */
  creatorImId?: InputMaybe<Scalars['String']['input']>;
  /** Best-known creator display nickname from platform sync. */
  creatorNickname?: InputMaybe<Scalars['String']['input']>;
  /** Creator open ID if available. */
  creatorOpenId?: InputMaybe<Scalars['String']['input']>;
  /** Best-known creator username from platform sync. */
  creatorUsername?: InputMaybe<Scalars['String']['input']>;
  /** Event timestamp as an ISO string. Defaults to server publish time. */
  eventTime?: InputMaybe<Scalars['String']['input']>;
  /** Observed message direction. Legacy CREATOR_MESSAGE_RECEIVED defaults to CREATOR when omitted. */
  messageDirection?: InputMaybe<AffiliateConversationMessageDirection>;
  /** Platform message ID for creator message signals. */
  messageId?: InputMaybe<Scalars['String']['input']>;
  /** Platform message index when available. */
  messageIndex?: InputMaybe<Scalars['String']['input']>;
  /** Platform message type, e.g. TEXT or IMAGE. */
  messageType?: InputMaybe<Scalars['String']['input']>;
  /** Platform notification ID if available. */
  notificationId?: InputMaybe<Scalars['String']['input']>;
  /** Order ID for affiliate order attribution signals. */
  orderId?: InputMaybe<Scalars['String']['input']>;
  /** Platform sample application ID for sample workflow signals. */
  platformApplicationId?: InputMaybe<Scalars['String']['input']>;
  /** Platform collaboration ID normalized across open and target collaborations. */
  platformCollaborationId?: InputMaybe<Scalars['String']['input']>;
  /** Platform content/fulfillment ID if available. */
  platformFulfillmentId?: InputMaybe<Scalars['String']['input']>;
  /** Platform fulfillment status for sample content fulfillment sync. */
  platformFulfillmentStatus?: InputMaybe<TikTokSampleContentFulfillmentPlatformStatus>;
  /** Platform open collaboration ID for open collaboration sample/update signals. */
  platformOpenCollaborationId?: InputMaybe<Scalars['String']['input']>;
  /** Platform affiliate program ID if available. */
  platformProgramId?: InputMaybe<Scalars['String']['input']>;
  /** Platform shop ID. Relay/webhook publishers provide this when they do not know the MongoDB shop ID. */
  platformShopId?: InputMaybe<Scalars['String']['input']>;
  /** Platform status string if available. */
  platformStatus?: InputMaybe<Scalars['String']['input']>;
  /** Platform target collaboration ID for collaboration workflow signals. */
  platformTargetCollaborationId?: InputMaybe<Scalars['String']['input']>;
  /** Product ID if available. */
  productId?: InputMaybe<Scalars['String']['input']>;
  /** Platform sender ID if available. */
  senderId?: InputMaybe<Scalars['String']['input']>;
  /** Sender role from the platform event, e.g. CREATOR. */
  senderRole?: InputMaybe<Scalars['String']['input']>;
  /** MongoDB shop ID. Provide this from authenticated clients when available. */
  shopId?: InputMaybe<Scalars['ID']['input']>;
  /** Origin of the signal. */
  source: AffiliateConversationSignalSource;
  /** Business signal to publish. */
  type: AffiliateConversationSignalType;
}

/** Input for publishing an ephemeral CS conversation signal */
export interface PublishCsConversationSignalInput {
  /** Platform buyer user ID if available. */
  buyerUserId?: InputMaybe<Scalars['String']['input']>;
  /** Platform conversation/thread ID that desktop should inspect. */
  conversationId: Scalars['String']['input'];
  /** Event timestamp as an ISO string. Defaults to server publish time. */
  eventTime?: InputMaybe<Scalars['String']['input']>;
  /** Platform IM user ID if available. */
  imUserId?: InputMaybe<Scalars['String']['input']>;
  /** Platform message ID for MESSAGE_RECEIVED signals. */
  messageId?: InputMaybe<Scalars['String']['input']>;
  /** Platform message index when available for event ordering. */
  messageIndex?: InputMaybe<Scalars['String']['input']>;
  /** Platform message type, e.g. TEXT or IMAGE. */
  messageType?: InputMaybe<Scalars['String']['input']>;
  /** Optional operator instruction/comment to inject into the local CS agent catch-up prompt. */
  operatorInstruction?: InputMaybe<Scalars['String']['input']>;
  /** Related order ID if available. */
  orderId?: InputMaybe<Scalars['String']['input']>;
  /** Platform shop ID. Relay/webhook publishers provide this when they do not know the MongoDB shop ID. */
  platformShopId?: InputMaybe<Scalars['String']['input']>;
  /** Sender role from the platform event, e.g. BUYER. */
  senderRole?: InputMaybe<Scalars['String']['input']>;
  /** MongoDB shop ID. Provide this from authenticated clients when available. */
  shopId?: InputMaybe<Scalars['ID']['input']>;
  /** Origin of the signal. */
  source: CsConversationSignalSource;
  /** Business signal to publish. */
  type: CsConversationSignalType;
}

export interface Query {
  /** Read human-reviewable affiliate action proposals. */
  actionProposals: Array<ActionProposal>;
  /** Read affiliate approval interception policies. */
  affiliateApprovalPolicies: Array<AffiliateApprovalPolicy>;
  /** Read affiliate campaigns from Mongo state. */
  affiliateCampaigns: Array<AffiliateCampaign>;
  /** Read platform-level affiliate collaborations, normalized across open and target collaborations. */
  affiliateCollaborations: Array<AffiliateCollaboration>;
  /** Get a bounded affiliate creator conversation delta from a local OpenClaw-session anchor through the current inbound message. */
  affiliateConversationMessageDelta: EcomAffiliateMessageDelta;
  /** Read current backend-materialized affiliate work projections. Desktop uses this for initial review/dispatch state; subscriptions keep it fresh. */
  affiliateWorkItems: Array<AffiliateWorkItem>;
  /** Read compressed affiliate management workspace state from Mongo control-plane state. */
  affiliateWorkspace: AffiliateWorkspacePayload;
  /** Get a single browser profile by ID */
  browserProfile?: Maybe<BrowserProfile>;
  /** Get audit log for a browser profile */
  browserProfileAuditLog: Array<BrowserProfileAuditEntry>;
  /** List browser profiles for the authenticated user */
  browserProfiles: PaginatedBrowserProfiles;
  /** Read campaign product setup rows from Mongo state. */
  campaignProducts: Array<CampaignProduct>;
  /** Check if a newer version is available (public, no auth required) */
  checkUpdate?: Maybe<UpdatePayload>;
  /** Read creator collaborations, including backend-materialized NEED_PROCESS work for affiliate agents. */
  collaborationRecords: Array<AffiliateCollaborationRecord>;
  /** Read creator candidates discovered by search and qualification. Blocked creator relations are filtered out at read time. */
  creatorCandidates: Array<CreatorCandidate>;
  /** Read concrete creator marketplace search runs from Mongo state. */
  creatorSearchRuns: Array<CreatorSearchRun>;
  /** Read shop-scoped creator tags used by segmentation and approval policies. */
  creatorTags: Array<CreatorTag>;
  /** Read user-scoped creator relations with embedded shop lifecycle state. Blocked creators are excluded unless explicitly requested by lifecycleStage=BLOCKED. */
  creatorUserRelations: Array<CreatorUserRelation>;
  /** Read the current cloud status and result for a CS escalation */
  csGetEscalationResult?: Maybe<CsEscalationLookupResult>;
  /** List open CS escalations for the authenticated user, including pending and in-progress items */
  csOpenEscalations: Array<CsEscalation>;
  /** List open CS escalations with total count and pagination metadata */
  csOpenEscalationsPage: CsOpenEscalationPage;
  /** List unhandled CS escalation side-effect events for the authenticated user's desktop actuator */
  csPendingEscalationEvents: Array<CsEscalationEventDelivery>;
  /** Get aftersale eligibility for an order */
  ecommerceGetAftersaleEligibility: EcomAftersaleEligibility;
  /** Get customer service performance metrics from the warehouse as one row per shop-local date. */
  ecommerceGetCSPerformance: Array<CustomerServicePerformance>;
  /** Get full conversation details including conversation metadata (unread count, status, participants, latest message preview) and a normalized buyer participant slice. */
  ecommerceGetConversationDetails: CustomerServiceConversationDetails;
  /** Get a bounded customer-service conversation delta from a local OpenClaw-session anchor through the current inbound message. */
  ecommerceGetConversationMessageDelta: CustomerServiceMessageDelta;
  /** Get messages of a conversation */
  ecommerceGetConversationMessages: CustomerServiceMessageSummaryPage;
  /** Get conversations for a shop as a flat summary list. Pagination is handled internally by the backend. */
  ecommerceGetConversations: Array<CustomerServiceConversationSummary>;
  /** Get fulfillment tracking for an order. Optional buyerUserId for buyer scoping. */
  ecommerceGetFulfillmentTracking: EcomOrderTracking;
  /** Get order details by order ID. Returns null if the order is not found or does not belong to the optional buyerUserId. */
  ecommerceGetOrder?: Maybe<EcomOrder>;
  /** Get order-derived sales statistics from fct_order_shop_daily, fct_order_product_daily, or fct_order_sku_daily. */
  ecommerceGetOrderSalesStats: EcomOrderSalesStatsResult;
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
  /** Get order-derived shop SKU demand metrics from the warehouse as one row per shop-local date and SKU. Returns full item fields plus totalCount metadata. */
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
  /** Get preset skills for services. Returns a JSON object { key: markdownContentOrZipUrl, ... } or null if none configured. */
  presetSkills?: Maybe<Scalars['String']['output']>;
  /** Get pricing for all providers */
  pricing: Array<ProviderPricing>;
  /** Read source-of-truth inventory and order-derived SKU demand facts for agent-side inventory and replenishment analysis. */
  readInventoryAnalysis: InventoryAnalysisPayload;
  /** Read external SKU to InventoryGood mappings. Use input.id for one row, or filters for a list. */
  readInventoryGoodMappings: Array<InventoryGoodMapping>;
  /** Read canonical stockable inventory goods. Use input.id for one row, or filters for a list. */
  readInventoryGoods: Array<InventoryGood>;
  /** Read payments for the current user. */
  readPayments: Array<Payment>;
  /** Read active shop SKU coverage against canonical InventoryGood. Returns unrecognized active shop SKUs and active InventoryGoods that this shop does not currently resolve to. */
  readShopInventoryGoodCoverage: ShopInventoryGoodCoveragePayload;
  /** Read shop-scoped platform warehouses. Use input.id for one row, or filters for a list. */
  readShopWarehouses: Array<ShopWarehouse>;
  /** Read a public, limited Stripe Checkout status by Checkout Session ID. */
  readStripeCheckoutStatus?: Maybe<PaymentCheckoutStatus>;
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


export interface QueryActionProposalsArgs {
  input: ReadActionProposalsInput;
}


export interface QueryAffiliateApprovalPoliciesArgs {
  input: ReadAffiliateApprovalPoliciesInput;
}


export interface QueryAffiliateCampaignsArgs {
  input: ReadAffiliateCampaignsInput;
}


export interface QueryAffiliateCollaborationsArgs {
  input: ReadAffiliateCollaborationsInput;
}


export interface QueryAffiliateConversationMessageDeltaArgs {
  anchor?: InputMaybe<ConversationMessageDeltaAnchorInput>;
  conversationId: Scalars['String']['input'];
  currentMessageId: Scalars['String']['input'];
  maxPages?: InputMaybe<Scalars['Int']['input']>;
  shopId: Scalars['String']['input'];
}


export interface QueryAffiliateWorkItemsArgs {
  input?: InputMaybe<ReadAffiliateWorkItemsInput>;
}


export interface QueryAffiliateWorkspaceArgs {
  input: AffiliateWorkspaceInput;
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


export interface QueryCampaignProductsArgs {
  campaignId: Scalars['String']['input'];
}


export interface QueryCheckUpdateArgs {
  clientVersion: Scalars['String']['input'];
}


export interface QueryCollaborationRecordsArgs {
  input: ReadAffiliateCollaborationRecordsInput;
}


export interface QueryCreatorCandidatesArgs {
  input: ReadCreatorCandidatesInput;
}


export interface QueryCreatorSearchRunsArgs {
  input: ReadCreatorSearchRunsInput;
}


export interface QueryCreatorTagsArgs {
  shopId: Scalars['String']['input'];
}


export interface QueryCreatorUserRelationsArgs {
  input: ReadCreatorRelationsInput;
}


export interface QueryCsGetEscalationResultArgs {
  escalationId: Scalars['ID']['input'];
}


export interface QueryCsOpenEscalationsArgs {
  filter?: InputMaybe<CsOpenEscalationFilterInput>;
}


export interface QueryCsOpenEscalationsPageArgs {
  filter?: InputMaybe<CsOpenEscalationFilterInput>;
}


export interface QueryCsPendingEscalationEventsArgs {
  filter?: InputMaybe<CsEscalationEventFilterInput>;
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


export interface QueryEcommerceGetConversationMessageDeltaArgs {
  anchor?: InputMaybe<ConversationMessageDeltaAnchorInput>;
  conversationId: Scalars['String']['input'];
  currentMessageId: Scalars['String']['input'];
  locale?: InputMaybe<Scalars['String']['input']>;
  maxPages?: InputMaybe<Scalars['Int']['input']>;
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


export interface QueryEcommerceGetOrderSalesStatsArgs {
  input: EcomOrderSalesStatsInput;
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


export interface QueryPresetSkillsArgs {
  serviceIds?: InputMaybe<Array<ServiceId>>;
}


export interface QueryPricingArgs {
  appVersion?: InputMaybe<Scalars['String']['input']>;
  deviceId?: InputMaybe<Scalars['String']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  platform?: InputMaybe<Scalars['String']['input']>;
}


export interface QueryReadInventoryAnalysisArgs {
  input: ReadInventoryAnalysisInput;
}


export interface QueryReadInventoryGoodMappingsArgs {
  input: ReadInventoryGoodMappingsInput;
}


export interface QueryReadInventoryGoodsArgs {
  input: ReadInventoryGoodsInput;
}


export interface QueryReadPaymentsArgs {
  input?: InputMaybe<ReadPaymentsInput>;
}


export interface QueryReadShopInventoryGoodCoverageArgs {
  input: ReadShopInventoryGoodCoverageInput;
}


export interface QueryReadShopWarehousesArgs {
  input: ReadShopWarehousesInput;
}


export interface QueryReadStripeCheckoutStatusArgs {
  sessionId: Scalars['String']['input'];
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

export interface ReadActionProposalsInput {
  creatorId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  shopId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<ActionProposalStatus>;
  type?: InputMaybe<ActionProposalType>;
}

export interface ReadAffiliateApprovalPoliciesInput {
  action?: InputMaybe<AffiliatePolicyAction>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  shopId: Scalars['ID']['input'];
}

export interface ReadAffiliateCampaignsInput {
  id?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  shopId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<AffiliateCampaignStatus>;
}

export interface ReadAffiliateCollaborationRecordsInput {
  campaignId?: InputMaybe<Scalars['ID']['input']>;
  creatorId?: InputMaybe<Scalars['ID']['input']>;
  dueOnly?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  lifecycleStage?: InputMaybe<AffiliateLifecycleStage>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  processReasons?: InputMaybe<Array<AffiliateCollaborationRecordProcessReason>>;
  processingStatus?: InputMaybe<AffiliateCollaborationRecordProcessingStatus>;
  productId?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['ID']['input'];
}

export interface ReadAffiliateCollaborationsInput {
  campaignId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  platformCollaborationId?: InputMaybe<Scalars['String']['input']>;
  productId?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['ID']['input'];
  status?: InputMaybe<AffiliateCollaborationStatus>;
  type?: InputMaybe<AffiliateCollaborationType>;
}

export interface ReadAffiliateWorkItemsInput {
  agentDispatchRecommended?: InputMaybe<Scalars['Boolean']['input']>;
  collaborationRecordId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  processingStatus?: InputMaybe<AffiliateCollaborationRecordProcessingStatus>;
  shopId?: InputMaybe<Scalars['ID']['input']>;
  staffReviewRequired?: InputMaybe<Scalars['Boolean']['input']>;
  workKind?: InputMaybe<AffiliateWorkKind>;
}

export interface ReadCreatorCandidatesInput {
  campaignId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  shopId: Scalars['ID']['input'];
  sourceSearchRunId?: InputMaybe<Scalars['ID']['input']>;
  sourceType?: InputMaybe<CreatorCandidateSourceType>;
  status?: InputMaybe<CreatorCandidateStatus>;
}

export interface ReadCreatorRelationsInput {
  creatorId?: InputMaybe<Scalars['ID']['input']>;
  lifecycleStage?: InputMaybe<AffiliateLifecycleStage>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  shopId: Scalars['ID']['input'];
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
}

export interface ReadCreatorSearchRunsInput {
  campaignId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  requestedByRunId?: InputMaybe<Scalars['String']['input']>;
  shopId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<CreatorSearchRunStatus>;
}

/** Read source-of-truth inventory and order-derived SKU demand rows for inventory analysis. endDateLt is exclusive. */
export interface ReadInventoryAnalysisInput {
  /** End date exclusive in shop-local analytics date format (YYYY-MM-DD). */
  endDateLt: Scalars['String']['input'];
  /** Exact seller SKUs to analyze. Omit or pass an empty list to include active shop SKUs plus seller SKUs that currently have stock or have sales in the requested date range. */
  sellerSkus?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Shop Mongo IDs to include in the analysis. */
  shopIds: Array<Scalars['ID']['input']>;
  /** Start date inclusive in shop-local analytics date format (YYYY-MM-DD). */
  startDateGe: Scalars['String']['input'];
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

/** Read payments by ID, merchant order ID, or list recent payments. */
export interface ReadPaymentsInput {
  id?: InputMaybe<Scalars['ID']['input']>;
  merchantOrderId?: InputMaybe<Scalars['String']['input']>;
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

/** Refund a provider-backed payment. */
export interface RefundPaymentGraphqlInput {
  /** Refund amount in minor units. Defaults to the full payment amount. */
  amountMinor?: InputMaybe<Scalars['Int']['input']>;
  paymentId: Scalars['ID']['input'];
  /** Optional caller-supplied refund order ID. Must be unique per provider refund. */
  refundOrderId?: InputMaybe<Scalars['String']['input']>;
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

export interface RequestAffiliateActionInput {
  approvalPolicyUpdateIntent?: InputMaybe<ActionProposalApprovalPolicyUpdateIntentInput>;
  blockCreatorIntent?: InputMaybe<ActionProposalBlockCreatorIntentInput>;
  campaignId?: InputMaybe<Scalars['ID']['input']>;
  campaignProductUpdateIntent?: InputMaybe<ActionProposalCampaignProductUpdateIntentInput>;
  candidateDecisionIntent?: InputMaybe<ActionProposalCandidateDecisionIntentInput>;
  collaborationRecordId?: InputMaybe<Scalars['ID']['input']>;
  creatorId?: InputMaybe<Scalars['ID']['input']>;
  creatorTagIntent?: InputMaybe<ActionProposalCreatorTagIntentInput>;
  expiresAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  /** The collaboration.lastSignalAt value that this action request handled. Used as the ack boundary. */
  handledSignalAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  messageIntent?: InputMaybe<ActionProposalMessageIntentInput>;
  operatorSummary: Scalars['String']['input'];
  sampleReviewIntent?: InputMaybe<ActionProposalSampleReviewIntentInput>;
  sampleShipmentIntent?: InputMaybe<ActionProposalSampleShipmentIntentInput>;
  shopId: Scalars['ID']['input'];
  targetCollaborationIntent?: InputMaybe<ActionProposalTargetCollaborationIntentInput>;
  type: ActionProposalType;
}

export interface RequestAffiliateActionPayload {
  executionResult?: Maybe<ActionProposalExecutionResultSnapshot>;
  mode: AffiliateActionRequestMode;
  proposal?: Maybe<ActionProposal>;
}

export interface ResolveAffiliateWorkItemActionInput {
  approvalPolicyUpdateIntent?: InputMaybe<ActionProposalApprovalPolicyUpdateIntentInput>;
  blockCreatorIntent?: InputMaybe<ActionProposalBlockCreatorIntentInput>;
  campaignId?: InputMaybe<Scalars['ID']['input']>;
  campaignProductUpdateIntent?: InputMaybe<ActionProposalCampaignProductUpdateIntentInput>;
  candidateDecisionIntent?: InputMaybe<ActionProposalCandidateDecisionIntentInput>;
  creatorId?: InputMaybe<Scalars['ID']['input']>;
  creatorTagIntent?: InputMaybe<ActionProposalCreatorTagIntentInput>;
  expiresAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  messageIntent?: InputMaybe<ResolveAffiliateWorkItemMessageIntentInput>;
  sampleReviewIntent?: InputMaybe<ActionProposalSampleReviewIntentInput>;
  sampleShipmentIntent?: InputMaybe<ActionProposalSampleShipmentIntentInput>;
  targetCollaborationIntent?: InputMaybe<ActionProposalTargetCollaborationIntentInput>;
  type: ActionProposalType;
}

export interface ResolveAffiliateWorkItemInput {
  action?: InputMaybe<ResolveAffiliateWorkItemActionInput>;
  /** Ordered action list for bundled affiliate work. If provided, backend evaluates/executes the whole list together. */
  actions?: InputMaybe<Array<ResolveAffiliateWorkItemActionInput>>;
  collaborationRecordId: Scalars['ID']['input'];
  decision: AffiliateWorkItemResolutionDecision;
  /** The collaboration.lastSignalAt value that this work-item decision handled. Used as the ack boundary. */
  handledSignalAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  nextSellerActionAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  operatorSummary: Scalars['String']['input'];
  shopId: Scalars['ID']['input'];
}

export interface ResolveAffiliateWorkItemMessageIntentInput {
  affiliateCollaborationId?: InputMaybe<Scalars['ID']['input']>;
  conversationId?: InputMaybe<Scalars['String']['input']>;
  creatorId?: InputMaybe<Scalars['ID']['input']>;
  creatorOpenId?: InputMaybe<Scalars['String']['input']>;
  imageHeight?: InputMaybe<Scalars['Int']['input']>;
  imageUrl?: InputMaybe<Scalars['String']['input']>;
  imageWidth?: InputMaybe<Scalars['Int']['input']>;
  /** Optional for agent work-item resolution. Backend defaults text-only messages to TEXT. */
  messageType?: InputMaybe<AffiliateOutboundMessageType>;
  platformApplicationId?: InputMaybe<Scalars['String']['input']>;
  platformTargetCollaborationId?: InputMaybe<Scalars['String']['input']>;
  productId?: InputMaybe<Scalars['String']['input']>;
  sampleApplicationRecordId?: InputMaybe<Scalars['ID']['input']>;
  text?: InputMaybe<Scalars['String']['input']>;
}

export interface ResolveAffiliateWorkItemPayload {
  actionMode?: Maybe<AffiliateActionRequestMode>;
  collaborationRecord?: Maybe<AffiliateCollaborationRecord>;
  decision: AffiliateWorkItemResolutionDecision;
  executionResult?: Maybe<ActionProposalExecutionResultSnapshot>;
  proposal?: Maybe<ActionProposal>;
  stale: Scalars['Boolean']['output'];
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

/** Sample application state from TikTok Shop affiliate workflows. */
export interface SampleApplicationRecord {
  affiliateCollaborationId?: Maybe<Scalars['ID']['output']>;
  carrier?: Maybe<Scalars['String']['output']>;
  collaborationType?: Maybe<AffiliateCollaborationType>;
  creatorId?: Maybe<Scalars['ID']['output']>;
  deliveredAt?: Maybe<Scalars['DateTimeISO']['output']>;
  id: Scalars['ID']['output'];
  latestObservedContentAt?: Maybe<Scalars['DateTimeISO']['output']>;
  latestObservedContentFormat?: Maybe<Scalars['String']['output']>;
  latestObservedContentId?: Maybe<Scalars['String']['output']>;
  latestObservedContentPaidOrderCount?: Maybe<Scalars['Int']['output']>;
  latestObservedContentUrl?: Maybe<Scalars['String']['output']>;
  latestObservedContentViewCount?: Maybe<Scalars['Int']['output']>;
  observedContentCount: Scalars['Int']['output'];
  platformApplicationId: Scalars['String']['output'];
  platformCollaborationId?: Maybe<Scalars['String']['output']>;
  platformOpenCollaborationId?: Maybe<Scalars['String']['output']>;
  platformTargetCollaborationId?: Maybe<Scalars['String']['output']>;
  productId?: Maybe<Scalars['String']['output']>;
  /** RivonClaw-owned sample lifecycle state optimized for agent and operator understanding. */
  sampleWorkStatus: SampleWorkStatus;
  shippedAt?: Maybe<Scalars['DateTimeISO']['output']>;
  shopId: Scalars['ID']['output'];
  trackingNumber?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTimeISO']['output'];
  userId: Scalars['ID']['output'];
}

/** RivonClaw-owned, agent-facing sample lifecycle state. Platform raw statuses stay in platformSnapshotJson. */
export const SampleWorkStatus = {
  ApprovedAwaitingShipment: 'APPROVED_AWAITING_SHIPMENT',
  Cancelled: 'CANCELLED',
  ContentObservedReviewing: 'CONTENT_OBSERVED_REVIEWING',
  DeliveredAwaitingContent: 'DELIVERED_AWAITING_CONTENT',
  Expired: 'EXPIRED',
  Fulfilled: 'FULFILLED',
  FulfillmentFailed: 'FULFILLMENT_FAILED',
  RequestPendingReview: 'REQUEST_PENDING_REVIEW',
  ShippedInTransit: 'SHIPPED_IN_TRANSIT'
} as const;

export type SampleWorkStatus = typeof SampleWorkStatus[keyof typeof SampleWorkStatus];
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
  AffiliateManagement: 'AFFILIATE_MANAGEMENT',
  CustomerService: 'CUSTOMER_SERVICE',
  InventoryManagement: 'INVENTORY_MANAGEMENT',
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
  /** Number of active shop SKU rows that can be safely resolved to InventoryGood. */
  recognizedShopSkusCount: Scalars['Int']['output'];
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
  De: 'DE',
  Fr: 'FR',
  Gb: 'GB',
  Id: 'ID',
  Ie: 'IE',
  It: 'IT',
  Mx: 'MX',
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
  affiliateService: AffiliateServiceSettings;
  customerService: CustomerServiceSettings;
  customerServiceBilling: CustomerServiceBilling;
  wms: WmsSettings;
}

/** Input for updating per-shop service toggles */
export interface ShopServiceConfigInput {
  affiliateService?: InputMaybe<AffiliateServiceSettingsInput>;
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
  regionCode?: Maybe<InventoryRegionCode>;
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
  /** Streams affiliate action proposal changes so desktop review tables can update without polling. */
  affiliateActionProposalChanged: AffiliateActionProposalChanged;
  /** Streams ephemeral affiliate signals to desktop clients. Missing signals are recovered by platform sync/check jobs, not by Mongo replay. */
  affiliateConversationSignal: AffiliateConversationSignal;
  /** Streams backend-materialized affiliate work projections. Desktop should use this as the idempotent source of truth for agent dispatch and review surfaces. */
  affiliateWorkItemChanged: AffiliateWorkItemChanged;
  /** Streams CS conversation signals to desktop clients. Missed pending signals are retried from backend state by Airflow. */
  csConversationSignal: CsConversationSignal;
  /** Streams newly-published CS escalation side-effect events to desktop actuators. Missed events are replayed by Airflow/admin publish mutations, not by subscription connect. */
  csEscalationEvent: CsEscalationEventDelivery;
  /** Fires when an OAuth flow completes (e.g. TikTok shop authorization) */
  oauthComplete: OAuthCompletePayload;
  /** Fires when a shop is updated. Only receives updates for shops owned by the authenticated user. */
  shopUpdated: Shop;
  updateAvailable: UpdatePayload;
}


export interface SubscriptionAffiliateActionProposalChangedArgs {
  shopIds?: InputMaybe<Array<Scalars['ID']['input']>>;
}


export interface SubscriptionAffiliateConversationSignalArgs {
  shopIds?: InputMaybe<Array<Scalars['ID']['input']>>;
}


export interface SubscriptionAffiliateWorkItemChangedArgs {
  shopIds?: InputMaybe<Array<Scalars['ID']['input']>>;
}


export interface SubscriptionCsConversationSignalArgs {
  shopIds?: InputMaybe<Array<Scalars['ID']['input']>>;
}


export interface SubscriptionCsEscalationEventArgs {
  shopIds?: InputMaybe<Array<Scalars['ID']['input']>>;
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
  AffiliateOperator: 'AFFILIATE_OPERATOR',
  CustomerService: 'CUSTOMER_SERVICE',
  ShopOperations: 'SHOP_OPERATIONS'
} as const;

export type SystemRunProfile = typeof SystemRunProfile[keyof typeof SystemRunProfile];
/** System surface identifiers declared by tool metadata */
export const SystemSurface = {
  EcommerceSeller: 'ECOMMERCE_SELLER'
} as const;

export type SystemSurface = typeof SystemSurface[keyof typeof SystemSurface];
/** Raw TikTok sample content fulfillment status values. */
export const TikTokSampleContentFulfillmentPlatformStatus = {
  Cancelled: 'CANCELLED',
  Exempted: 'EXEMPTED',
  Failed: 'FAILED',
  Ongoing: 'ONGOING',
  Overdue: 'OVERDUE',
  Pending: 'PENDING',
  Succeed: 'SUCCEED',
  Suspend: 'SUSPEND'
} as const;

export type TikTokSampleContentFulfillmentPlatformStatus = typeof TikTokSampleContentFulfillmentPlatformStatus[keyof typeof TikTokSampleContentFulfillmentPlatformStatus];
/** Tool functional category */
export const ToolCategory = {
  AffiliateAction: 'AFFILIATE_ACTION',
  AffiliateApproval: 'AFFILIATE_APPROVAL',
  AffiliateRead: 'AFFILIATE_READ',
  AffiliateSearch: 'AFFILIATE_SEARCH',
  BrowserProfiles: 'BROWSER_PROFILES',
  EcommerceShopMgmt: 'ECOMMERCE_SHOP_MGMT',
  EcomCs: 'ECOM_CS',
  EcomCsManagement: 'ECOM_CS_MANAGEMENT',
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
  AffiliateDecideProposal: 'AFFILIATE_DECIDE_PROPOSAL',
  AffiliateGetWorkspace: 'AFFILIATE_GET_WORKSPACE',
  AffiliateResolveWorkItem: 'AFFILIATE_RESOLVE_WORK_ITEM',
  BrowserProfilesGet: 'BROWSER_PROFILES_GET',
  BrowserProfilesList: 'BROWSER_PROFILES_LIST',
  BrowserProfilesManage: 'BROWSER_PROFILES_MANAGE',
  CsEscalate: 'CS_ESCALATE',
  CsGetEscalationResult: 'CS_GET_ESCALATION_RESULT',
  CsRespond: 'CS_RESPOND',
  CsStartSession: 'CS_START_SESSION',
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
  EcomGetInventoryAnalysis: 'ECOM_GET_INVENTORY_ANALYSIS',
  EcomGetOrder: 'ECOM_GET_ORDER',
  EcomGetOrderSalesStats: 'ECOM_GET_ORDER_SALES_STATS',
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
  countryOfOrigin?: Maybe<InventoryCountryCode>;
  declaredValue?: Maybe<Scalars['Float']['output']>;
  declaredValueCurrency?: Maybe<Currency>;
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

export interface UserSupport {
  /** Per-user Telegram debug proxy token for RivonClaw support sessions. */
  telegramDebugProxyToken?: Maybe<Scalars['String']['output']>;
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
  regionCode?: Maybe<InventoryRegionCode>;
  /** System-local source Mongo ID, such as WmsAccount._id, Shop._id, or a future persisted EcomProduct source entity ID. */
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
  regionCode?: Maybe<InventoryRegionCode>;
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
  /** Country or region code for the warehouse address. */
  regionCode?: InputMaybe<InventoryRegionCode>;
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
  /** Default currency for declared inventory goods values imported from this WMS when the provider does not return a currency. */
  declaredValueCurrency?: Maybe<Currency>;
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
  /** Number of WMS goods that already have an active InventoryGood with the same SKU. */
  recognizedWmsGoodsCount: Scalars['Int']['output'];
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

export interface WriteAffiliateApprovalPolicyInput {
  action: AffiliatePolicyAction;
  campaignIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  creatorTagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  productIds?: InputMaybe<Array<Scalars['String']['input']>>;
  reason?: InputMaybe<Scalars['String']['input']>;
  shopId: Scalars['ID']['input'];
}

export interface WriteAffiliateCampaignInput {
  id?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  objectiveType?: InputMaybe<AffiliateCampaignObjectiveType>;
  personalizationMode?: InputMaybe<AffiliateOutreachPersonalizationMode>;
  researchDepth?: InputMaybe<AffiliateResearchDepth>;
  shopId: Scalars['ID']['input'];
  status?: InputMaybe<AffiliateCampaignStatus>;
  targetContentCount?: InputMaybe<Scalars['Int']['input']>;
  targetCreatorCount?: InputMaybe<Scalars['Int']['input']>;
  targetGmvAmount?: InputMaybe<Scalars['Float']['input']>;
  targetGmvCurrency?: InputMaybe<EcomProductSkuCurrency>;
  targetInviteCount?: InputMaybe<Scalars['Int']['input']>;
  targetOrderCount?: InputMaybe<Scalars['Int']['input']>;
}

export interface WriteCampaignProductInput {
  campaignId: Scalars['ID']['input'];
  commissionRate?: InputMaybe<Scalars['Float']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  maxCommissionRate?: InputMaybe<Scalars['Float']['input']>;
  productId: Scalars['String']['input'];
  promotionPriority?: InputMaybe<CampaignProductPromotionPriority>;
  sampleOfferMode?: InputMaybe<CampaignProductSampleOfferMode>;
  sampleQuota?: InputMaybe<Scalars['Int']['input']>;
  sampleUnitCostAmount?: InputMaybe<Scalars['Float']['input']>;
  sampleUnitCostCurrency?: InputMaybe<EcomProductSkuCurrency>;
  shopId: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
}

export interface WriteCreatorSearchRunInput {
  campaignId?: InputMaybe<Scalars['ID']['input']>;
  completedAt?: InputMaybe<Scalars['DateTimeISO']['input']>;
  createdCandidateIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  errorMessage?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  nextPageToken?: InputMaybe<Scalars['String']['input']>;
  platformRequestId?: InputMaybe<Scalars['String']['input']>;
  rawResponseSnapshotJson?: InputMaybe<Scalars['String']['input']>;
  requestedByActorId?: InputMaybe<Scalars['String']['input']>;
  requestedByActorType?: InputMaybe<AffiliateLifecycleActorType>;
  requestedByRunId?: InputMaybe<Scalars['String']['input']>;
  resultCount?: InputMaybe<Scalars['Int']['input']>;
  searchParams: CreatorMarketplaceSearchParamsInput;
  shopId: Scalars['ID']['input'];
  status?: InputMaybe<CreatorSearchRunStatus>;
}

export interface WriteCreatorTagInput {
  id?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  sensitive?: InputMaybe<Scalars['Boolean']['input']>;
  shopId: Scalars['ID']['input'];
  systemKey?: InputMaybe<CreatorSystemTagKey>;
  type?: InputMaybe<CreatorTagType>;
}

/** Write a canonical stockable inventory item. Omit id to locate by exact sku or create a new item. */
export interface WriteInventoryGoodInput {
  barcode?: InputMaybe<Scalars['String']['input']>;
  countryOfOrigin?: InputMaybe<InventoryCountryCode>;
  declaredValue?: InputMaybe<Scalars['Float']['input']>;
  declaredValueCurrency?: InputMaybe<Currency>;
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
  /** Country or region code for the warehouse. */
  regionCode?: InputMaybe<InventoryRegionCode>;
  /** System-local source Mongo ID, such as WmsAccount._id, Shop._id, or a future persisted EcomProduct source entity ID. */
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
  /** Default currency for declared inventory goods values imported from this WMS when the provider does not return a currency. Pass null to clear. */
  declaredValueCurrency?: InputMaybe<Currency>;
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
