import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import { AuthSessionManager } from "../auth/session.js";
import { setAuthSession } from "../auth/session-ref.js";
import { syncCloudProviderKey } from "../providers/cloud-provider-sync.js";
import { BackendSubscriptionClient } from "../cloud/backend-subscription-client.js";
import { rootStore } from "./store/desktop-store.js";
import type { BroadcastEvent } from "./panel-server.js";
import { handleCsEscalationEvent } from "../cs-bridge/cs-escalation-event-actuator.js";

export interface SetupAuthDeps {
  storage: Storage;
  secretStore: SecretStore;
  locale: string;
  deviceId: string;
  proxyFetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
  /** Broadcast an event to every Panel SSE client (routed through the unified `/api/events` bus). */
  broadcastEvent: BroadcastEvent;
}

export interface AuthRuntime {
  authSession: AuthSessionManager;
  backendSubscription: BackendSubscriptionClient;
}

/**
 * Create the auth session manager, load from keychain, wire up the
 * backend subscription client and its event subscriptions.
 */
export async function setupAuth(deps: SetupAuthDeps): Promise<AuthRuntime> {
  const { storage, secretStore, locale, deviceId, proxyFetch, broadcastEvent } = deps;

  // Initialize auth session manager
  const authSession = new AuthSessionManager(secretStore, locale, proxyFetch);
  setAuthSession(authSession);
  authSession.onUserChanged((user) => syncCloudProviderKey(user, storage, secretStore));
  await authSession.loadFromKeychain();
  // NOTE: validate() is deferred until after proxy router starts (caller's responsibility).

  // Initialize unified backend subscription client (single shared graphql-ws connection)
  const backendSubscription = new BackendSubscriptionClient(locale);

  // Start/stop authenticated subscriptions on auth lifecycle changes. Public
  // subscriptions are allowed to remain connected while signed out.
  authSession.onUserChanged((user) => {
    if (user) {
      backendSubscription.enableAuthenticatedSubscriptions();
    } else {
      backendSubscription.disableAuthenticatedSubscriptions();
    }
  });

  // Subscribe to OAuth completion events
  backendSubscription.subscribeToOAuthComplete((payload) => {
    broadcastEvent("oauth-complete", payload);
  });

  // Subscribe to shop-updated events (server push → MST upsert → SSE → Panel auto-updates)
  backendSubscription.subscribeToShopUpdated((shopData) => {
    const shopId = (shopData as any).id as string;
    rootStore.ingestGraphQLResponse({ shopUpdated: shopData });
    const shop = rootStore.shops.find((s: any) => s.id === shopId);
    broadcastEvent("shop-updated", { shopId, shopName: shop?.shopName ?? shopId });
  });

  // Subscribe to cloud CS escalation side-effect events. Backend persistence
  // owns the workflow; desktop claims, executes the local action, then acks.
  backendSubscription.subscribeToCsEscalationEvents((event) => {
    void handleCsEscalationEvent(authSession, deviceId, event);
  });

  return { authSession, backendSubscription };
}
