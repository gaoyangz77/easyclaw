import type { SecretStore } from "@rivonclaw/secrets";
import { getGraphqlUrl, GQL } from "@rivonclaw/core";
import { createLogger } from "@rivonclaw/logger";

const log = createLogger("auth-session");

const ACCESS_TOKEN_KEY = "auth.accessToken";
const REFRESH_TOKEN_KEY = "auth.refreshToken";

// GraphQL operations (same as panel uses, but as raw strings)
const REFRESH_TOKEN_MUTATION = `mutation RefreshToken($refreshToken: String!) { refreshToken(refreshToken: $refreshToken) { accessToken refreshToken user { userId email name plan createdAt enrolledModules entitlementKeys llmKey { key suspendedUntil } } } }`;
const ME_QUERY = `query Me { me { userId email name plan createdAt enrolledModules entitlementKeys llmKey { key suspendedUntil } } }`;
const LOGOUT_MUTATION = `mutation Logout($refreshToken: String!) { logout(refreshToken: $refreshToken) }`;
const LOGIN_MUTATION = `mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken user { userId email name plan createdAt enrolledModules entitlementKeys defaultRunProfileId llmKey { key suspendedUntil } } } }`;
const REGISTER_MUTATION = `mutation Register($input: RegisterInput!) { register(input: $input) { accessToken refreshToken user { userId email name plan createdAt enrolledModules entitlementKeys defaultRunProfileId llmKey { key suspendedUntil } } } }`;
const REQUEST_CAPTCHA_MUTATION = `mutation RequestCaptcha { requestCaptcha { token svg } }`;
export type UserChangedListener = (user: GQL.MeResponse | null) => void | Promise<void>;

export class AuthSessionManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private cachedUser: GQL.MeResponse | null = null;
  private refreshPromise: Promise<string> | null = null;
  private userChangedListeners: UserChangedListener[] = [];

  constructor(
    private secretStore: SecretStore,
    private locale: string,
    private fetchFn: (url: string | URL, init?: RequestInit) => Promise<Response>,
  ) {}

  /** Register a listener that fires whenever the cached user changes. */
  onUserChanged(listener: UserChangedListener): void {
    this.userChangedListeners.push(listener);
  }

  private async setUser(user: GQL.MeResponse | null): Promise<void> {
    this.cachedUser = user;
    for (const listener of this.userChangedListeners) {
      try {
        await listener(user);
      } catch { /* listener errors must not break auth flow */ }
    }
  }

  /** Load tokens from keychain into memory. Call once at startup. */
  async loadFromKeychain(): Promise<void> {
    this.accessToken = await this.secretStore.get(ACCESS_TOKEN_KEY) ?? null;
    this.refreshToken = await this.secretStore.get(REFRESH_TOKEN_KEY) ?? null;
    log.info(`loadFromKeychain: access=${this.accessToken ? "found" : "missing"} refresh=${this.refreshToken ? "found" : "missing"}`);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getCachedUser(): GQL.MeResponse | null {
    return this.cachedUser;
  }

  /** Set the cached user directly (e.g. from JWT fallback when validate() fails). */
  setCachedUser(user: GQL.MeResponse): void {
    this.cachedUser = user;
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
    await this.setUser(null);
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

    const result = await this.graphqlFetch<{ refreshToken: { accessToken: string; refreshToken: string; user: GQL.MeResponse } }>(
      REFRESH_TOKEN_MUTATION,
      { refreshToken: this.refreshToken },
    );

    const payload = result.refreshToken;
    await this.storeTokens(payload.accessToken, payload.refreshToken);
    await this.setUser(payload.user);
    return payload.accessToken;
  }

  /** Validate the current session by calling the ME query. */
  async validate(): Promise<GQL.MeResponse | null> {
    if (!this.accessToken) return null;

    try {
      log.info("validate: sending ME_QUERY...");
      const result = await this.graphqlFetch<{ me: GQL.MeResponse }>(ME_QUERY);
      log.info(`validate: success, user=${result.me.email}`);
      await this.setUser(result.me);
      return result.me;
    } catch (err) {
      // Only clear tokens on auth errors (expired/revoked token that refresh also failed).
      // Network errors (timeout, DNS, server 500) should NOT clear tokens — the user
      // may simply be offline or the server temporarily unavailable.
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthError = msg.includes("Not authenticated") || msg.includes("Authentication required") || msg.includes("Invalid token") || msg.includes("Token expired");
      if (isAuthError) {
        log.error("validate: auth error, clearing tokens.", err);
        await this.clearTokens();
      } else {
        log.warn("validate: non-auth error, keeping tokens.", err);
      }
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

  /** Log in with email/password credentials. Desktop calls Cloud, stores tokens, returns user. */
  async loginWithCredentials(input: { email: string; password: string; captchaToken?: string; captchaAnswer?: string }): Promise<GQL.MeResponse> {
    const data = await this.graphqlFetch<{ login: GQL.AuthPayload }>(LOGIN_MUTATION, { input });
    await this.storeTokens(data.login.accessToken, data.login.refreshToken);
    await this.setUser(data.login.user);
    return data.login.user;
  }

  /** Register with email/password credentials. Desktop calls Cloud, stores tokens, returns user. */
  async registerWithCredentials(input: { email: string; password: string; name?: string; captchaToken?: string; captchaAnswer?: string }): Promise<GQL.MeResponse> {
    const data = await this.graphqlFetch<{ register: GQL.AuthPayload }>(REGISTER_MUTATION, { input });
    await this.storeTokens(data.register.accessToken, data.register.refreshToken);
    await this.setUser(data.register.user);
    return data.register.user;
  }

  /** Request a CAPTCHA challenge from the Cloud. */
  async requestCaptcha(): Promise<{ token: string; svg: string }> {
    const data = await this.graphqlFetch<{ requestCaptcha: { token: string; svg: string } }>(REQUEST_CAPTCHA_MUTATION);
    return data.requestCaptcha;
  }

  /** Lightweight GraphQL fetch to the cloud backend. Public so config builder can use it. */
  async graphqlFetch<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const url = getGraphqlUrl(this.locale);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const doFetch = () => this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    let res = await doFetch();

    let refreshed = false;
    if (res.status === 401 && this.refreshToken) {
      headers["Authorization"] = `Bearer ${await this.refresh()}`;
      refreshed = true;
      res = await doFetch();
    }

    let json = await res.json() as { data?: T; errors?: Array<{ message: string }> };

    // Some servers return auth errors as GraphQL errors (HTTP 200) rather than HTTP 401.
    // Attempt a token refresh if we haven't already.
    if (json.errors?.length && !refreshed && this.refreshToken) {
      const msg = json.errors.map(e => e.message).join("; ");
      if (/Not authenticated|Authentication required|Invalid token|Token expired/.test(msg)) {
        headers["Authorization"] = `Bearer ${await this.refresh()}`;
        res = await doFetch();
        json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
      }
    }

    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    if (!json.data) {
      throw new Error("No data returned from cloud GraphQL");
    }
    return json.data;
  }
}
