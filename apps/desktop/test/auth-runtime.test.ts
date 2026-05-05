import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSyncCloudProviderKey,
  mockSetAuthSession,
  mockBroadcastEvent,
  mockRootStore,
  authState,
  backendState,
} = vi.hoisted(() => ({
  mockSyncCloudProviderKey: vi.fn(),
  mockSetAuthSession: vi.fn(),
  mockBroadcastEvent: vi.fn(),
  mockRootStore: {
    ingestGraphQLResponse: vi.fn(),
    shops: [],
  },
  authState: {
    token: "token-1" as string | null,
    listeners: [] as Array<(user: any) => void | Promise<void>>,
  },
  backendState: {
    connected: false,
    connect: vi.fn(),
    enableAuthenticatedSubscriptions: vi.fn(),
    disableAuthenticatedSubscriptions: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock("../src/providers/cloud-provider-sync.js", () => ({
  syncCloudProviderKey: mockSyncCloudProviderKey,
}));

vi.mock("../src/auth/session-ref.js", () => ({
  setAuthSession: mockSetAuthSession,
}));

vi.mock("../src/app/store/desktop-store.js", () => ({
  rootStore: mockRootStore,
}));

vi.mock("../src/auth/session.js", () => ({
  AuthSessionManager: class MockAuthSessionManager {
    onUserChanged(listener: (user: any) => void | Promise<void>) {
      authState.listeners.push(listener);
    }
    async loadFromKeychain() {}
    getAccessToken() {
      return authState.token;
    }
  },
}));

vi.mock("../src/cloud/backend-subscription-client.js", () => ({
  BackendSubscriptionClient: class MockBackendSubscriptionClient {
    isConnected() {
      return backendState.connected;
    }
    connect() {
      backendState.connect();
      backendState.connected = true;
    }
    enableAuthenticatedSubscriptions() {
      backendState.enableAuthenticatedSubscriptions();
    }
    disableAuthenticatedSubscriptions() {
      backendState.disableAuthenticatedSubscriptions();
    }
    reconnect() {
      backendState.reconnect();
    }
    disconnect() {
      backendState.disconnect();
    }
    subscribeToOAuthComplete() {
      return () => {};
    }
    subscribeToShopUpdated() {
      return () => {};
    }
    subscribeToCsEscalationEvents() {
      return () => {};
    }
  },
}));

import { setupAuth } from "../src/app/auth-runtime.js";

async function emitUserChanged(user: any) {
  for (const listener of authState.listeners) {
    await listener(user);
  }
}

describe("setupAuth subscription lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.token = "token-1";
    authState.listeners.length = 0;
    backendState.connected = false;
  });

  it("enables authenticated subscriptions when validate hydrates the initial user", async () => {
    await setupAuth({
      storage: {} as any,
      secretStore: {} as any,
      locale: "en",
      deviceId: "device-1",
      proxyFetch: vi.fn() as any,
      broadcastEvent: mockBroadcastEvent as any,
    });

    backendState.connected = true;
    await emitUserChanged({ userId: "u1" });

    expect(backendState.enableAuthenticatedSubscriptions).toHaveBeenCalledTimes(1);
    expect(backendState.reconnect).not.toHaveBeenCalled();
    expect(backendState.disconnect).not.toHaveBeenCalled();
  });

  it("enables authenticated subscriptions when the authenticated token changes", async () => {
    await setupAuth({
      storage: {} as any,
      secretStore: {} as any,
      locale: "en",
      deviceId: "device-1",
      proxyFetch: vi.fn() as any,
      broadcastEvent: mockBroadcastEvent as any,
    });

    backendState.connected = true;
    authState.token = "token-2";
    await emitUserChanged({ userId: "u1" });

    expect(backendState.enableAuthenticatedSubscriptions).toHaveBeenCalledTimes(1);
    expect(backendState.disableAuthenticatedSubscriptions).not.toHaveBeenCalled();
  });

  it("disables authenticated subscriptions when the user logs out", async () => {
    await setupAuth({
      storage: {} as any,
      secretStore: {} as any,
      locale: "en",
      deviceId: "device-1",
      proxyFetch: vi.fn() as any,
      broadcastEvent: mockBroadcastEvent as any,
    });

    backendState.connected = true;
    authState.token = null;
    await emitUserChanged(null);

    expect(backendState.disableAuthenticatedSubscriptions).toHaveBeenCalledTimes(1);
    expect(backendState.enableAuthenticatedSubscriptions).not.toHaveBeenCalled();
  });

  it("enables authenticated subscriptions when a user logs in after startup", async () => {
    authState.token = null;
    await setupAuth({
      storage: {} as any,
      secretStore: {} as any,
      locale: "en",
      deviceId: "device-1",
      proxyFetch: vi.fn() as any,
      broadcastEvent: mockBroadcastEvent as any,
    });

    authState.token = "token-1";
    await emitUserChanged({ userId: "u1" });

    expect(backendState.enableAuthenticatedSubscriptions).toHaveBeenCalledTimes(1);
    expect(backendState.disableAuthenticatedSubscriptions).not.toHaveBeenCalled();
  });
});
