export { MobileSyncEngine } from "./sync-engine.js";
export { RelayTransport } from "./relay-transport.js";
// Relay payload limits — keep in sync with packages/core/src/relay.ts.
// Defined locally so the bundled dist has zero @easyclaw/* external imports
// (node_modules is stripped from extensions/ in packaged Electron builds).
export const RELAY_MAX_CLIENT_BYTES = 14 * 1024 * 1024; // 14 MB
export const RELAY_MAX_CLIENT_MB = Math.floor(RELAY_MAX_CLIENT_BYTES / (1024 * 1024)); // 14
export const RELAY_MAX_PAYLOAD_BYTES = Math.ceil(RELAY_MAX_CLIENT_BYTES * 1.34 + 1024 * 1024); // ~19.8 MB
