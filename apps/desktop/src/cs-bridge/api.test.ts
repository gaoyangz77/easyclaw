import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiContext } from "../app/api-context.js";
import { RouteRegistry } from "../infra/api/route-registry.js";
import { registerCsBridgeHandlers } from "./api.js";

const bridgeState = vi.hoisted(() => ({
  bridge: {
    getOrCreateSession: vi.fn(),
  },
}));

vi.mock("../gateway/connection.js", () => ({
  getCsBridge: () => bridgeState.bridge,
}));

let registry: RouteRegistry;

beforeEach(() => {
  registry = new RouteRegistry();
  registerCsBridgeHandlers(registry);
  bridgeState.bridge.getOrCreateSession.mockReset();
});

async function dispatch(method: string, path: string, body?: unknown) {
  const req = makeReq(method, body);
  const res = makeRes();
  const url = new URL(`http://localhost${path}`);
  const handled = await registry.dispatch(req, res, url, path, {} as ApiContext);
  return { handled, res };
}

function makeReq(method: string, body?: unknown): IncomingMessage {
  const readable = new Readable({ read() {} });
  if (body !== undefined) readable.push(JSON.stringify(body));
  readable.push(null);
  (readable as any).method = method;
  (readable as any).headers = {};
  return readable as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: null as unknown,
    writeHead(status: number) {
      res._status = status;
      return res;
    },
    end(data?: string) {
      if (data) res._body = JSON.parse(data);
    },
  } as unknown as ServerResponse & { _status: number; _body: unknown };
  return res;
}

describe("POST /api/cs-bridge/start-conversation", () => {
  it("starts a session without requiring buyerUserId", async () => {
    const dispatchCatchUp = vi.fn().mockResolvedValue({ ok: true });
    bridgeState.bridge.getOrCreateSession.mockResolvedValue({ dispatchCatchUp });

    const { handled, res } = await dispatch("POST", "/api/cs-bridge/start-conversation", {
      shopId: "shop-1",
      conversationId: "conv-1",
      orderId: "order-1",
    });

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(bridgeState.bridge.getOrCreateSession).toHaveBeenCalledWith("shop-1", {
      conversationId: "conv-1",
      buyerUserId: undefined,
      orderId: "order-1",
    });
    expect(dispatchCatchUp).toHaveBeenCalledWith({ operatorInstruction: undefined });
  });

  it("still accepts buyerUserId when it is provided", async () => {
    const dispatchCatchUp = vi.fn().mockResolvedValue({ ok: true });
    bridgeState.bridge.getOrCreateSession.mockResolvedValue({ dispatchCatchUp });

    const { handled, res } = await dispatch("POST", "/api/cs-bridge/start-conversation", {
      shopId: "shop-1",
      conversationId: "conv-1",
      buyerUserId: "buyer-1",
    });

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(bridgeState.bridge.getOrCreateSession).toHaveBeenCalledWith("shop-1", {
      conversationId: "conv-1",
      buyerUserId: "buyer-1",
      orderId: undefined,
    });
    expect(dispatchCatchUp).toHaveBeenCalledWith({ operatorInstruction: undefined });
  });

  it("passes operatorInstruction through to catch-up dispatch", async () => {
    const dispatchCatchUp = vi.fn().mockResolvedValue({ ok: true });
    bridgeState.bridge.getOrCreateSession.mockResolvedValue({ dispatchCatchUp });

    const { handled, res } = await dispatch("POST", "/api/cs-bridge/start-conversation", {
      shopId: "shop-1",
      conversationId: "conv-1",
      operatorInstruction: "This refund request looks suspicious. Review carefully before offering any compensation.",
    });

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(dispatchCatchUp).toHaveBeenCalledWith({
      operatorInstruction: "This refund request looks suspicious. Review carefully before offering any compensation.",
    });
  });
});
