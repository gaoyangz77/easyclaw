import { createLogger } from "@easyclaw/logger";
import { resolveOpenClawConfigPath, readExistingConfig } from "@easyclaw/gateway";

const log = createLogger("channel-senders");

/** A fetch-like function that routes through the local proxy router. */
type ProxiedFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Resolve the first account config for a given channel from the gateway config.
 */
export function resolveFirstChannelAccount(channelId: string): { accountId: string; config: Record<string, unknown> } | null {
  try {
    const configPath = resolveOpenClawConfigPath();
    const fullConfig = readExistingConfig(configPath);
    const channels = (fullConfig.channels ?? {}) as Record<string, unknown>;
    const channel = (channels[channelId] ?? {}) as Record<string, unknown>;
    const accounts = (channel.accounts ?? {}) as Record<string, Record<string, unknown>>;
    for (const [accountId, config] of Object.entries(accounts)) {
      if (config && typeof config === "object") {
        return { accountId, config };
      }
    }
  } catch (err) {
    log.error(`Failed to resolve ${channelId} account config:`, err);
  }
  return null;
}

// Telegram: POST https://api.telegram.org/bot{token}/sendMessage
async function sendTelegramMessage(chatId: string, text: string, proxiedFetch: ProxiedFetch): Promise<boolean> {
  const account = resolveFirstChannelAccount("telegram");
  const botToken = account?.config.botToken;
  if (!botToken || typeof botToken !== "string") {
    log.error("Telegram: no bot token found");
    return false;
  }
  try {
    const res = await proxiedFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Telegram sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Telegram sendMessage error:", err);
    return false;
  }
}

// Feishu: Get tenant_access_token, then POST to /im/v1/messages
const feishuTokenCache: { token?: string; expiresAt?: number } = {};

async function getFeishuTenantToken(appId: string, appSecret: string, domain: string): Promise<string | null> {
  if (feishuTokenCache.token && feishuTokenCache.expiresAt && Date.now() < feishuTokenCache.expiresAt) {
    return feishuTokenCache.token;
  }
  const host = domain === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  try {
    const res = await fetch(`https://${host}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { tenant_access_token?: string; expire?: number };
    if (!data.tenant_access_token) return null;
    feishuTokenCache.token = data.tenant_access_token;
    feishuTokenCache.expiresAt = Date.now() + ((data.expire ?? 7200) - 60) * 1000;
    return data.tenant_access_token;
  } catch (err) {
    log.error("Feishu tenant token error:", err);
    return null;
  }
}

async function sendFeishuMessage(chatId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("feishu");
  if (!account) return false;
  const appId = account.config.appId as string;
  const appSecret = account.config.appSecret as string;
  const domain = (account.config.domain as string) ?? "feishu";
  if (!appId || !appSecret) {
    log.error("Feishu: missing appId or appSecret");
    return false;
  }
  const token = await getFeishuTenantToken(appId, appSecret, domain);
  if (!token) return false;
  const host = domain === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  try {
    const res = await fetch(`https://${host}/open-apis/im/v1/messages?receive_id_type=open_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Feishu sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Feishu sendMessage error:", err);
    return false;
  }
}

// LINE: POST https://api.line.me/v2/bot/message/push
async function sendLineMessage(chatId: string, text: string, proxiedFetch: ProxiedFetch): Promise<boolean> {
  const account = resolveFirstChannelAccount("line");
  const token = account?.config.channelAccessToken;
  if (!token || typeof token !== "string") {
    log.error("LINE: no channel access token found");
    return false;
  }
  try {
    const res = await proxiedFetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: chatId,
        messages: [{ type: "text", text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`LINE sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("LINE sendMessage error:", err);
    return false;
  }
}

// Mattermost: Create DM channel, then POST message
async function sendMattermostMessage(userId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("mattermost");
  const botToken = account?.config.botToken as string | undefined;
  const baseUrl = account?.config.baseUrl as string | undefined;
  if (!botToken || !baseUrl) {
    log.error("Mattermost: missing botToken or baseUrl");
    return false;
  }
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${botToken}`,
  };
  try {
    // Get bot's own user ID
    const meRes = await fetch(`${baseUrl}/api/v4/users/me`, { headers });
    if (!meRes.ok) return false;
    const me = await meRes.json() as { id: string };

    // Create/get DM channel
    const dmRes = await fetch(`${baseUrl}/api/v4/channels/direct`, {
      method: "POST",
      headers,
      body: JSON.stringify([me.id, userId]),
    });
    if (!dmRes.ok) return false;
    const dm = await dmRes.json() as { id: string };

    // Post message
    const res = await fetch(`${baseUrl}/api/v4/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel_id: dm.id, message: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Mattermost sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Mattermost sendMessage error:", err);
    return false;
  }
}

/**
 * Send a message to a user on the given channel.
 * Returns true if successfully sent, false otherwise.
 */
export async function sendChannelMessage(channelId: string, userId: string, text: string, proxiedFetch: ProxiedFetch): Promise<boolean> {
  switch (channelId) {
    case "telegram": return sendTelegramMessage(userId, text, proxiedFetch);
    case "feishu": return sendFeishuMessage(userId, text);
    case "line": return sendLineMessage(userId, text, proxiedFetch);
    case "mattermost": return sendMattermostMessage(userId, text);
    default:
      log.info(`Channel ${channelId}: message sending not supported yet`);
      return false;
  }
}
