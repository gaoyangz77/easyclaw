import { ApolloClient, InMemoryCache, createHttpLink, Observable } from "@apollo/client";
import { SetContextLink } from "@apollo/client/link/context";
import { ErrorLink } from "@apollo/client/link/error";
import { CombinedGraphQLErrors } from "@apollo/client/errors";
import { getGraphqlUrl } from "@rivonclaw/core";

let _loadingCallbacks: { start: () => void; stop: () => void } | null = null;

export function registerLoadingCallbacks(start: () => void, stop: () => void) {
  _loadingCallbacks = { start, stop };
}

export async function trackedQuery<T>(fn: () => Promise<T>): Promise<T> {
  _loadingCallbacks?.start();
  try {
    return await fn();
  } finally {
    _loadingCallbacks?.stop();
  }
}

let _client: ApolloClient | null = null;
let _getToken: (() => string | null) | null = null;
let _onTokenRefreshed: ((accessToken: string) => void) | null = null;
let _onRefreshFailed: (() => void) | null = null;

/** Register a token getter so the auth link can read the current token. */
export function setTokenGetter(getter: () => string | null) {
  _getToken = getter;
}

/** Register a callback invoked when tokens are refreshed successfully. */
export function setOnTokenRefreshed(cb: (accessToken: string) => void) {
  _onTokenRefreshed = cb;
}

/** Register a callback invoked when refresh fails (user should be logged out). */
export function setOnRefreshFailed(cb: () => void) {
  _onRefreshFailed = cb;
}

// Refresh queue: ensures only one refresh request is in-flight at a time.
// All concurrent auth-failed requests wait for the single refresh to complete.
let _refreshPromise: Promise<string> | null = null;

function doRefresh(): Promise<string> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    const res = await fetch("/api/auth/refresh", { method: "POST" });
    if (!res.ok) throw new Error("Token refresh failed");
    const data = (await res.json()) as { accessToken: string };
    _onTokenRefreshed?.(data.accessToken);
    return data.accessToken;
  })().finally(() => {
    _refreshPromise = null;
  });

  return _refreshPromise;
}

function isAuthError(message: string): boolean {
  return message.includes("Authentication required") || message.includes("jwt expired");
}

export function createApolloClient(lang: string) {
  const httpLink = createHttpLink({
    uri: getGraphqlUrl(lang),
  });

  const authLink = new SetContextLink(({ headers }) => {
    const token = _getToken?.();
    return {
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
  });

  const errorLink = new ErrorLink(({ error, operation, forward }) => {
    // Only handle CombinedGraphQLErrors (server-returned GraphQL errors)
    if (!CombinedGraphQLErrors.is(error)) return;

    const hasAuthError = error.errors.some((e) => isAuthError(e.message));
    if (!hasAuthError) return;

    // Skip refresh for the refresh mutation itself to avoid infinite loops
    if (operation.operationName === "RefreshToken") return;

    return new Observable((observer) => {
      doRefresh()
        .then((newAccessToken) => {
          // Update the failed operation's headers with the new token
          operation.setContext(({ headers = {} }: { headers?: Record<string, string> }) => ({
            headers: {
              ...headers,
              Authorization: `Bearer ${newAccessToken}`,
            },
          }));
          // Retry the operation
          forward(operation).subscribe(observer);
        })
        .catch(() => {
          _onRefreshFailed?.();
          observer.error(error);
        });
    });
  });

  _client = new ApolloClient({
    link: errorLink.concat(authLink).concat(httpLink),
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: "cache-and-network",
      },
    },
  });

  return _client;
}

/**
 * Return the Apollo Client instance created by ApolloWrapper.
 * Must be called after createApolloClient() has been invoked (i.e. after the React tree mounts).
 */
export function getClient(): ApolloClient {
  if (!_client) {
    throw new Error("Apollo client not initialised — getClient() called before createApolloClient()");
  }
  return _client;
}
