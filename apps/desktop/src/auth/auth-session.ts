import type { SecretStore } from "@rivonclaw/secrets";
import { getGraphqlUrl } from "@rivonclaw/core";

const ACCESS_TOKEN_KEY = "auth.accessToken";
const REFRESH_TOKEN_KEY = "auth.refreshToken";

// GraphQL operations (same as panel uses, but as raw strings)
const REFRESH_TOKEN_MUTATION = `mutation RefreshToken($refreshToken: String!) { refreshToken(refreshToken: $refreshToken) { accessToken refreshToken userId email plan } }`;
const ME_QUERY = `query Me { me { userId email name plan createdAt } }`;
const LOGOUT_MUTATION = `mutation Logout($refreshToken: String!) { logout(refreshToken: $refreshToken) }`;
const AVAILABLE_TOOLS_QUERY = `query { availableTools { id displayName description category allowed denialReason } }`;

export interface AvailableTool {
  id: string;
  displayName: string;
  description: string;
  category: string;
  allowed: boolean;
  denialReason?: string;
}

export interface AuthUser {
  userId: string;
  email: string;
  name: string | null;
  plan: string;
}

export class AuthSessionManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private cachedUser: AuthUser | null = null;
  private cachedAvailableTools: AvailableTool[] | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private secretStore: SecretStore,
    private locale: string,
    private fetchFn: (url: string | URL, init?: RequestInit) => Promise<Response>,
  ) {}

  /** Load tokens from keychain into memory. Call once at startup. */
  async loadFromKeychain(): Promise<void> {
    this.accessToken = await this.secretStore.get(ACCESS_TOKEN_KEY) ?? null;
    this.refreshToken = await this.secretStore.get(REFRESH_TOKEN_KEY) ?? null;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getCachedUser(): AuthUser | null {
    return this.cachedUser;
  }

  async storeTokens(accessToken: string, refreshToken: string): Promise<void> {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    await this.secretStore.set(ACCESS_TOKEN_KEY, accessToken);
    await this.secretStore.set(REFRESH_TOKEN_KEY, refreshToken);
  }

  async clearTokens(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    this.cachedUser = null;
    this.cachedAvailableTools = null;
    await this.secretStore.delete(ACCESS_TOKEN_KEY);
    await this.secretStore.delete(REFRESH_TOKEN_KEY);
  }

  /** Refresh the access token using the stored refresh token. Single-flight. */
  async refresh(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<string> {
    if (!this.refreshToken) {
      await this.clearTokens();
      throw new Error("No refresh token available");
    }

    const result = await this.graphqlFetch<{ refreshToken: { accessToken: string; refreshToken: string } }>(
      REFRESH_TOKEN_MUTATION,
      { refreshToken: this.refreshToken },
    );

    const payload = result.refreshToken;
    await this.storeTokens(payload.accessToken, payload.refreshToken);
    return payload.accessToken;
  }

  /** Validate the current session by calling the ME query. */
  async validate(): Promise<AuthUser | null> {
    if (!this.accessToken) return null;

    try {
      const result = await this.graphqlFetch<{ me: AuthUser }>(ME_QUERY);
      this.cachedUser = result.me;
      return result.me;
    } catch {
      // Token invalid — clear it
      await this.clearTokens();
      return null;
    }
  }

  /** Best-effort cloud logout. */
  async logout(): Promise<void> {
    const rt = this.refreshToken;
    await this.clearTokens();
    if (rt) {
      try {
        await this.graphqlFetch(LOGOUT_MUTATION, { refreshToken: rt });
      } catch {
        // Best-effort — ignore failures
      }
    }
  }

  /** Fetch available tools from the cloud and cache the result. */
  async fetchAvailableTools(): Promise<AvailableTool[]> {
    const result = await this.graphqlFetch<{ availableTools: AvailableTool[] }>(AVAILABLE_TOOLS_QUERY);
    this.cachedAvailableTools = result.availableTools;
    return result.availableTools;
  }

  /** Return the cached available tools, or null if not yet fetched. */
  getCachedAvailableTools(): AvailableTool[] | null {
    return this.cachedAvailableTools;
  }

  /** Lightweight GraphQL fetch to the cloud backend. Public so config builder can use it. */
  async graphqlFetch<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const url = getGraphqlUrl(this.locale);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    let res = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401 && this.refreshToken) {
      const newToken = await this.refresh();
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await this.fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
    }

    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    if (!json.data) {
      throw new Error("No data returned from cloud GraphQL");
    }
    return json.data;
  }
}
