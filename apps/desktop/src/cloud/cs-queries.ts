/**
 * Sends one CS message. The optional `usage` argument piggybacks the
 * conversation's cumulative LLM token totals for billing accounting — backend
 * computes the delta vs the last reported snapshot and $inc's cs_usage_records.
 * Usage is intentionally optional: a missing or malformed payload must never
 * block message delivery, so Desktop omits the argument when it cannot build a
 * valid snapshot.
 */
export const SEND_MESSAGE_MUTATION = `
  mutation(
    $shopId: String!,
    $conversationId: String!,
    $type: EcomMessageType!,
    $content: String!,
    $usage: CsSendUsageInput
  ) {
    ecommerceSendMessage(
      shopId: $shopId,
      conversationId: $conversationId,
      type: $type,
      content: $content,
      usage: $usage
    ) {
      messageId
    }
  }
`;

export const GET_CONVERSATION_DETAILS_QUERY = `
  query($shopId: String!, $conversationId: String!) {
    ecommerceGetConversationDetails(shopId: $shopId, conversationId: $conversationId) {
      buyer { userId nickname }
    }
  }
`;

export const GET_BUYER_ORDERS_QUERY = `
  query($shopId: String!, $buyerUserId: String) {
    ecommerceGetOrders(shopId: $shopId, buyerUserId: $buyerUserId) {
      items { orderId createTime }
    }
  }
`;

export const CS_GET_OR_CREATE_SESSION_MUTATION = `
  mutation CsGetOrCreateSession($shopId: ID!, $conversationId: String!) {
    csGetOrCreateSession(shopId: $shopId, conversationId: $conversationId) {
      sessionId
      isNew
      balance
    }
  }
`;

/**
 * Increments CS session messageCount. Counts BOTH inbound buyer messages and
 * outbound agent replies — one call per message (not per "turn"). This is the
 * raw conversation message counter; it is NOT the billing-turn counter.
 * See CS_RECORD_USAGE_MUTATION for the billing-turn counter.
 */
export const CS_INCREMENT_MESSAGE_COUNT_MUTATION = `
  mutation CsIncrementMessageCount($shopId: ID!, $conversationId: String!) {
    csIncrementMessageCount(shopId: $shopId, conversationId: $conversationId)
  }
`;

export const SEATS_QUERY = `
  query Seats {
    seats {
      id
      userId
      gatewayId
      status
      connectedAt
    }
  }
`;

/**
 * Records per-seat billing-turn usage (messageCount) for the current billing
 * period. Called once per successful agent run (state=final). messageCount is
 * the billing-turn counter (1 per run = "one round of buyer+agent"), distinct
 * from cs_sessions.messageCount which tracks raw inbound/outbound messages.
 *
 * Token fields (inputTokens / outputTokens) on the same cs_usage_records
 * document are written by a SEPARATE path: every successful
 * `ecommerceSendMessage` call piggybacks a cumulative usage snapshot and the
 * backend converts the snapshot into a delta.
 */
export const CS_RECORD_USAGE_MUTATION = `
  mutation CsRecordUsage($seatId: ID!, $messageCount: Int!) {
    csRecordUsage(seatId: $seatId, messageCount: $messageCount)
  }
`;
