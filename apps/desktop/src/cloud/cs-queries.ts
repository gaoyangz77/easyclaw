/**
 * Sends one CS message. The mutation is purposely minimal — no BI counters
 * piggyback. All per-conversation analytics (message count, token totals,
 * tool-call argsJson) now flow through the CS business telemetry stream
 * (`cs.message`, `cs.token_snapshot`, `cs.tool_call` events in ClickHouse),
 * not through MongoDB. See `packages/telemetry` + `CustomerServiceSession`.
 */
export const SEND_MESSAGE_MUTATION = `
  mutation(
    $shopId: String!,
    $conversationId: String!,
    $type: EcomMessageType!,
    $content: String!
  ) {
    ecommerceSendMessage(
      shopId: $shopId,
      conversationId: $conversationId,
      type: $type,
      content: $content
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
