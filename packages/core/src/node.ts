// Node.js-specific entry point.
// Re-exports everything from the main entry plus path resolvers
// that depend on node:path and node:os.

export * from "./index.js";

export {
  resolveEasyClawHome,
  resolveDbPath,
  resolveLogDir,
  resolveSecretsDir,
  resolveOpenClawStateDir,
  resolveOpenClawConfigPath,
  resolveMediaDir,
  resolveCdpDataDir,
  resolveUpdateMarkerPath,
  resolveProxyRouterConfigPath,
  resolveUserSkillsDir,
} from "./paths.js";
