import type { GatewayRpcClient } from "@rivonclaw/gateway";
import { openClawConnector } from "../openclaw/index.js";

/**
 * Get the active RPC client via the OpenClawConnector.
 *
 * Returns null if the connector's RPC client is not connected.
 */
export function getRpcClient(): GatewayRpcClient | null {
  try {
    return openClawConnector.ensureRpcReady();
  } catch {
    return null;
  }
}
