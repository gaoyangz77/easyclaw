/**
 * Configuration for the proxy router.
 * This file is written by EasyClaw desktop app and watched by the router.
 */
export interface ProxyRouterConfig {
  /** Timestamp of last update */
  ts: number;
  /** Domain to provider mapping (e.g., "api.openai.com" -> "openai") */
  domainToProvider: Record<string, string>;
  /** Provider to active key ID mapping */
  activeKeys: Record<string, string>;
  /** Key ID to proxy URL mapping (null = direct connection) */
  keyProxies: Record<string, string | null>;
  /** System-level proxy URL auto-detected from OS (e.g. "http://127.0.0.1:1087" or "socks5://127.0.0.1:1080"). */
  systemProxy?: string | null;
}

/**
 * Options for creating a proxy router.
 */
export interface ProxyRouterOptions {
  /** Port to listen on (default: DEFAULT_PROXY_ROUTER_PORT from @easyclaw/core) */
  port?: number;
  /** Path to the config file to watch */
  configPath: string;
  /** Callback when config is reloaded */
  onConfigReload?: (config: ProxyRouterConfig) => void;
}
