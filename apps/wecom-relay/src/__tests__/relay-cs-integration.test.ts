import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { encodeFrame, decodeFrame } from "../ws/protocol.js";
import type {
  HelloFrame,
  InboundFrame,
  ReplyFrame,
  ImageReplyFrame,
  AckFrame,
  ErrorFrame,
  CreateBindingFrame,
  CreateBindingAckFrame,
  UnbindAllFrame,
  BindingResolvedFrame,
  BindingClearedFrame,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start a WSS on an OS-assigned port; returns the server and its URL. */
function startServer(): Promise<{ wss: WebSocketServer; url: string }> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("listening", () => {
      const addr = wss.address();
      if (typeof addr === "object" && addr !== null) {
        resolve({ wss, url: `ws://127.0.0.1:${addr.port}` });
      } else {
        reject(new Error("WebSocketServer address is not an object"));
      }
    });
    wss.on("error", reject);
  });
}

/** Wait for the next message on a WebSocket. */
function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(data.toString()));
    ws.once("error", reject);
  });
}

/** Wait for the next connection on a WebSocketServer. */
function nextConnection(wss: WebSocketServer): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    wss.once("connection", resolve);
    wss.once("error", reject);
  });
}

/** Wait for a WebSocket client to reach OPEN state. */
function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------

const openServers: WebSocketServer[] = [];
const openClients: WebSocket[] = [];

afterEach(async () => {
  for (const ws of openClients) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  openClients.length = 0;

  await Promise.all(
    openServers.map(
      (wss) => new Promise<void>((resolve) => wss.close(() => resolve())),
    ),
  );
  openServers.length = 0;
});

// ---------------------------------------------------------------------------
// 1. Protocol compatibility: cs_hello
// ---------------------------------------------------------------------------

describe("protocol encode/decode", () => {
  it("cs_hello frame round-trips correctly", () => {
    const frame: HelloFrame = {
      type: "cs_hello",
      gateway_id: "gw-001",
      auth_token: "tok-secret-123",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect(decoded.type).toBe("cs_hello");
  });

  // ---------------------------------------------------------------------------
  // 2. cs_inbound frame
  // ---------------------------------------------------------------------------

  it("cs_inbound frame round-trips correctly", () => {
    const frame: InboundFrame = {
      type: "cs_inbound",
      id: "msg-100",
      platform: "wecom",
      customer_id: "cust-abc",
      msg_type: "text",
      content: "Hello from customer",
      timestamp: 1700000000,
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect(decoded.type).toBe("cs_inbound");
  });

  it("cs_inbound frame with optional media fields round-trips", () => {
    const frame: InboundFrame = {
      type: "cs_inbound",
      id: "msg-101",
      platform: "wecom",
      customer_id: "cust-xyz",
      msg_type: "voice",
      content: "",
      timestamp: 1700000001,
      media_data: "base64encodeddata==",
      media_mime: "audio/amr",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect((decoded as InboundFrame).media_data).toBe("base64encodeddata==");
    expect((decoded as InboundFrame).media_mime).toBe("audio/amr");
  });

  // ---------------------------------------------------------------------------
  // 3. cs_reply frame
  // ---------------------------------------------------------------------------

  it("cs_reply frame round-trips correctly", () => {
    const frame: ReplyFrame = {
      type: "cs_reply",
      id: "reply-200",
      platform: "wecom",
      customer_id: "cust-abc",
      content: "Agent response here",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect(decoded.type).toBe("cs_reply");
  });

  it("cs_image_reply frame round-trips correctly", () => {
    const frame: ImageReplyFrame = {
      type: "cs_image_reply",
      id: "img-reply-201",
      platform: "wecom",
      customer_id: "cust-abc",
      image_data: "iVBORw0KGgoAAAANS...",
      image_mime: "image/png",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect(decoded.type).toBe("cs_image_reply");
  });

  // ---------------------------------------------------------------------------
  // 4. cs_binding_resolved frame
  // ---------------------------------------------------------------------------

  it("cs_binding_resolved frame round-trips correctly", () => {
    const frame: BindingResolvedFrame = {
      type: "cs_binding_resolved",
      platform: "wecom",
      customer_id: "cust-abc",
      gateway_id: "gw-001",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect(decoded.type).toBe("cs_binding_resolved");
  });

  it("cs_binding_cleared frame round-trips correctly", () => {
    const frame: BindingClearedFrame = {
      type: "cs_binding_cleared",
      gateway_id: "gw-001",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect(decoded.type).toBe("cs_binding_cleared");
  });

  // ---------------------------------------------------------------------------
  // 5. cs_create_binding frame (with optional platform)
  // ---------------------------------------------------------------------------

  it("cs_create_binding frame without platform round-trips", () => {
    const frame: CreateBindingFrame = {
      type: "cs_create_binding",
      gateway_id: "gw-002",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect((decoded as CreateBindingFrame).platform).toBeUndefined();
  });

  it("cs_create_binding frame with platform round-trips", () => {
    const frame: CreateBindingFrame = {
      type: "cs_create_binding",
      gateway_id: "gw-002",
      platform: "wecom",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect((decoded as CreateBindingFrame).platform).toBe("wecom");
  });

  it("cs_create_binding_ack frame round-trips correctly", () => {
    const frame: CreateBindingAckFrame = {
      type: "cs_create_binding_ack",
      token: "bind-tok-999",
      customer_service_url: "https://work.weixin.qq.com/kf/abc123",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
  });

  it("cs_unbind_all frame round-trips correctly", () => {
    const frame: UnbindAllFrame = {
      type: "cs_unbind_all",
      gateway_id: "gw-001",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
  });

  // ---------------------------------------------------------------------------
  // 6. cs_ack and cs_error frames
  // ---------------------------------------------------------------------------

  it("cs_ack frame round-trips correctly", () => {
    const frame: AckFrame = {
      type: "cs_ack",
      id: "ack-300",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect(decoded.type).toBe("cs_ack");
  });

  it("cs_error frame round-trips correctly", () => {
    const frame: ErrorFrame = {
      type: "cs_error",
      message: "Authentication failed: invalid token",
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded).toEqual(frame);
    expect(decoded.type).toBe("cs_error");
  });

  // ---------------------------------------------------------------------------
  // Edge cases: decodeFrame validation
  // ---------------------------------------------------------------------------

  it("decodeFrame throws on invalid JSON", () => {
    expect(() => decodeFrame("not-json")).toThrow();
  });

  it("decodeFrame throws on missing type field", () => {
    expect(() => decodeFrame('{"id":"x"}')).toThrow("missing type field");
  });

  it("decodeFrame throws on non-string type", () => {
    expect(() => decodeFrame('{"type":42}')).toThrow("type must be a string");
  });

  it("decodeFrame throws on unknown frame type", () => {
    expect(() => decodeFrame('{"type":"unknown_frame"}')).toThrow(
      "Invalid frame type: unknown_frame",
    );
  });

  it("decodeFrame accepts all valid cs_* frame types", () => {
    const validTypes = [
      "cs_hello",
      "cs_inbound",
      "cs_reply",
      "cs_image_reply",
      "cs_ack",
      "cs_error",
      "cs_create_binding",
      "cs_create_binding_ack",
      "cs_unbind_all",
      "cs_binding_resolved",
      "cs_binding_cleared",
    ];

    for (const type of validTypes) {
      const raw = JSON.stringify({ type });
      expect(() => decodeFrame(raw)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Full handshake simulation over real WebSocket
// ---------------------------------------------------------------------------

describe("WebSocket handshake simulation", () => {
  it("full cs_hello -> cs_ack -> cs_inbound -> cs_reply flow", async () => {
    const { wss, url } = await startServer();
    openServers.push(wss);

    // Collect all messages on each side via persistent listeners
    const serverMessages: string[] = [];
    const clientMessages: string[] = [];

    const serverConnP = nextConnection(wss);

    const client = new WebSocket(url);
    openClients.push(client);

    // Set up buffering listeners before any messages can arrive
    client.on("message", (data) => clientMessages.push(data.toString()));
    await waitOpen(client);

    const serverSock = await serverConnP;
    serverSock.on("message", (data) => serverMessages.push(data.toString()));

    // Helper: wait until a message array reaches the expected length
    const waitFor = (arr: string[], len: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (arr.length >= len) {
            resolve();
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });

    // 1) Client sends cs_hello
    const hello: HelloFrame = {
      type: "cs_hello",
      gateway_id: "gw-test",
      auth_token: "test-token",
    };
    client.send(encodeFrame(hello));

    // Server receives cs_hello
    await waitFor(serverMessages, 1);
    const helloDecoded = decodeFrame(serverMessages[0]!);
    expect(helloDecoded.type).toBe("cs_hello");
    expect((helloDecoded as HelloFrame).gateway_id).toBe("gw-test");
    expect((helloDecoded as HelloFrame).auth_token).toBe("test-token");

    // 2) Server responds with cs_ack
    const ack: AckFrame = { type: "cs_ack", id: "hello-ack" };
    serverSock.send(encodeFrame(ack));

    // 3) Server sends cs_inbound
    const inbound: InboundFrame = {
      type: "cs_inbound",
      id: "msg-500",
      platform: "wecom",
      customer_id: "cust-end-user",
      msg_type: "text",
      content: "Hi, I need help",
      timestamp: Date.now(),
    };
    serverSock.send(encodeFrame(inbound));

    // Client receives cs_ack + cs_inbound
    await waitFor(clientMessages, 2);
    const ackDecoded = decodeFrame(clientMessages[0]!);
    expect(ackDecoded.type).toBe("cs_ack");
    expect((ackDecoded as AckFrame).id).toBe("hello-ack");

    const inboundDecoded = decodeFrame(clientMessages[1]!);
    expect(inboundDecoded.type).toBe("cs_inbound");
    expect((inboundDecoded as InboundFrame).content).toBe("Hi, I need help");

    // 4) Client sends cs_reply
    const reply: ReplyFrame = {
      type: "cs_reply",
      id: (inboundDecoded as InboundFrame).id,
      platform: (inboundDecoded as InboundFrame).platform,
      customer_id: (inboundDecoded as InboundFrame).customer_id,
      content: "Sure, how can I assist you?",
    };
    client.send(encodeFrame(reply));

    // Server receives cs_reply
    await waitFor(serverMessages, 2);
    const replyDecoded = decodeFrame(serverMessages[1]!);
    expect(replyDecoded.type).toBe("cs_reply");
    expect((replyDecoded as ReplyFrame).id).toBe("msg-500");
    expect((replyDecoded as ReplyFrame).platform).toBe("wecom");
    expect((replyDecoded as ReplyFrame).customer_id).toBe("cust-end-user");
    expect((replyDecoded as ReplyFrame).content).toBe("Sure, how can I assist you?");
  });

  it("server sends cs_error when client sends invalid frame type", async () => {
    const { wss, url } = await startServer();
    openServers.push(wss);

    const serverReady = nextConnection(wss).then(async (serverSock) => {
      const raw = await nextMessage(serverSock);
      let errorMsg: string;
      try {
        decodeFrame(raw);
        errorMsg = "unexpected: should not decode";
      } catch (err) {
        errorMsg = (err as Error).message;
      }

      const errorFrame: ErrorFrame = {
        type: "cs_error",
        message: errorMsg,
      };
      serverSock.send(encodeFrame(errorFrame));
    });

    const client = new WebSocket(url);
    openClients.push(client);
    await waitOpen(client);

    // Send a frame with an invalid type
    client.send(JSON.stringify({ type: "bogus_type", data: "nope" }));

    const errorRaw = await nextMessage(client);
    const errorFrame = decodeFrame(errorRaw);
    expect(errorFrame.type).toBe("cs_error");
    expect((errorFrame as ErrorFrame).message).toContain("Invalid frame type");

    await serverReady;
  });

  it("cs_create_binding -> cs_create_binding_ack flow", async () => {
    const { wss, url } = await startServer();
    openServers.push(wss);

    const serverReady = nextConnection(wss).then(async (serverSock) => {
      const raw = await nextMessage(serverSock);
      const frame = decodeFrame(raw);
      expect(frame.type).toBe("cs_create_binding");
      expect((frame as CreateBindingFrame).gateway_id).toBe("gw-new");
      expect((frame as CreateBindingFrame).platform).toBe("wecom");

      const ackFrame: CreateBindingAckFrame = {
        type: "cs_create_binding_ack",
        token: "new-binding-token",
        customer_service_url: "https://work.weixin.qq.com/kf/svc123",
      };
      serverSock.send(encodeFrame(ackFrame));
    });

    const client = new WebSocket(url);
    openClients.push(client);
    await waitOpen(client);

    const bindingReq: CreateBindingFrame = {
      type: "cs_create_binding",
      gateway_id: "gw-new",
      platform: "wecom",
    };
    client.send(encodeFrame(bindingReq));

    const ackRaw = await nextMessage(client);
    const ack = decodeFrame(ackRaw);
    expect(ack.type).toBe("cs_create_binding_ack");
    expect((ack as CreateBindingAckFrame).token).toBe("new-binding-token");
    expect((ack as CreateBindingAckFrame).customer_service_url).toBe(
      "https://work.weixin.qq.com/kf/svc123",
    );

    await serverReady;
  });

  it("cs_binding_resolved notification from server to client", async () => {
    const { wss, url } = await startServer();
    openServers.push(wss);

    const serverReady = nextConnection(wss).then(async (serverSock) => {
      // Wait for hello before sending binding resolved
      const raw = await nextMessage(serverSock);
      const hello = decodeFrame(raw);
      expect(hello.type).toBe("cs_hello");

      const resolved: BindingResolvedFrame = {
        type: "cs_binding_resolved",
        platform: "wecom",
        customer_id: "cust-xyz",
        gateway_id: "gw-test",
      };
      serverSock.send(encodeFrame(resolved));
    });

    const client = new WebSocket(url);
    openClients.push(client);
    await waitOpen(client);

    // Client sends hello first
    client.send(
      encodeFrame({
        type: "cs_hello",
        gateway_id: "gw-test",
        auth_token: "tok",
      } satisfies HelloFrame),
    );

    // Client receives binding_resolved
    const resolvedRaw = await nextMessage(client);
    const resolved = decodeFrame(resolvedRaw);
    expect(resolved.type).toBe("cs_binding_resolved");
    expect((resolved as BindingResolvedFrame).platform).toBe("wecom");
    expect((resolved as BindingResolvedFrame).customer_id).toBe("cust-xyz");
    expect((resolved as BindingResolvedFrame).gateway_id).toBe("gw-test");

    await serverReady;
  });
});
