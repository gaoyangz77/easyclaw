import { applySnapshot, applyPatch, flow, getEnv, types, type Instance, type IJsonPatch } from "mobx-state-tree";
import { RootStoreModel } from "@rivonclaw/core/models";
import {
  UserModel,
  SurfaceModel,
  RunProfileModel,
  ShopModel,
  ProviderKeyModel,
  ServiceCreditModel,
  LLMProviderModel,
  ChannelAccountModel,
  ChannelManagerModel,
  MobilePairingModel,
  MobileManagerModel,
} from "./models/index.js";
import { CREATE_SURFACE_MUTATION } from "../api/surfaces-queries.js";
import { CREATE_RUN_PROFILE_MUTATION } from "../api/run-profiles-queries.js";
import {
  SHOPS_QUERY,
  SHOP_QUERY,
  PLATFORM_APPS_QUERY,
  MY_CREDITS_QUERY,
  INITIATE_TIKTOK_OAUTH_MUTATION,
  CS_GET_PRESET_SKILLS_QUERY,
} from "../api/shops-queries.js";
import { GENERATE_PAIRING_CODE, WAIT_FOR_PAIRING, GET_INSTALL_URL } from "../api/pairing-queries.js";
import { SURFACES_QUERY } from "../api/surfaces-queries.js";
import { RUN_PROFILES_QUERY } from "../api/run-profiles-queries.js";
import {
  SUBSCRIPTION_STATUS_QUERY,
  LLM_QUOTA_STATUS_QUERY,
} from "../api/auth-queries.js";
import {
  BROWSER_PROFILES_QUERY,
  CREATE_BROWSER_PROFILE_MUTATION,
  UPDATE_BROWSER_PROFILE_MUTATION,
  DELETE_BROWSER_PROFILE_MUTATION,
  BATCH_ARCHIVE_BROWSER_PROFILES_MUTATION,
  BATCH_DELETE_BROWSER_PROFILES_MUTATION,
} from "../api/browser-profiles-queries.js";
import { fetchJson, fetchVoid, invalidateCache } from "../api/client.js";
import { trackEvent } from "../api/settings.js";
import type { BrowserProfileProxyTestResult, GQL, ProviderKeyEntry, ProviderKeyAuthType } from "@rivonclaw/core";
import { API, clientPath } from "@rivonclaw/core/api-contract";
import { panelEventBus } from "../lib/event-bus.js";
import { gql } from "@apollo/client/core";
import type { PanelStoreEnv } from "./types.js";

/**
 * ToolSpecs query — fires through Desktop proxy which ingests the response
 * into the MST store. Panel receives updates via SSE patches.
 */
const TOOL_SPECS_SYNC_QUERY = gql`
  query ToolSpecsSync {
    toolSpecs {
      id name category displayName description supportsPersistResult resultSchema surfaces runProfiles
      graphqlOperation operationType
      parameters { name type description graphqlVar required defaultValue enumValues isList children { name type description graphqlVar required defaultValue enumValues isList children { name type description graphqlVar required defaultValue enumValues isList } } }
      contextBindings { paramName contextField }
      restMethod restEndpoint restContentType supportedPlatforms prune
    }
  }
`;

/**
 * Panel-specific extension of RootStoreModel with CRUD mutation actions,
 * auth/session management, module enrollment, and entity sync.
 * Mutations fire GraphQL via `getEnv(self).apolloClient`. The response flows
 * through Desktop proxy -> ingestGraphQLResponse -> MST -> SSE -> Panel auto-updates,
 * so we do NOT manually update the store here.
 *
 * Entity-level actions (update, delete) live on per-model files in ./models/.
 * RootStore retains session-level actions and create operations (where no instance exists yet).
 */
const PanelRootStoreModel = RootStoreModel.props({
  currentUser: types.maybeNull(UserModel),
  surfaces: types.optional(types.array(SurfaceModel), []),
  runProfiles: types.optional(types.array(RunProfileModel), []),
  shops: types.optional(types.array(ShopModel), []),
  providerKeys: types.optional(types.array(ProviderKeyModel), []),
  credits: types.optional(types.array(ServiceCreditModel), []),
  channelAccounts: types.optional(types.array(ChannelAccountModel), []),
  mobilePairings: types.optional(types.array(MobilePairingModel), []),
  llmManager: types.optional(LLMProviderModel, {}),
  channelManager: types.optional(ChannelManagerModel, {}),
  mobileManager: types.optional(MobileManagerModel, {}),
}).actions((self) => {
  const client = () => getEnv<PanelStoreEnv>(self).apolloClient;

  return {
    // ── Auth actions ──

    /** Initialize the session: check Desktop auth state, validate via ME query if needed, trigger entity sync. */
    initSession: flow(function* () {
      try {
        const session: { authenticated: boolean; tokenPresent?: boolean } = yield fetchJson(clientPath(API["auth.session"]));
        if (session.authenticated || session.tokenPresent) {
          yield Promise.all([
            client().query({ query: SUBSCRIPTION_STATUS_QUERY, fetchPolicy: "network-only" }),
            client().query({ query: LLM_QUOTA_STATUS_QUERY, fetchPolicy: "network-only" }),
          ]).catch(() => {});
          if ((self as any).currentUser?.enrolledModules?.includes("GLOBAL_ECOMMERCE_SELLER")) {
            yield Promise.all([
              client().query({ query: SHOPS_QUERY, fetchPolicy: "network-only" }),
              client().query({ query: PLATFORM_APPS_QUERY, fetchPolicy: "network-only" }),
              client().query({ query: MY_CREDITS_QUERY, fetchPolicy: "network-only" }),
            ]).catch(() => {});
          }
          return;
        }
      } catch {
        // Desktop unreachable
      }
    }),

    login: flow(function* (input: { email: string; password: string; captchaToken?: string; captchaAnswer?: string }) {
      yield fetchJson(clientPath(API["auth.login"]), {
        method: "POST",
        body: JSON.stringify(input),
      });
      trackEvent("auth.login");
    }),

    register: flow(function* (input: { email: string; password: string; name?: string | null; captchaToken?: string; captchaAnswer?: string }) {
      yield fetchJson(clientPath(API["auth.register"]), {
        method: "POST",
        body: JSON.stringify(input),
      });
      trackEvent("auth.register");
    }),

    logout: flow(function* () {
      yield fetch(API["auth.logout"].path, { method: "POST" }).catch(() => {});
      trackEvent("auth.logout");
      // Desktop clears user in MST -> SSE -> Panel auto-updates
    }),

    clearAuth() {
      // Called when auth-expired event fires (401 from API)
      // Desktop will have already cleared the user via SSE, but clear locally for safety
      (self as any).currentUser = null;
    },

    // ── Provider key mutations (REST to Desktop) ──

    createProviderKey: flow(function* (data: {
      provider: string;
      label: string;
      model: string;
      apiKey?: string;
      proxyUrl?: string;
      authType?: ProviderKeyAuthType;
      baseUrl?: string;
      customProtocol?: "openai" | "anthropic";
      customModelsJson?: string;
      inputModalities?: string[];
    }): Generator<Promise<ProviderKeyEntry>, ProviderKeyEntry, ProviderKeyEntry> {
      const result: ProviderKeyEntry = yield fetchJson<ProviderKeyEntry>(clientPath(API["providerKeys.create"]), {
        method: "POST",
        body: JSON.stringify(data),
      });
      invalidateCache("models");
      return result;
    }),

    // ── OAuth flow mutations (REST to Desktop) ──

    startOAuthFlow: flow(function* (provider: string) {
      const result: { ok: boolean; email?: string; tokenPreview?: string; providerKeyId?: string; provider?: string; manualMode?: boolean; authUrl?: string; flowId?: string } =
        yield fetchJson<{ ok: boolean; email?: string; tokenPreview?: string; providerKeyId?: string; provider?: string; manualMode?: boolean; authUrl?: string; flowId?: string }>(
          clientPath(API["oauth.start"]),
          { method: "POST", body: JSON.stringify({ provider }) },
        );
      return result;
    }),

    completeManualOAuth: flow(function* (provider: string, callbackUrl: string) {
      const result: { email?: string; tokenPreview?: string } =
        yield fetchJson<{ email?: string; tokenPreview?: string }>(clientPath(API["oauth.manualComplete"]), {
          method: "POST",
          body: JSON.stringify({ provider, callbackUrl }),
        });
      return result;
    }),

    pollOAuthStatus: flow(function* (flowId: string) {
      const result: { status: "pending" | "completed" | "failed"; tokenPreview?: string; email?: string; error?: string } =
        yield fetchJson<{ status: "pending" | "completed" | "failed"; tokenPreview?: string; email?: string; error?: string }>(
          clientPath(API["oauth.status"]) + `?flowId=${encodeURIComponent(flowId)}`,
          { method: "GET" },
        );
      return result;
    }),

    saveOAuthFlow: flow(function* (
      provider: string,
      options: { proxyUrl?: string; label?: string; model?: string },
    ) {
      const result: { providerKeyId: string; email?: string; provider: string } =
        yield fetchJson<{ ok: boolean; providerKeyId: string; email?: string; provider: string }>(
          clientPath(API["oauth.save"]),
          { method: "POST", body: JSON.stringify({ provider, ...options }) },
        );
      invalidateCache("models");
      return result;
    }),

    // ── Shops / ecommerce mutations ──

    initiateTikTokOAuth: flow(function* (platformAppId: string) {
      const result = yield client().mutate({
        mutation: INITIATE_TIKTOK_OAUTH_MUTATION,
        variables: { platformAppId },
      });
      return result.data!.initiateTikTokOAuth as { authUrl: string; state: string };
    }),

    /** Fire shops query to populate MST via Desktop proxy. */
    fetchShops: flow(function* () {
      yield client().query({ query: SHOPS_QUERY, fetchPolicy: "network-only" });
    }),

    /** Fire single shop query to refresh one shop via Desktop proxy. */
    fetchShop: flow(function* (shopId: string) {
      yield client().query({ query: SHOP_QUERY, variables: { id: shopId }, fetchPolicy: "network-only" });
    }),

    /** Fire platform apps query to populate MST via Desktop proxy. */
    fetchPlatformApps: flow(function* () {
      yield client().query({ query: PLATFORM_APPS_QUERY, fetchPolicy: "network-only" });
    }),

    /** Fire credits query to populate MST via Desktop proxy. */
    fetchCredits: flow(function* () {
      yield client().query({ query: MY_CREDITS_QUERY, fetchPolicy: "network-only" });
    }),

    // ── Tool specs refresh ──

    /** Re-fetch toolSpecs from backend via Desktop proxy. */
    refreshToolSpecs: flow(function* () {
      yield client().query({ query: TOOL_SPECS_SYNC_QUERY, fetchPolicy: "network-only" });
    }),

    /**
     * Re-fetch subscription + LLM quota from backend via Desktop proxy.
     * Quota changes whenever the user makes LLM calls, so Panel surfaces
     * that display it (e.g. Account page) should call this on mount and on
     * window visibility changes to keep the user-visible numbers fresh.
     */
    refreshBilling: flow(function* () {
      yield Promise.all([
        client().query({ query: SUBSCRIPTION_STATUS_QUERY, fetchPolicy: "network-only" }),
        client().query({ query: LLM_QUOTA_STATUS_QUERY, fetchPolicy: "network-only" }),
      ]);
    }),

    // ── Surface mutations ──

    createSurface: flow(function* (input: {
      name: string;
      description?: string;
      allowedToolIds: string[];
    }) {
      const result = yield client().mutate({
        mutation: CREATE_SURFACE_MUTATION,
        variables: { input },
      });
      return result.data!.createSurface;
    }),

    // ── RunProfile mutations ──

    createRunProfile: flow(function* (input: {
      name: string;
      selectedToolIds: string[];
      surfaceId: string;
    }) {
      const result = yield client().mutate({
        mutation: CREATE_RUN_PROFILE_MUTATION,
        variables: { input },
      });
      return result.data!.createRunProfile;
    }),

    // ── CS preset skills ──

    /** Fetch all CS preset skills from backend. Returns { key: content } map or null. */
    fetchCsPresetSkills: flow(function* () {
      const result = yield client().query({
        query: CS_GET_PRESET_SKILLS_QUERY,
        fetchPolicy: "network-only",
      });
      const raw = result.data?.csGetPresetSkills as string | null;
      if (!raw) return null;
      return JSON.parse(raw) as Record<string, string>;
    }),

    // ── Mobile pairing mutations (temporary data, not stored in MST) ──

    generateMobilePairingCode: flow(function* (desktopDeviceId: string) {
      const result = yield client().mutate({
        mutation: GENERATE_PAIRING_CODE,
        variables: { desktopDeviceId },
      });
      const data = result.data?.generatePairingCode;
      return { code: data?.code, qrUrl: data?.qrUrl } as { code?: string; qrUrl?: string };
    }),

    waitForPairing: flow(function* (code: string) {
      const result = yield client().query({
        query: WAIT_FOR_PAIRING,
        variables: { code },
        fetchPolicy: "network-only",
      });
      return (result.data?.waitForPairing ?? { paired: false }) as {
        paired: boolean;
        pairingId?: string;
        accessToken?: string;
        relayUrl?: string;
        desktopDeviceId?: string;
        mobileDeviceId?: string;
        reason?: string;
      };
    }),

    getInstallUrl: flow(function* () {
      const result = yield client().query({
        query: GET_INSTALL_URL,
        fetchPolicy: "network-only",
      });
      return { installUrl: result.data?.mobileInstallUrl } as { installUrl?: string };
    }),

    registerMobilePairing: flow(function* (body: {
      pairingId?: string;
      desktopDeviceId: string;
      accessToken: string;
      relayUrl: string;
      mobileDeviceId?: string;
    }) {
      const response: { data?: { registerPairing: { success: boolean; pairingId: string } } | null; errors?: Array<{ message: string }> } =
        yield fetchJson(clientPath(API["mobile.graphql"]), {
          method: "POST",
          body: JSON.stringify({
            query: `mutation RegisterPairing($input: RegisterPairingInput!) {
              registerPairing(input: $input) {
                success
                pairingId
              }
            }`,
            variables: { input: body },
          }),
        });
      if (response.errors?.length) {
        return { error: response.errors[0]!.message } as { success?: boolean; error?: string };
      }
      return { success: response.data?.registerPairing?.success } as { success?: boolean; error?: string };
    }),

    // ── Browser profile operations (cloud-only, not in Desktop MST) ──

    fetchBrowserProfiles: flow(function* (
      filter?: { status?: string[]; tags?: string[]; query?: string },
      pagination?: { offset?: number; limit?: number },
    ) {
      const result = yield client().query<{ browserProfiles: GQL.PaginatedBrowserProfiles }>({
        query: BROWSER_PROFILES_QUERY,
        variables: { filter, pagination },
        fetchPolicy: "network-only",
      });
      if (!result.data) {
        throw new Error("No data returned from browserProfiles query");
      }
      return result.data.browserProfiles as GQL.PaginatedBrowserProfiles;
    }),

    createBrowserProfile: flow(function* (input: {
      name: string;
      proxyEnabled?: boolean;
      proxyBaseUrl?: string | null;
      tags?: string[];
      notes?: string | null;
      sessionStatePolicy?: {
        enabled?: boolean;
        checkpointIntervalSec?: number;
        mode?: string;
        storage?: string;
      };
    }) {
      const result = yield client().mutate<{ createBrowserProfile: GQL.BrowserProfile }>({
        mutation: CREATE_BROWSER_PROFILE_MUTATION,
        variables: { input },
      });
      if (!result.data?.createBrowserProfile) {
        throw new Error("No data returned from createBrowserProfile mutation");
      }
      return result.data.createBrowserProfile as GQL.BrowserProfile;
    }),

    updateBrowserProfile: flow(function* (
      id: string,
      input: {
        name?: string;
        proxyEnabled?: boolean;
        proxyBaseUrl?: string | null;
        tags?: string[];
        notes?: string | null;
        status?: string;
        sessionStatePolicy?: {
          enabled?: boolean;
          checkpointIntervalSec?: number;
          mode?: string;
          storage?: string;
        };
      },
    ) {
      const result = yield client().mutate<{ updateBrowserProfile: GQL.BrowserProfile }>({
        mutation: UPDATE_BROWSER_PROFILE_MUTATION,
        variables: { id, input },
      });
      if (!result.data?.updateBrowserProfile) {
        throw new Error("No data returned from updateBrowserProfile mutation");
      }
      return result.data.updateBrowserProfile as GQL.BrowserProfile;
    }),

    deleteBrowserProfile: flow(function* (id: string) {
      yield client().mutate<{ deleteBrowserProfile: boolean }>({
        mutation: DELETE_BROWSER_PROFILE_MUTATION,
        variables: { id },
      });

      // Fire-and-forget: clean up local Chrome profile directory
      fetchVoid(clientPath(API["browserProfiles.deleteData"], { id }), { method: "DELETE" });
    }),

    batchArchiveBrowserProfiles: flow(function* (ids: string[]) {
      const result = yield client().mutate<{ batchArchiveBrowserProfiles: number }>({
        mutation: BATCH_ARCHIVE_BROWSER_PROFILES_MUTATION,
        variables: { ids },
      });
      if (result.data?.batchArchiveBrowserProfiles == null) {
        throw new Error("No data returned from batchArchiveBrowserProfiles mutation");
      }
      return result.data.batchArchiveBrowserProfiles as number;
    }),

    batchDeleteBrowserProfiles: flow(function* (ids: string[]) {
      const result = yield client().mutate<{ batchDeleteBrowserProfiles: number }>({
        mutation: BATCH_DELETE_BROWSER_PROFILES_MUTATION,
        variables: { ids },
      });
      if (result.data?.batchDeleteBrowserProfiles == null) {
        throw new Error("No data returned from batchDeleteBrowserProfiles mutation");
      }
      return result.data.batchDeleteBrowserProfiles as number;
    }),

    testBrowserProfileProxy: flow(function* (id: string) {
      const result: BrowserProfileProxyTestResult =
        yield fetchJson<BrowserProfileProxyTestResult>(clientPath(API["browserProfiles.testProxy"]), {
          method: "POST",
          body: JSON.stringify({ id }),
        });
      return result;
    }),

  };
});

// MST's .props() override doesn't propagate to Instance<> type inference.
// Explicitly declare Panel-extended entity types so pages see the actions.
interface PanelEntityOverrides {
  readonly currentUser: Instance<typeof UserModel> | null;
  readonly surfaces: Instance<typeof SurfaceModel>[];
  readonly runProfiles: Instance<typeof RunProfileModel>[];
  readonly shops: Instance<typeof ShopModel>[];
  readonly providerKeys: Instance<typeof ProviderKeyModel>[];
  readonly credits: Instance<typeof ServiceCreditModel>[];
  readonly channelAccounts: Instance<typeof ChannelAccountModel>[];
  readonly mobilePairings: Instance<typeof MobilePairingModel>[];
  readonly channelManager: Instance<typeof ChannelManagerModel>;
  readonly llmManager: Instance<typeof LLMProviderModel>;
  readonly mobileManager: Instance<typeof MobileManagerModel>;
}
export type PanelRootStore = Omit<Instance<typeof PanelRootStoreModel>, keyof PanelEntityOverrides> & PanelEntityOverrides;

// Use a lazy getter so apolloClient is resolved at call time, not import time.
// getClient() throws if called before createApolloClient(), so we must defer.
import { getClient } from "../api/apollo-client.js";

export const entityStore = PanelRootStoreModel.create(
  {},
  {
    get apolloClient() {
      return getClient();
    },
  },
) as unknown as PanelRootStore;

let unsubscribeSnapshot: (() => void) | null = null;
let unsubscribePatch: (() => void) | null = null;

/**
 * Subscribe to Desktop's unified event stream and sync store state.
 * Safe to call multiple times -- re-subscribes if already connected.
 *
 * On every (re)connect of the underlying shared EventSource, Desktop
 * re-emits `entity-snapshot` so the store self-heals without client logic.
 */
export function connectEntityStore(): void {
  disconnectEntityStore();

  unsubscribeSnapshot = panelEventBus.subscribe("entity-snapshot", (data) => {
    applySnapshot(entityStore, data as Parameters<typeof applySnapshot>[1]);
  });

  unsubscribePatch = panelEventBus.subscribe("entity-patch", (data) => {
    applyPatch(entityStore, data as IJsonPatch[]);
  });
}

/**
 * Unsubscribe from the shared event stream. Call on logout or unmount.
 * Does NOT close the underlying EventSource — other subscribers may
 * still need it (this is the point of the consolidation).
 */
export function disconnectEntityStore(): void {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }
  if (unsubscribePatch) {
    unsubscribePatch();
    unsubscribePatch = null;
  }
}
