/**
 * Proxy URL utilities for parsing and reconstructing proxy configurations.
 *
 * Implements "smart split" security model:
 * - Base URL (protocol + host + path) → stored in SQLite (non-sensitive)
 * - Credentials (username:password) → stored in Keychain/DPAPI (sensitive)
 */

export interface ProxyConfig {
  /** Base URL without credentials (stored in SQLite) */
  baseUrl: string;
  /** Credentials in format "username:password" (stored in Keychain), null if no auth */
  credentials: string | null;
  /** Whether this proxy URL contains authentication */
  hasAuth: boolean;
}

/**
 * Parse a proxy URL and extract base URL + credentials separately.
 *
 * @param proxyUrl - Full proxy URL (e.g., "http://user:pass@proxy.com:8080")
 * @returns ProxyConfig with base URL and credentials split
 *
 * @example
 * parseProxyUrl("http://user:pass@proxy.com:8080")
 * // Returns: { baseUrl: "http://proxy.com:8080", credentials: "user:pass", hasAuth: true }
 *
 * parseProxyUrl("http://proxy.com:8080")
 * // Returns: { baseUrl: "http://proxy.com:8080", credentials: null, hasAuth: false }
 */
export function parseProxyUrl(proxyUrl: string): ProxyConfig {
  try {
    const url = new URL(proxyUrl);
    const hasAuth = Boolean(url.username || url.password);

    if (hasAuth) {
      // Extract credentials
      const credentials = `${url.username}:${url.password}`;

      // Build base URL without credentials
      const baseUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;

      return { baseUrl, credentials, hasAuth: true };
    } else {
      // No credentials, return full URL as base
      return { baseUrl: proxyUrl, credentials: null, hasAuth: false };
    }
  } catch (error) {
    throw new Error(`Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Reconstruct a full proxy URL from base URL and credentials.
 *
 * @param baseUrl - Base URL without credentials (e.g., "http://proxy.com:8080")
 * @param credentials - Credentials in "username:password" format, or null
 * @returns Full proxy URL with credentials embedded
 *
 * @example
 * reconstructProxyUrl("http://proxy.com:8080", "user:pass")
 * // Returns: "http://user:pass@proxy.com:8080"
 *
 * reconstructProxyUrl("http://proxy.com:8080", null)
 * // Returns: "http://proxy.com:8080"
 */
export function reconstructProxyUrl(baseUrl: string, credentials: string | null): string {
  if (!credentials) {
    return baseUrl;
  }

  try {
    const url = new URL(baseUrl);
    const [username, password] = credentials.split(":", 2);

    if (username) url.username = username;
    if (password) url.password = password;

    return url.toString();
  } catch (error) {
    throw new Error(`Invalid base URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate that a string is a valid proxy URL.
 * Supports http://, https://, and socks5:// protocols.
 *
 * @param proxyUrl - Proxy URL to validate
 * @returns true if valid, false otherwise
 */
export function isValidProxyUrl(proxyUrl: string): boolean {
  try {
    const url = new URL(proxyUrl);
    const validProtocols = ["http:", "https:", "socks5:"];
    return validProtocols.includes(url.protocol);
  } catch {
    return false;
  }
}
