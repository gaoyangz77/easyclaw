import upstreamPlugin from "@tencent-weixin/openclaw-weixin/index.ts";

// Module-level sessionKey bridge: OpenClaw's web.login.wait gateway handler
// only forwards { timeoutMs, accountId } to the plugin, dropping sessionKey.
// We capture it from loginWithQrStart and inject it into loginWithQrWait.
let lastSessionKey = "";

const plugin = {
  ...upstreamPlugin,
  register(api: Parameters<typeof upstreamPlugin.register>[0]) {
    const origRegisterChannel = api.registerChannel!.bind(api);
    api.registerChannel = (opts: { plugin: { gatewayMethods?: string[]; gateway?: Record<string, unknown>;[k: string]: unknown };[k: string]: unknown }) => {
      // Patch 1: declare gatewayMethods so resolveWebLoginProvider() can discover us.
      if (opts.plugin && !opts.plugin.gatewayMethods) {
        opts.plugin.gatewayMethods = ["web.login.start", "web.login.wait"];
      }

      // Patch 2: bridge sessionKey between loginWithQrStart and loginWithQrWait.
      const gw = opts.plugin.gateway as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
      if (gw) {
        const origStart = gw.loginWithQrStart;
        const origWait = gw.loginWithQrWait;

        if (origStart) {
          gw.loginWithQrStart = async (params: unknown) => {
            const result = await origStart(params) as Record<string, unknown>;
            if (typeof result.sessionKey === "string") {
              lastSessionKey = result.sessionKey;
            }
            return result;
          };
        }

        if (origWait) {
          gw.loginWithQrWait = async (params: unknown) => {
            const p = params as Record<string, unknown>;
            if (!p.sessionKey && lastSessionKey) {
              p.sessionKey = lastSessionKey;
            }
            return origWait(p);
          };
        }
      }

      return origRegisterChannel(opts);
    };
    upstreamPlugin.register(api);
  },
};

export default plugin;
