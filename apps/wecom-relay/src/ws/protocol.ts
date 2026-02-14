import type { WSFrame } from "../types.js";

/**
 * Encode a WSFrame to a JSON string for sending over WebSocket.
 */
export function encodeFrame(frame: WSFrame): string {
  return JSON.stringify(frame);
}

/**
 * Decode a raw WebSocket message string into a typed WSFrame.
 * Throws if the message is not valid JSON or missing the `type` field.
 */
export function decodeFrame(data: string): WSFrame {
  const parsed: unknown = JSON.parse(data);

  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    throw new Error("Invalid frame: missing type field");
  }

  const frame = parsed as Record<string, unknown>;
  const type = frame["type"];

  if (typeof type !== "string") {
    throw new Error("Invalid frame: type must be a string");
  }

  const validTypes = ["hello", "inbound", "reply", "image_reply", "ack", "error", "create_binding", "create_binding_ack", "unbind_all", "binding_resolved"];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid frame type: ${type}`);
  }

  return parsed as WSFrame;
}
