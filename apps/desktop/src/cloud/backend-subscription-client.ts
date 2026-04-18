import { createClient, type Client } from "graphql-ws/client";
import { getApiBaseUrl, type GQL } from "@rivonclaw/core";
import { isNewerVersion } from "@rivonclaw/updater";
import { createLogger } from "@rivonclaw/logger";
import { proxyNetwork } from "../infra/proxy/proxy-aware-network.js";

const log = createLogger("backend-subscription");

const UPDATE_SUBSCRIPTION = `
  subscription UpdateAvailable($clientVersion: String!) {
    updateAvailable(clientVersion: $clientVersion) {
      version
      downloadUrl
    }
  }
`;

const OAUTH_COMPLETE_SUBSCRIPTION = `
  subscription OAuthComplete {
    oauthComplete {
      shopId
      shopName
      platform
    }
  }
`;

const SHOP_UPDATED_SUBSCRIPTION = `
  subscription ShopUpdated {
    shopUpdated {
      __typename
      id
      platform
      platformAppId
      platformShopId
      shopName
      authStatus
      region
      accessTokenExpiresAt
      refreshTokenExpiresAt
      services {
        customerService {
          enabled
          businessPrompt
          runProfileId
          csDeviceId
          csProviderOverride
          csModelOverride
          escalationChannelId
          escalationRecipientId
          platformSystemPrompt
        }
        customerServiceBilling {
          tier
          balance
          balanceExpiresAt
          periodEnd
        }
      }
    }
  }
`;

export type UpdatePayload = GQL.UpdatePayload;

const CHECK_UPDATE_QUERY = `
  query CheckUpdate($clientVersion: String!) {
    checkUpdate(clientVersion: $clientVersion) {
      version
      downloadUrl
    }
  }
`;

/**
 * One-shot GraphQL query to check for updates (public endpoint, no auth needed).
 * Used at startup before the WebSocket subscription is established.
 *
 * Returns `null` when the backend has no update for this version.
 * Throws on network errors, non-2xx HTTP, or GraphQL-level errors.
 */
export async function queryCheckUpdate(
  locale: string,
  currentVersion: string,
  fetchFn: (url: string | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<UpdatePayload | null> {
  const baseUrl = getApiBaseUrl(locale);
  const res = await fetchFn(`${baseUrl}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: CHECK_UPDATE_QUERY,
      variables: { clientVersion: currentVersion },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Update check query failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { checkUpdate?: UpdatePayload } | null;
    errors?: Array<{ message?: string }>;
  };
  if (body.errors?.length) {
    const messages = body.errors.map((e) => e.message ?? "(no message)").join("; ");
    throw new Error(`Update check query returned GraphQL errors: ${messages}`);
  }
  return body.data?.checkUpdate ?? null;
}

export interface OAuthCompletePayload {
  shopId: string;
  shopName: string;
  platform: string;
}

/**
 * Subscription config stored so that active subscriptions can be
 * re-established after a reconnect.
 */
interface SubscriptionConfig {
  key: string;
  subscribe: () => () => void;
}

/**
 * Unified GraphQL subscription client that manages a single shared
 * graphql-ws connection to the backend and exposes per-topic
 * subscribe methods.
 */
export class BackendSubscriptionClient {
  private client: Client | null = null;
  private getToken: (() => string | null) | null = null;

  /** Active unsubscribe functions keyed by subscription name. */
  private activeUnsubscribes = new Map<string, () => void>();

  /** Stored configs for re-subscribing after reconnect. */
  private subscriptionConfigs = new Map<string, SubscriptionConfig>();

  /** Monotonic per-subscription attempt counters for log correlation. */
  private subscriptionAttemptCounters = new Map<string, number>();

  constructor(private readonly locale: string) {}

  isConnected(): boolean {
    return this.client !== null;
  }

  connect(getToken: () => string | null): void {
    if (this.client) return;
    this.getToken = getToken;
    this.doConnect();
  }

  disconnect(): void {
    for (const unsub of this.activeUnsubscribes.values()) {
      unsub();
    }
    this.activeUnsubscribes.clear();

    this.client?.dispose();
    this.client = null;
  }

  reconnect(): void {
    this.disconnect();
    this.doConnect();
  }

  private nextAttempt(key: string): number {
    const next = (this.subscriptionAttemptCounters.get(key) ?? 0) + 1;
    this.subscriptionAttemptCounters.set(key, next);
    return next;
  }

  private formatUnknownError(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    }

    if (typeof err === "object" && err !== null) {
      const record = err as Record<string, unknown>;
      return {
        type: err.constructor?.name ?? "object",
        message: typeof record.message === "string" ? record.message : undefined,
        code: record.code,
        reason: record.reason,
        details: JSON.stringify(record),
      };
    }

    return { value: String(err) };
  }

  private logUnexpectedResult(
    key: string,
    attempt: number,
    fieldName: string,
    result: { data?: Record<string, unknown> | null; errors?: Array<{ message?: string }>; extensions?: unknown },
  ): void {
    const dataKeys = result.data ? Object.keys(result.data) : [];
    const errorMessages = result.errors?.map((err) => err.message ?? "(no message)") ?? [];
    const extensionKeys =
      result.extensions && typeof result.extensions === "object"
        ? Object.keys(result.extensions as Record<string, unknown>)
        : [];

    log.warn("Backend subscription next payload missing expected field", {
      subscription: key,
      attempt,
      expectedField: fieldName,
      hasData: !!result.data,
      dataKeys,
      errorMessages,
      extensionKeys,
    });
  }

  /**
   * Subscribe to update-available events. Returns an unsubscribe function.
   */
  subscribeToUpdates(
    currentVersion: string,
    onUpdate: (payload: UpdatePayload) => void,
    onDismiss?: () => void,
  ): () => void {
    const key = "updates";

    const subscribe = (): () => void => {
      if (!this.client) return () => {};
      const attempt = this.nextAttempt(key);

      return this.client.subscribe<{ updateAvailable: UpdatePayload }>(
        {
          query: UPDATE_SUBSCRIPTION,
          variables: { clientVersion: currentVersion },
        },
        {
          next: (result) => {
            if (result.errors?.length) {
              log.warn("Update subscription next contained GraphQL errors", {
                subscription: key,
                attempt,
                errorMessages: result.errors.map((err) => err.message ?? "(no message)"),
              });
            }
            const payload = result.data?.updateAvailable;
            if (!payload) {
              this.logUnexpectedResult(key, attempt, "updateAvailable", result as any);
              return;
            }
            if (!isNewerVersion(currentVersion, payload.version)) {
              onDismiss?.();
              return;
            }
            onUpdate(payload);
          },
          error: (err) => {
            log.warn("Update subscription error", {
              subscription: key,
              attempt,
              ...this.formatUnknownError(err),
            });
          },
          complete: () => {},
        },
      );
    };

    const config: SubscriptionConfig = { key, subscribe };
    this.subscriptionConfigs.set(key, config);

    const unsub = subscribe();
    this.activeUnsubscribes.set(key, unsub);

    return () => {
      this.activeUnsubscribes.get(key)?.();
      this.activeUnsubscribes.delete(key);
      this.subscriptionConfigs.delete(key);
    };
  }

  /**
   * Subscribe to OAuth-complete events. Returns an unsubscribe function.
   */
  subscribeToOAuthComplete(
    onComplete: (payload: OAuthCompletePayload) => void,
  ): () => void {
    const key = "oauth-complete";

    const subscribe = (): () => void => {
      if (!this.client) return () => {};
      const attempt = this.nextAttempt(key);

      return this.client.subscribe<{ oauthComplete: OAuthCompletePayload }>(
        {
          query: OAUTH_COMPLETE_SUBSCRIPTION,
        },
        {
          next: (result) => {
            if (result.errors?.length) {
              log.warn("OAuth subscription next contained GraphQL errors", {
                subscription: key,
                attempt,
                errorMessages: result.errors.map((err) => err.message ?? "(no message)"),
              });
            }
            const payload = result.data?.oauthComplete;
            if (!payload) {
              this.logUnexpectedResult(key, attempt, "oauthComplete", result as any);
              return;
            }
            onComplete(payload);
          },
          error: (err) => {
            log.warn("OAuth subscription error", {
              subscription: key,
              attempt,
              ...this.formatUnknownError(err),
            });
          },
          complete: () => {},
        },
      );
    };

    const config: SubscriptionConfig = { key, subscribe };
    this.subscriptionConfigs.set(key, config);

    const unsub = subscribe();
    this.activeUnsubscribes.set(key, unsub);

    return () => {
      this.activeUnsubscribes.get(key)?.();
      this.activeUnsubscribes.delete(key);
      this.subscriptionConfigs.delete(key);
    };
  }

  /**
   * Subscribe to shop-updated events. Returns an unsubscribe function.
   * Payload includes __typename so callers can feed it directly into ingestGraphQLResponse.
   */
  subscribeToShopUpdated(
    onShopUpdated: (data: Record<string, unknown>) => void,
  ): () => void {
    const key = "shop-updated";

    const subscribe = (): () => void => {
      if (!this.client) return () => {};
      const attempt = this.nextAttempt(key);

      return this.client.subscribe<{ shopUpdated: Record<string, unknown> }>(
        {
          query: SHOP_UPDATED_SUBSCRIPTION,
        },
        {
          next: (result) => {
            if (result.errors?.length) {
              log.warn("Shop updated subscription next contained GraphQL errors", {
                subscription: key,
                attempt,
                errorMessages: result.errors.map((err) => err.message ?? "(no message)"),
              });
            }
            const payload = result.data?.shopUpdated;
            if (!payload) {
              this.logUnexpectedResult(key, attempt, "shopUpdated", result as any);
              return;
            }
            onShopUpdated(payload);
          },
          error: (err) => {
            log.warn("Shop updated subscription error", {
              subscription: key,
              attempt,
              ...this.formatUnknownError(err),
            });
          },
          complete: () => {},
        },
      );
    };

    const config: SubscriptionConfig = { key, subscribe };
    this.subscriptionConfigs.set(key, config);

    const unsub = subscribe();
    this.activeUnsubscribes.set(key, unsub);

    return () => {
      this.activeUnsubscribes.get(key)?.();
      this.activeUnsubscribes.delete(key);
      this.subscriptionConfigs.delete(key);
    };
  }

  private doConnect(): void {
    if (!this.getToken) return;

    const baseUrl = getApiBaseUrl(this.locale);
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/graphql";

    this.client = createClient({
      url: wsUrl,
      webSocketImpl: proxyNetwork.createProxiedWebSocketClass() as any,
      connectionParams: () => {
        const token = this.getToken?.();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
      retryAttempts: Infinity,
      retryWait: async (retries: number) => {
        const delay = Math.min(1000 * 2 ** retries, 30_000);
        await new Promise((r) => setTimeout(r, delay));
      },
      on: {
        connected: () => {},
        closed: () => {},
        error: (err) => log.warn("Backend subscription WebSocket error (will auto-retry)", this.formatUnknownError(err)),
      },
    });

    // Establish previously registered subscriptions (e.g. after disconnect → connect cycle)
    for (const config of this.subscriptionConfigs.values()) {
      const unsub = config.subscribe();
      this.activeUnsubscribes.set(config.key, unsub);
    }
  }
}
