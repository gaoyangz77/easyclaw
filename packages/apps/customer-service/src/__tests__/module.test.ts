import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket as WSClient } from "ws";
import { createCustomerServiceModule } from "../module.js";
import type { CustomerServiceCallbacks, CustomerServiceModule } from "../module.js";
import type {
  CSHelloFrame,
  CSInboundFrame,
  CSAckFrame,
  CSErrorFrame,
  CSBindingResolvedFrame,
  CSReplyFrame,
  CustomerServiceConfig,
} from "@easyclaw/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Start a WebSocketServer on a random port and return it with the resolved URL. */
function createTestServer(): Promise<{ wss: WebSocketServer; url: string }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("listening", () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, url: `ws://127.0.0.1:${addr.port}` });
    });
  });
}

/** Wait for the next client connection on the server. */
function waitForConnection(wss: WebSocketServer): Promise<WSClient> {
  return new Promise((resolve) => {
    wss.once("connection", (ws) => resolve(ws));
  });
}

/** Wait for the next message on a WebSocket (parsed as JSON). */
function waitForMessage<T = unknown>(ws: WSClient): Promise<T> {
  return new Promise((resolve) => {
    ws.once("message", (data: Buffer) => {
      resolve(JSON.parse(data.toString("utf-8")) as T);
    });
  });
}

/** Wait a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeConfig(url: string): CustomerServiceConfig {
  return {
    relayUrl: url,
    authToken: "test-token",
    gatewayId: "gw-001",
    businessPrompt: "You are a helpful assistant.",
    platforms: ["wecom", "whatsapp"],
  };
}

function makeCallbacks(overrides?: Partial<CustomerServiceCallbacks>): CustomerServiceCallbacks {
  return {
    onInboundMessage: vi.fn().mockResolvedValue("default reply"),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createCustomerServiceModule", () => {
  let wss: WebSocketServer;
  let url: string;
  let mod: CustomerServiceModule;

  beforeEach(async () => {
    const server = await createTestServer();
    wss = server.wss;
    url = server.url;
  });

  afterEach(async () => {
    // Stop the module first to prevent reconnection attempts during server shutdown
    mod?.stop();

    // Close all server-side sockets then the server itself
    await new Promise<void>((resolve) => {
      for (const client of wss.clients) {
        client.close();
      }
      wss.close(() => resolve());
    });
  });

  // ── 1. Connection handshake ───────────────────────────────────────────────

  describe("connection handshake", () => {
    it("sends cs_hello on open and becomes connected after cs_ack", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      const hello = await waitForMessage<CSHelloFrame>(serverSocket);

      expect(hello).toEqual({
        type: "cs_hello",
        gateway_id: "gw-001",
        auth_token: "test-token",
      });

      // Before ack, status should be disconnected
      expect(mod.getStatus().connected).toBe(false);

      // Send ack
      const ack: CSAckFrame = { type: "cs_ack", id: "cs_hello" };
      serverSocket.send(JSON.stringify(ack));

      // Wait for the module to process the ack
      await delay(50);
      expect(mod.getStatus().connected).toBe(true);
    });

    it("does not become connected for a non-hello ack", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      // Send an ack for something else
      const ack: CSAckFrame = { type: "cs_ack", id: "msg-123" };
      serverSocket.send(JSON.stringify(ack));

      await delay(50);
      expect(mod.getStatus().connected).toBe(false);
    });
  });

  // ── 2. Inbound message -> reply flow ──────────────────────────────────────

  describe("inbound message -> reply flow", () => {
    it("calls onInboundMessage and sends cs_reply back", async () => {
      const callbacks = makeCallbacks({
        onInboundMessage: vi.fn().mockResolvedValue("Hello customer!"),
      });
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      // Send ack so connection is established
      serverSocket.send(JSON.stringify({ type: "cs_ack", id: "cs_hello" }));
      await delay(50);

      // Send an inbound message
      const inbound: CSInboundFrame = {
        type: "cs_inbound",
        id: "msg-001",
        platform: "wecom",
        customer_id: "cust-abc",
        msg_type: "text",
        content: "I need help",
        timestamp: Date.now(),
      };
      const replyPromise = waitForMessage<CSReplyFrame>(serverSocket);
      serverSocket.send(JSON.stringify(inbound));

      const reply = await replyPromise;

      expect(callbacks.onInboundMessage).toHaveBeenCalledWith(
        "wecom",
        "cust-abc",
        "text",
        "I need help",
        undefined,
        undefined,
      );

      expect(reply).toEqual({
        type: "cs_reply",
        id: "msg-001",
        platform: "wecom",
        customer_id: "cust-abc",
        content: "Hello customer!",
      });
    });

    it("adds the customer to the platform status after inbound", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      const inbound: CSInboundFrame = {
        type: "cs_inbound",
        id: "msg-002",
        platform: "whatsapp",
        customer_id: "cust-xyz",
        msg_type: "text",
        content: "Hi",
        timestamp: Date.now(),
      };
      serverSocket.send(JSON.stringify(inbound));

      // Wait for the module to process
      await delay(100);

      const status = mod.getStatus();
      const whatsapp = status.platforms.find((p) => p.platform === "whatsapp");
      expect(whatsapp).toBeDefined();
      expect(whatsapp!.boundCustomers).toBe(1);
    });
  });

  // ── 3. Binding resolved ───────────────────────────────────────────────────

  describe("binding resolved", () => {
    it("calls onBindingResolved callback and tracks customer in status", async () => {
      const onBindingResolved = vi.fn();
      const callbacks = makeCallbacks({ onBindingResolved });
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      const frame: CSBindingResolvedFrame = {
        type: "cs_binding_resolved",
        platform: "wecom",
        customer_id: "cust-999",
        gateway_id: "gw-001",
      };
      serverSocket.send(JSON.stringify(frame));

      await delay(50);

      expect(onBindingResolved).toHaveBeenCalledWith("wecom", "cust-999");

      const status = mod.getStatus();
      const wecom = status.platforms.find((p) => p.platform === "wecom");
      expect(wecom).toBeDefined();
      expect(wecom!.boundCustomers).toBe(1);
    });

    it("works when onBindingResolved is not provided", async () => {
      // Callbacks without onBindingResolved
      const callbacks: CustomerServiceCallbacks = {
        onInboundMessage: vi.fn().mockResolvedValue("reply"),
      };
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      const frame: CSBindingResolvedFrame = {
        type: "cs_binding_resolved",
        platform: "wecom",
        customer_id: "cust-888",
        gateway_id: "gw-001",
      };
      serverSocket.send(JSON.stringify(frame));

      await delay(50);

      // Should not throw; customer is still tracked
      const status = mod.getStatus();
      const wecom = status.platforms.find((p) => p.platform === "wecom");
      expect(wecom).toBeDefined();
      expect(wecom!.boundCustomers).toBe(1);
    });
  });

  // ── 4. Status tracking ────────────────────────────────────────────────────

  describe("status tracking", () => {
    it("tracks multiple customers across multiple platforms", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      // Send binding resolved for multiple platforms and customers
      const frames: CSBindingResolvedFrame[] = [
        { type: "cs_binding_resolved", platform: "wecom", customer_id: "c1", gateway_id: "gw-001" },
        { type: "cs_binding_resolved", platform: "wecom", customer_id: "c2", gateway_id: "gw-001" },
        { type: "cs_binding_resolved", platform: "wecom", customer_id: "c3", gateway_id: "gw-001" },
        { type: "cs_binding_resolved", platform: "whatsapp", customer_id: "c4", gateway_id: "gw-001" },
        { type: "cs_binding_resolved", platform: "whatsapp", customer_id: "c5", gateway_id: "gw-001" },
        { type: "cs_binding_resolved", platform: "telegram", customer_id: "c6", gateway_id: "gw-001" },
      ];

      for (const frame of frames) {
        serverSocket.send(JSON.stringify(frame));
      }

      await delay(100);

      const status = mod.getStatus();
      expect(status.platforms).toHaveLength(3);

      const wecom = status.platforms.find((p) => p.platform === "wecom");
      const whatsapp = status.platforms.find((p) => p.platform === "whatsapp");
      const telegram = status.platforms.find((p) => p.platform === "telegram");

      expect(wecom!.boundCustomers).toBe(3);
      expect(whatsapp!.boundCustomers).toBe(2);
      expect(telegram!.boundCustomers).toBe(1);
    });

    it("deduplicates the same customer on the same platform", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      // Send the same customer twice via binding_resolved
      const frame: CSBindingResolvedFrame = {
        type: "cs_binding_resolved",
        platform: "wecom",
        customer_id: "c1",
        gateway_id: "gw-001",
      };
      serverSocket.send(JSON.stringify(frame));
      serverSocket.send(JSON.stringify(frame));

      // Also send via inbound (same customer)
      const inbound: CSInboundFrame = {
        type: "cs_inbound",
        id: "msg-dup",
        platform: "wecom",
        customer_id: "c1",
        msg_type: "text",
        content: "hello",
        timestamp: Date.now(),
      };
      serverSocket.send(JSON.stringify(inbound));

      await delay(100);

      const status = mod.getStatus();
      const wecom = status.platforms.find((p) => p.platform === "wecom");
      expect(wecom!.boundCustomers).toBe(1);
    });

    it("returns empty platforms before any messages", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      await connPromise;

      const status = mod.getStatus();
      expect(status.connected).toBe(false);
      expect(status.platforms).toEqual([]);
    });
  });

  // ── 5. Business prompt ────────────────────────────────────────────────────

  describe("business prompt", () => {
    it("initializes businessPrompt from config", () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);
      mod.start(makeConfig(url));

      expect(mod.getBusinessPrompt()).toBe("You are a helpful assistant.");
    });

    it("updateBusinessPrompt changes the value returned by getBusinessPrompt", () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);
      mod.start(makeConfig(url));

      mod.updateBusinessPrompt("New prompt text");
      expect(mod.getBusinessPrompt()).toBe("New prompt text");
    });

    it("updateBusinessPrompt can be called multiple times", () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);
      mod.start(makeConfig(url));

      mod.updateBusinessPrompt("First");
      mod.updateBusinessPrompt("Second");
      mod.updateBusinessPrompt("Third");
      expect(mod.getBusinessPrompt()).toBe("Third");
    });
  });

  // ── 6. Stop cleanup ──────────────────────────────────────────────────────

  describe("stop cleanup", () => {
    it("sets status to disconnected after stop", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      // Become connected
      serverSocket.send(JSON.stringify({ type: "cs_ack", id: "cs_hello" }));
      await delay(50);
      expect(mod.getStatus().connected).toBe(true);

      mod.stop();

      expect(mod.getStatus().connected).toBe(false);
    });

    it("does not attempt to reconnect after stop", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      mod.stop();

      // Wait long enough that a reconnect would have happened (min reconnect is 1000ms,
      // but we just need to confirm no new connection arrives)
      let gotNewConnection = false;
      wss.once("connection", () => {
        gotNewConnection = true;
      });

      await delay(200);
      expect(gotNewConnection).toBe(false);
    });

    it("can be restarted after stop", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      // First connection
      const conn1Promise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket1 = await conn1Promise;
      await waitForMessage(serverSocket1); // consume hello

      mod.stop();

      // Restart
      const conn2Promise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket2 = await conn2Promise;
      const hello2 = await waitForMessage<CSHelloFrame>(serverSocket2);

      expect(hello2.type).toBe("cs_hello");
      expect(hello2.gateway_id).toBe("gw-001");
    });

    it("clears platform customer tracking on restart", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      // First connection: add a customer
      const conn1Promise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket1 = await conn1Promise;
      await waitForMessage(serverSocket1); // consume hello

      serverSocket1.send(
        JSON.stringify({
          type: "cs_binding_resolved",
          platform: "wecom",
          customer_id: "c1",
          gateway_id: "gw-001",
        } satisfies CSBindingResolvedFrame),
      );
      await delay(50);
      expect(mod.getStatus().platforms).toHaveLength(1);

      // Restart: platform tracking should be cleared
      const conn2Promise = waitForConnection(wss);
      mod.start(makeConfig(url));

      await conn2Promise;

      expect(mod.getStatus().platforms).toEqual([]);
    });
  });

  // ── 7. Error frame ────────────────────────────────────────────────────────

  describe("error frame", () => {
    it("handles cs_error gracefully without crashing", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      // Become connected
      serverSocket.send(JSON.stringify({ type: "cs_ack", id: "cs_hello" }));
      await delay(50);

      // Send an error frame
      const errorFrame: CSErrorFrame = {
        type: "cs_error",
        message: "Something went wrong on the server",
      };
      serverSocket.send(JSON.stringify(errorFrame));

      await delay(50);

      // Module should still be alive and connected
      expect(mod.getStatus().connected).toBe(true);
    });

    it("handles unparseable messages gracefully", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      // Send garbage data
      serverSocket.send("this is not json {{{");

      await delay(50);

      // Module should not crash
      expect(mod.getStatus().connected).toBe(false); // still not acked
    });

    it("ignores unknown frame types", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      // Send an unknown frame type
      serverSocket.send(JSON.stringify({ type: "cs_unknown_type", data: "foo" }));

      await delay(50);

      // Module should not crash; no side effects
      expect(mod.getStatus().platforms).toEqual([]);
    });
  });

  // ── 8. Media messages ─────────────────────────────────────────────────────

  describe("media messages", () => {
    it("passes media_data and media_mime to onInboundMessage", async () => {
      const callbacks = makeCallbacks({
        onInboundMessage: vi.fn().mockResolvedValue("Got your image!"),
      });
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      const inbound: CSInboundFrame = {
        type: "cs_inbound",
        id: "msg-media-001",
        platform: "whatsapp",
        customer_id: "cust-media",
        msg_type: "image",
        content: "",
        timestamp: Date.now(),
        media_data: "base64encodeddata==",
        media_mime: "image/png",
      };

      const replyPromise = waitForMessage<CSReplyFrame>(serverSocket);
      serverSocket.send(JSON.stringify(inbound));

      const reply = await replyPromise;

      expect(callbacks.onInboundMessage).toHaveBeenCalledWith(
        "whatsapp",
        "cust-media",
        "image",
        "",
        "base64encodeddata==",
        "image/png",
      );

      expect(reply.content).toBe("Got your image!");
    });

    it("handles inbound with media_data but no media_mime", async () => {
      const callbacks = makeCallbacks({
        onInboundMessage: vi.fn().mockResolvedValue("Acknowledged"),
      });
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      const inbound: CSInboundFrame = {
        type: "cs_inbound",
        id: "msg-media-002",
        platform: "wecom",
        customer_id: "cust-media2",
        msg_type: "file",
        content: "document.pdf",
        timestamp: Date.now(),
        media_data: "base64filedata==",
        // media_mime intentionally omitted
      };

      const replyPromise = waitForMessage<CSReplyFrame>(serverSocket);
      serverSocket.send(JSON.stringify(inbound));

      const reply = await replyPromise;

      expect(callbacks.onInboundMessage).toHaveBeenCalledWith(
        "wecom",
        "cust-media2",
        "file",
        "document.pdf",
        "base64filedata==",
        undefined,
      );

      expect(reply.content).toBe("Acknowledged");
    });
  });

  // ── 9. Empty reply ────────────────────────────────────────────────────────

  describe("empty reply", () => {
    it("does not send cs_reply when callback returns empty string", async () => {
      const callbacks = makeCallbacks({
        onInboundMessage: vi.fn().mockResolvedValue(""),
      });
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      const inbound: CSInboundFrame = {
        type: "cs_inbound",
        id: "msg-empty",
        platform: "wecom",
        customer_id: "cust-quiet",
        msg_type: "text",
        content: "Hello?",
        timestamp: Date.now(),
      };

      // Track all messages received by the server after the hello
      const serverMessages: unknown[] = [];
      serverSocket.on("message", (data: Buffer) => {
        serverMessages.push(JSON.parse(data.toString("utf-8")));
      });

      serverSocket.send(JSON.stringify(inbound));

      // Wait enough time for a reply to have been sent if it was going to be
      await delay(200);

      // No reply should have been sent
      expect(serverMessages).toEqual([]);
      expect(callbacks.onInboundMessage).toHaveBeenCalledOnce();
    });

    it("does not send cs_reply when callback rejects", async () => {
      const callbacks = makeCallbacks({
        onInboundMessage: vi.fn().mockRejectedValue(new Error("AI failed")),
      });
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      const inbound: CSInboundFrame = {
        type: "cs_inbound",
        id: "msg-err",
        platform: "wecom",
        customer_id: "cust-err",
        msg_type: "text",
        content: "Help me",
        timestamp: Date.now(),
      };

      const serverMessages: unknown[] = [];
      serverSocket.on("message", (data: Buffer) => {
        serverMessages.push(JSON.parse(data.toString("utf-8")));
      });

      serverSocket.send(JSON.stringify(inbound));

      await delay(200);

      // No reply should have been sent because the callback threw
      expect(serverMessages).toEqual([]);
    });
  });

  // ── 10. Reconnection behavior ─────────────────────────────────────────────

  describe("reconnection", () => {
    it("reconnects after server closes connection unexpectedly", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const conn1Promise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket1 = await conn1Promise;
      await waitForMessage(serverSocket1); // consume hello

      // Server abruptly closes the connection
      const conn2Promise = waitForConnection(wss);
      serverSocket1.close();

      // Module should reconnect automatically
      const serverSocket2 = await conn2Promise;
      const hello2 = await waitForMessage<CSHelloFrame>(serverSocket2);

      expect(hello2.type).toBe("cs_hello");
      expect(hello2.gateway_id).toBe("gw-001");
    });
  });

  // ── 11. Ping/pong ─────────────────────────────────────────────────────────

  describe("ping/pong", () => {
    it("responds to server ping with pong", async () => {
      const callbacks = makeCallbacks();
      mod = createCustomerServiceModule(callbacks);

      const connPromise = waitForConnection(wss);
      mod.start(makeConfig(url));

      const serverSocket = await connPromise;
      await waitForMessage(serverSocket); // consume hello

      const pongReceived = new Promise<Buffer>((resolve) => {
        serverSocket.on("pong", (data: Buffer) => resolve(data));
      });

      const pingPayload = Buffer.from("heartbeat");
      serverSocket.ping(pingPayload);

      const pongData = await pongReceived;
      expect(pongData.toString()).toBe("heartbeat");
    });
  });
});
