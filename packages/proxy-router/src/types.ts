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
}

/**
 * Options for creating a proxy router.
 */
export interface ProxyRouterOptions {
  /** Port to listen on (default: 9999) */
  port?: number;
  /** Path to the config file to watch */
  configPath: string;
  /** Callback when config is reloaded */
  onConfigReload?: (config: ProxyRouterConfig) => void;
}
