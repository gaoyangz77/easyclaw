/** Default port for the OpenClaw gateway (WebSocket + HTTP). */
export const DEFAULT_GATEWAY_PORT = 28789;

/** Offset added to the gateway port for Chrome DevTools Protocol. */
export const CDP_PORT_OFFSET = 12;

/** Default port for the desktop panel HTTP server. */
export const DEFAULT_PANEL_PORT = 3210;

/** Default port for the local proxy router. */
export const DEFAULT_PROXY_ROUTER_PORT = 9999;

/** Default port for the panel Vite dev server. */
export const DEFAULT_PANEL_DEV_PORT = 5180;

/** Resolve the gateway port, respecting EASYCLAW_GATEWAY_PORT env var. */
export function resolveGatewayPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const v = env.EASYCLAW_GATEWAY_PORT?.trim();
  return v ? Number(v) : DEFAULT_GATEWAY_PORT;
}

/** Resolve the panel server port, respecting EASYCLAW_PANEL_PORT env var. */
export function resolvePanelPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const v = env.EASYCLAW_PANEL_PORT?.trim();
  return v ? Number(v) : DEFAULT_PANEL_PORT;
}

/** Resolve the proxy router port, respecting EASYCLAW_PROXY_ROUTER_PORT env var. */
export function resolveProxyRouterPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const v = env.EASYCLAW_PROXY_ROUTER_PORT?.trim();
  return v ? Number(v) : DEFAULT_PROXY_ROUTER_PORT;
}
