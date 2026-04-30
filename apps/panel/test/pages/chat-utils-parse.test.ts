/**
 * Tests for parseRawMessages — specifically the expired image placeholder
 * injection when the gateway strips image data from history.
 */
import { describe, it, expect } from "vitest";
import {
  cleanMessageText,
  isSystemEventMessage,
  parseRawMessages,
  IMAGE_EXPIRED_PLACEHOLDER,
  STOP_COMMAND_PLACEHOLDER,
  localizeError,
  mergeTerminalError,
} from "../../src/pages/chat/chat-utils.js";
import type { ChatMessage } from "../../src/pages/chat/chat-utils.js";

const EXEC_COMPLETION_EVENT = [
  "System (untrusted): [2026-04-29 01:02:51 PDT] Exec completed (fast-orb, code 0) :: Successfully installed pandas",
  "",
  "An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.",
  "Current time: Wednesday, April 29th, 2026 - 01:04 (America/Los_Angeles) / 2026-04-29 08:04 UTC",
].join("\n");

const EXEC_COMPLETION_EVENT_GMT_OFFSET = [
  "System (untrusted): [2026-04-30 20:05:30 GMT+8] Exec completed (quiet-lo, code 0) :: Requirement already satisfied: six>=1.5",
  "System (untrusted): [2026-04-30 20:07:40 GMT+8] Exec completed (brisk-bi, code 0) :: {\"sellerSku\":\"14KGold-Rope-6-26\"}",
  "",
  "An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.",
].join("\n");

describe("parseRawMessages — stripped image handling", () => {
  it("appends expired placeholder when content has image blocks with empty data", () => {
    const raw = [
      {
        role: "user" as const,
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "", mimeType: "image/png" },
        ],
        timestamp: 1000,
      },
    ];

    const result = parseRawMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("hello");
    expect(result[0].text).toContain(IMAGE_EXPIRED_PLACEHOLDER);
    // No images should be extracted (data is empty)
    expect(result[0].images).toBeUndefined();
  });

  it("does not append expired placeholder when image blocks have valid data", () => {
    const raw = [
      {
        role: "user" as const,
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "base64data", mimeType: "image/png" },
        ],
        timestamp: 2000,
      },
    ];

    const result = parseRawMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].text).not.toContain(IMAGE_EXPIRED_PLACEHOLDER);
    expect(result[0].images).toHaveLength(1);
    expect(result[0].images![0].data).toBe("base64data");
  });

  it("creates message entry for image-only content with stripped blocks (not skipped)", () => {
    const raw = [
      {
        role: "user" as const,
        content: [{ type: "image", data: "" }],
        timestamp: 3000,
      },
    ];

    const result = parseRawMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(IMAGE_EXPIRED_PLACEHOLDER);
    expect(result[0].images).toBeUndefined();
  });

  it("does not append expired placeholder when content has no image blocks", () => {
    const raw = [
      {
        role: "user" as const,
        content: [{ type: "text", text: "just text" }],
        timestamp: 4000,
      },
    ];

    const result = parseRawMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("just text");
    expect(result[0].text).not.toContain(IMAGE_EXPIRED_PLACEHOLDER);
  });

  it("appends expired placeholder for assistant messages with stripped images", () => {
    const raw = [
      {
        role: "assistant" as const,
        content: [
          { type: "text", text: "here is the image" },
          { type: "image", data: "" },
        ],
        timestamp: 5000,
      },
    ];

    const result = parseRawMessages(raw);
    // First entry should be the text+placeholder message
    const textMsg = result.find(
      (m) => m.role === "assistant" && m.text.includes("here is the image"),
    );
    expect(textMsg).toBeDefined();
    expect(textMsg!.text).toContain(IMAGE_EXPIRED_PLACEHOLDER);
  });

  it("extracts caption text from message tool calls in assistant history", () => {
    const raw = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool_use",
            name: "message",
            input: {
              caption: "文件已经发给你了",
              media: "/tmp/report.pdf",
            },
          },
        ],
        timestamp: 6000,
      },
    ];

    const result = parseRawMessages(raw);
    expect(result).toEqual([
      expect.objectContaining({
        role: "tool-event",
        toolName: "message",
      }),
      expect.objectContaining({
        role: "assistant",
        text: "文件已经发给你了",
        timestamp: 6000,
      }),
    ]);
  });

  it("extracts tool events when history uses toolName instead of name", () => {
    const raw = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool_use",
            toolName: "search",
            input: {
              query: "order 123",
            },
          },
        ],
        timestamp: 7000,
      },
    ];

    const result = parseRawMessages(raw);
    expect(result).toEqual([
      expect.objectContaining({
        role: "tool-event",
        toolName: "search",
        toolArgs: { query: "order 123" },
        timestamp: 7000,
      }),
    ]);
  });

  it("marks historical tool events as failed when the block carries an error", () => {
    const raw = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool_use",
            name: "search",
            input: { query: "refund" },
            error: "backend timeout",
          },
        ],
        timestamp: 8000,
      },
    ];

    const result = parseRawMessages(raw);
    expect(result).toEqual([
      expect.objectContaining({
        role: "tool-event",
        toolName: "search",
        toolStatus: "failed",
        toolError: "backend timeout",
        timestamp: 8000,
      }),
    ]);
  });

  it("reconstructs a persistent stop bubble from abort metadata and skips duplicate partial text", () => {
    const raw = [
      {
        role: "user" as const,
        content: [{ type: "text", text: "你现在有什么工具?" }],
        timestamp: 9000,
      },
      {
        role: "assistant" as const,
        content: [{ type: "text", text: "我现在能直接用的主要工具有这些：" }],
        timestamp: 9100,
      },
      {
        role: "assistant" as const,
        content: [{ type: "text", text: "我现在能直接用的主要工具有这些：" }],
        timestamp: 9100,
        idempotencyKey: "run-stop:assistant",
        openclawAbort: {
          aborted: true,
          origin: "rpc",
          runId: "run-stop",
        },
      },
    ];

    const result = parseRawMessages(raw);
    expect(result).toEqual([
      expect.objectContaining({
        role: "user",
        text: "你现在有什么工具?",
      }),
      expect.objectContaining({
        role: "assistant",
        text: "我现在能直接用的主要工具有这些：",
      }),
      expect.objectContaining({
        role: "assistant",
        text: `\u23F9 ${STOP_COMMAND_PLACEHOLDER}`,
      }),
    ]);
  });
});

describe("chat-utils system event cleanup", () => {
  it("hides wrapped async exec completion events", () => {
    expect(cleanMessageText(EXEC_COMPLETION_EVENT)).toBe("");
  });

  it("hides wrapped async exec completion events with GMT offset timestamps", () => {
    expect(cleanMessageText(EXEC_COMPLETION_EVENT_GMT_OFFSET)).toBe("");
  });

  it("detects wrapped async exec completion events as system events", () => {
    expect(isSystemEventMessage(EXEC_COMPLETION_EVENT)).toBe(true);
  });

  it("detects wrapped async exec completion events with GMT offset timestamps", () => {
    expect(isSystemEventMessage(EXEC_COMPLETION_EVENT_GMT_OFFSET)).toBe(true);
  });

  it("drops wrapped async exec completion messages with no visible payload", () => {
    const result = parseRawMessages([
      {
        role: "user",
        content: [{ type: "text", text: EXEC_COMPLETION_EVENT }],
        timestamp: 1,
      },
    ]);

    expect(result).toEqual([]);
  });

  it("drops wrapped async exec completion messages with GMT offset timestamps", () => {
    const result = parseRawMessages([
      {
        role: "user",
        content: [{ type: "text", text: EXEC_COMPLETION_EVENT_GMT_OFFSET }],
        timestamp: 1,
      },
    ]);

    expect(result).toEqual([]);
  });

  it("drops assistant NO_REPLY-only history messages", () => {
    const result = parseRawMessages([
      {
        role: "assistant",
        content: [{ type: "text", text: "  NO_REPLY  " }],
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "做好了" }],
        timestamp: 3,
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        role: "assistant",
        text: "做好了",
      }),
    ]);
  });
});

describe("localizeError", () => {
  const t = (key: string) => key;

  it("maps Anthropic extra usage error to billing i18n key", () => {
    const result = localizeError(
      "LLM request rejected: You're out of extra usage. Add more at claude.ai/settings/usage",
      t,
    );
    expect(result).toBe("chat.errorBilling");
  });

  it("maps 'run out of credits' to billing i18n key", () => {
    expect(localizeError("run out of credits", t)).toBe("chat.errorBilling");
  });

  it("maps 'insufficient balance' to billing i18n key", () => {
    expect(localizeError("insufficient balance on your account", t)).toBe("chat.errorBilling");
  });

  it("maps rate limit error to rate limit i18n key", () => {
    expect(localizeError("temporarily overloaded, try again", t)).toBe("chat.errorRateLimit");
  });

  it("maps auth failure to auth i18n key", () => {
    expect(localizeError("unauthorized: invalid API key", t)).toBe("chat.errorAuth");
  });

  it("maps timeout error to timeout i18n key", () => {
    expect(localizeError("request timed out after 30s", t)).toBe("chat.errorTimeout");
  });

  it("maps context overflow to context overflow i18n key", () => {
    expect(localizeError("context length exceeded", t)).toBe("chat.errorContextOverflow");
  });

  it("returns raw error string when no pattern matches", () => {
    const raw = "Something completely unexpected happened";
    expect(localizeError(raw, t)).toBe(raw);
  });
});

describe("mergeTerminalError", () => {
  it("appends error when not present in messages", () => {
    const messages: ChatMessage[] = [{ role: "user", text: "hello", timestamp: 1000 }];
    const error = { runId: "r1", text: "\u26A0 billing error", timestamp: 2000 };
    const result = mergeTerminalError(messages, error);
    expect(result).toHaveLength(2);
    expect(result[1].text).toBe("\u26A0 billing error");
    expect(result[1].role).toBe("assistant");
    expect(result[1].timestamp).toBe(2000);
  });

  it("does not duplicate when error text already present", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "hello", timestamp: 1000 },
      { role: "assistant", text: "\u26A0 billing error", timestamp: 2000 },
    ];
    const error = { runId: "r1", text: "\u26A0 billing error", timestamp: 2000 };
    const result = mergeTerminalError(messages, error);
    expect(result).toHaveLength(2);
    expect(result).toBe(messages); // same reference — no copy made
  });

  it("returns original array unchanged when no cached error", () => {
    const messages: ChatMessage[] = [{ role: "user", text: "hello", timestamp: 1000 }];
    const result = mergeTerminalError(messages, undefined);
    expect(result).toBe(messages);
  });

  it("re-adds error after loadHistory replaces messages (simulated)", () => {
    // Gateway history never contains synthesized errors, so loadHistory
    // wipes them.  mergeTerminalError restores the cached error.
    const gatewayHistory: ChatMessage[] = [{ role: "user", text: "hello", timestamp: 1000 }];
    const cachedError = { runId: "r1", text: "\u26A0 API key expired", timestamp: 2000 };
    const result = mergeTerminalError(gatewayHistory, cachedError);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(gatewayHistory[0]); // original msg preserved
    expect(result[1].text).toBe("\u26A0 API key expired");
  });

  it("does not match user messages for dedup (only assistant)", () => {
    // A user message with the same text should not prevent the error from being added
    const messages: ChatMessage[] = [
      { role: "user", text: "\u26A0 billing error", timestamp: 1000 },
    ];
    const error = { runId: "r1", text: "\u26A0 billing error", timestamp: 2000 };
    const result = mergeTerminalError(messages, error);
    expect(result).toHaveLength(2);
  });

  it("handles empty message list", () => {
    const result = mergeTerminalError([], { runId: "r1", text: "\u26A0 error", timestamp: 1000 });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("\u26A0 error");
  });
});
