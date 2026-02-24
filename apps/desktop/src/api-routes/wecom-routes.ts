import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import WebSocket from "ws";
import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody, proxiedFetch } from "./route-utils.js";

const log = createLogger("panel-server");

export const handleWecomRoutes: RouteHandler = async (req, res, _url, pathname, ctx) => {
  const { storage, secretStore, deviceId, getGatewayInfo, wecomRelay } = ctx;

  // --- WeCom Cloud Config (GraphQL proxy) ---
  if (pathname === "/api/wecom-config/save" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      corpId?: string;
      appSecret?: string;
      token?: string;
      encodingAesKey?: string;
      kfLinkId?: string;
      panelToken?: string;
      lang?: string;
    };
    const { corpId, appSecret, token: webhookToken, encodingAesKey, kfLinkId, panelToken, lang } = body;
    if (!corpId || !appSecret || !webhookToken || !encodingAesKey || !kfLinkId) {
      sendJson(res, 400, { error: "All 5 credential fields are required" });
      return true;
    }
    const authToken = panelToken || (await secretStore.get("cs-panel-token")) || "";
    if (!authToken) {
      sendJson(res, 400, { error: "Panel token is required. Please enter it in the configuration form." });
      return true;
    }
    if (panelToken) {
      await secretStore.set("cs-panel-token", panelToken);
    }
    const apiUrl = lang === "zh" ? "https://api-cn.easy-claw.com/graphql" : "https://api.easy-claw.com/graphql";
    try {
      const gqlRes = await proxiedFetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `mutation saveWeComConfig($input: WeComConfigInput!) {
            saveWeComConfig(input: $input) {
              wecom { corpId appSecret token encodingAesKey openKfId kfLinkId }
            }
          }`,
          variables: {
            input: { corpId, appSecret, token: webhookToken, encodingAesKey, kfLinkId },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!gqlRes.ok) {
        sendJson(res, 502, { error: `GraphQL API returned ${gqlRes.status}` });
        return true;
      }
      const json = (await gqlRes.json()) as { data?: { saveWeComConfig?: unknown }; errors?: Array<{ message: string }> };
      if (json.errors && json.errors.length > 0) {
        sendJson(res, 400, { error: json.errors[0].message });
        return true;
      }
      storage.settings.set("wecom-cloud-corp-id", corpId);
      sendJson(res, 200, json.data?.saveWeComConfig ?? { wecom: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: msg });
    }
    return true;
  }

  if (pathname === "/api/wecom-config/delete" && req.method === "POST") {
    const body = (await parseBody(req)) as { corpId?: string; panelToken?: string; lang?: string };
    const { corpId, panelToken, lang } = body;
    if (!corpId) {
      sendJson(res, 400, { error: "corpId is required for deletion" });
      return true;
    }
    const authToken = panelToken || (await secretStore.get("cs-panel-token")) || "";
    if (!authToken) {
      sendJson(res, 400, { error: "Panel token is required" });
      return true;
    }
    if (panelToken) {
      await secretStore.set("cs-panel-token", panelToken);
    }
    const apiUrl = lang === "zh" ? "https://api-cn.easy-claw.com/graphql" : "https://api.easy-claw.com/graphql";
    try {
      const gqlRes = await proxiedFetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `mutation deleteWeComConfig($corpId: String!) {
            deleteWeComConfig(corpId: $corpId) {
              wecom { corpId }
            }
          }`,
          variables: { corpId },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!gqlRes.ok) {
        sendJson(res, 502, { error: `GraphQL API returned ${gqlRes.status}` });
        return true;
      }
      const json = (await gqlRes.json()) as { data?: { deleteWeComConfig?: unknown }; errors?: Array<{ message: string }> };
      if (json.errors && json.errors.length > 0) {
        sendJson(res, 400, { error: json.errors[0].message });
        return true;
      }
      storage.settings.delete("wecom-cloud-corp-id");
      sendJson(res, 200, json.data?.deleteWeComConfig ?? { wecom: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: msg });
    }
    return true;
  }

  if (pathname === "/api/wecom-config/status" && req.method === "GET") {
    const hasToken = !!(await secretStore.get("cs-panel-token"));
    const savedCorpId = storage.settings.get("wecom-cloud-corp-id") as string | undefined;
    sendJson(res, 200, { hasToken, corpId: savedCorpId ?? null });
    return true;
  }

  // --- WeCom Channel ---
  if (pathname === "/api/channels/wecom/binding-status" && req.method === "GET") {
    const wState = wecomRelay!.getState();
    if (!wState) {
      sendJson(res, 200, { status: null });
      return true;
    }
    const relayConnected = wecomRelay!.getWs()?.readyState === WebSocket.OPEN;
    const gatewayConnected = wecomRelay!.getGatewayRpc()?.isConnected() ?? false;
    const { externalUserId, connected } = wState;
    const status = externalUserId
      ? "bound"
      : connected
        ? "active"
        : relayConnected
          ? "active"
          : "pending";
    sendJson(res, 200, {
      status,
      relayUrl: wState.relayUrl,
      externalUserId: externalUserId ?? null,
      connected: connected || relayConnected,
      bindingToken: wState.bindingToken ?? null,
      customerServiceUrl: wState.customerServiceUrl ?? null,
      relayConnected,
      gatewayConnected,
    });
    return true;
  }

  if (pathname === "/api/channels/wecom/bind" && req.method === "POST") {
    const body = (await parseBody(req)) as { relayUrl?: string; authToken?: string };
    const relayUrl = body.relayUrl?.trim();
    const authToken = body.authToken?.trim();

    if (!relayUrl || !authToken) {
      sendJson(res, 400, { error: "Missing relayUrl or authToken" });
      return true;
    }

    const gwId = deviceId ?? randomUUID();

    try {
      const result = await new Promise<{ token: string; customerServiceUrl: string }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Connection to relay timed out"));
        }, 15_000);

        const ws = new WebSocket(relayUrl);

        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "hello", gateway_id: gwId, auth_token: authToken }));
        });

        ws.on("message", (data: Buffer) => {
          try {
            const frame = JSON.parse(data.toString("utf-8"));
            if (frame.type === "ack" && frame.id === "hello") {
              ws.send(JSON.stringify({ type: "create_binding", gateway_id: gwId }));
            } else if (frame.type === "create_binding_ack") {
              clearTimeout(timeout);
              resolve({ token: frame.token, customerServiceUrl: frame.customer_service_url });
              ws.close();
            } else if (frame.type === "error") {
              clearTimeout(timeout);
              reject(new Error(frame.message ?? "Relay error"));
              ws.close();
            }
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
            ws.close();
          }
        });

        ws.on("error", (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });

        ws.on("close", () => {
          clearTimeout(timeout);
        });
      });

      wecomRelay!.setState({
        relayUrl,
        authToken,
        connected: false,
        bindingToken: result.token,
        customerServiceUrl: result.customerServiceUrl,
      });

      storage.settings.set("wecom-relay-url", relayUrl);
      await secretStore.set("wecom-auth-token", authToken);

      const gwInfo = getGatewayInfo?.();
      wecomRelay!.start({
        relayUrl,
        authToken,
        gatewayId: gwId,
        gatewayWsUrl: gwInfo?.wsUrl ?? "ws://127.0.0.1:28789",
        gatewayToken: gwInfo?.token,
      });

      sendJson(res, 200, {
        ok: true,
        bindingToken: result.token,
        customerServiceUrl: result.customerServiceUrl,
      });
    } catch (err) {
      log.error("WeCom bind failed:", err);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/channels/wecom/unbind" && req.method === "DELETE") {
    if (!wecomRelay!.getState()) {
      sendJson(res, 200, { ok: true });
      return true;
    }

    const unbindWs = wecomRelay!.getWs();
    const unbindParams = wecomRelay!.getConnParams();
    if (unbindWs && unbindWs.readyState === WebSocket.OPEN && unbindParams) {
      try {
        unbindWs.send(JSON.stringify({
          type: "unbind_all",
          gateway_id: unbindParams.gatewayId,
        }));
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        log.warn("WeCom unbind: failed to send unbind_all frame:", err);
      }
    }

    wecomRelay!.stop();
    wecomRelay!.setState(null);

    storage.settings.delete("wecom-relay-url");
    storage.settings.delete("wecom-external-user-id");
    await secretStore.delete("wecom-auth-token");

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
};
