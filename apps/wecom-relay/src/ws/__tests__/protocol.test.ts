import { describe, it, expect } from "vitest";
import { encodeFrame, decodeFrame } from "../protocol.js";
import type {
  HelloFrame,
  InboundFrame,
  ReplyFrame,
  AckFrame,
  ErrorFrame,
} from "../../types.js";

describe("protocol", () => {
  describe("encodeFrame / decodeFrame roundtrip", () => {
    it("should roundtrip a cs_hello frame", () => {
      const frame: HelloFrame = {
        type: "cs_hello",
        gateway_id: "gw-123",
        auth_token: "secret-token",
      };

      const encoded = encodeFrame(frame);
      const decoded = decodeFrame(encoded);

      expect(decoded).toEqual(frame);
    });

    it("should roundtrip a cs_inbound frame", () => {
      const frame: InboundFrame = {
        type: "cs_inbound",
        id: "msg-001",
        platform: "wecom",
        customer_id: "user-ext-001",
        msg_type: "text",
        content: "Hello, world!",
        timestamp: 1700000000,
      };

      const encoded = encodeFrame(frame);
      const decoded = decodeFrame(encoded);

      expect(decoded).toEqual(frame);
    });

    it("should roundtrip a cs_reply frame", () => {
      const frame: ReplyFrame = {
        type: "cs_reply",
        id: "msg-001",
        platform: "wecom",
        customer_id: "user-ext-001",
        content: "Here is my response",
      };

      const encoded = encodeFrame(frame);
      const decoded = decodeFrame(encoded);

      expect(decoded).toEqual(frame);
    });

    it("should roundtrip a cs_ack frame", () => {
      const frame: AckFrame = {
        type: "cs_ack",
        id: "msg-001",
      };

      const encoded = encodeFrame(frame);
      const decoded = decodeFrame(encoded);

      expect(decoded).toEqual(frame);
    });

    it("should roundtrip a cs_error frame", () => {
      const frame: ErrorFrame = {
        type: "cs_error",
        message: "Something went wrong",
      };

      const encoded = encodeFrame(frame);
      const decoded = decodeFrame(encoded);

      expect(decoded).toEqual(frame);
    });
  });

  describe("decodeFrame error handling", () => {
    it("should throw on invalid JSON", () => {
      expect(() => decodeFrame("not json")).toThrow();
    });

    it("should throw on missing type field", () => {
      expect(() => decodeFrame('{"id": "123"}')).toThrow("missing type");
    });

    it("should throw on non-string type", () => {
      expect(() => decodeFrame('{"type": 123}')).toThrow("type must be a string");
    });

    it("should throw on unknown frame type", () => {
      expect(() => decodeFrame('{"type": "unknown_type"}')).toThrow("Invalid frame type");
    });

    it("should reject old non-prefixed frame types", () => {
      expect(() => decodeFrame('{"type": "hello"}')).toThrow("Invalid frame type");
      expect(() => decodeFrame('{"type": "reply"}')).toThrow("Invalid frame type");
      expect(() => decodeFrame('{"type": "inbound"}')).toThrow("Invalid frame type");
    });

    it("should throw on null input", () => {
      expect(() => decodeFrame("null")).toThrow();
    });
  });

  describe("encodeFrame", () => {
    it("should produce valid JSON", () => {
      const frame: AckFrame = { type: "cs_ack", id: "test" };
      const encoded = encodeFrame(frame);

      expect(() => JSON.parse(encoded)).not.toThrow();
    });

    it("should handle special characters in content", () => {
      const frame: ReplyFrame = {
        type: "cs_reply",
        id: "1",
        platform: "wecom",
        customer_id: "user",
        content: 'Hello "world"\n\ttab & <xml>',
      };

      const encoded = encodeFrame(frame);
      const decoded = decodeFrame(encoded);

      expect(decoded).toEqual(frame);
    });
  });
});
