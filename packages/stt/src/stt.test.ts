import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { selectSttProvider } from "./region.js";
import { createSttProvider } from "./factory.js";
import { GroqSttProvider } from "./groq.js";
import { VolcengineSttProvider } from "./volcengine.js";
import type { SttConfig } from "./types.js";

// ─── selectSttProvider ──────────────────────────────────────────────────────

describe("selectSttProvider", () => {
  it("returns 'volcengine' for cn region", () => {
    expect(selectSttProvider("cn")).toBe("volcengine");
  });

  it("returns 'groq' for us region", () => {
    expect(selectSttProvider("us")).toBe("groq");
  });

  it("returns 'groq' for eu region", () => {
    expect(selectSttProvider("eu")).toBe("groq");
  });

  it("returns 'groq' for empty string region", () => {
    expect(selectSttProvider("")).toBe("groq");
  });

  it("returns 'groq' for any non-cn region", () => {
    expect(selectSttProvider("jp")).toBe("groq");
    expect(selectSttProvider("global")).toBe("groq");
  });
});

// ─── createSttProvider factory ──────────────────────────────────────────────

describe("createSttProvider", () => {
  it("returns a GroqSttProvider for groq config", () => {
    const config: SttConfig = {
      provider: "groq",
      groq: { apiKey: "test-key" },
    };
    const provider = createSttProvider(config);
    expect(provider).toBeInstanceOf(GroqSttProvider);
    expect(provider.name).toBe("groq");
  });

  it("returns a VolcengineSttProvider for volcengine config", () => {
    const config: SttConfig = {
      provider: "volcengine",
      volcengine: { appKey: "app-123", accessKey: "access-456" },
    };
    const provider = createSttProvider(config);
    expect(provider).toBeInstanceOf(VolcengineSttProvider);
    expect(provider.name).toBe("volcengine");
  });

  it("throws when groq config is missing", () => {
    const config: SttConfig = { provider: "groq" };
    expect(() => createSttProvider(config)).toThrow(
      "Groq STT requires groq config",
    );
  });

  it("throws when groq apiKey is empty", () => {
    const config: SttConfig = {
      provider: "groq",
      groq: { apiKey: "" },
    };
    expect(() => createSttProvider(config)).toThrow(
      "Groq STT requires an apiKey",
    );
  });

  it("throws when volcengine config is missing", () => {
    const config: SttConfig = { provider: "volcengine" };
    expect(() => createSttProvider(config)).toThrow(
      "Volcengine STT requires volcengine config",
    );
  });

  it("throws when volcengine appKey is empty", () => {
    const config: SttConfig = {
      provider: "volcengine",
      volcengine: { appKey: "", accessKey: "key" },
    };
    expect(() => createSttProvider(config)).toThrow(
      "Volcengine STT requires both appKey and accessKey",
    );
  });

  it("throws when volcengine accessKey is empty", () => {
    const config: SttConfig = {
      provider: "volcengine",
      volcengine: { appKey: "key", accessKey: "" },
    };
    expect(() => createSttProvider(config)).toThrow(
      "Volcengine STT requires both appKey and accessKey",
    );
  });
});

// ─── GroqSttProvider ────────────────────────────────────────────────────────

describe("GroqSttProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("sends correct multipart request and returns parsed text", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ text: "Hello, world!" }),
      text: async () => "",
    } as unknown as Response;

    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = fetchMock;

    const provider = new GroqSttProvider("test-api-key");
    const audio = Buffer.from("fake audio data");
    const result = await provider.transcribe(audio, "wav");

    expect(result.text).toBe("Hello, world!");
    expect(result.provider).toBe("groq");
    expect(result.durationMs).toBeTypeOf("number");

    // Verify fetch was called correctly
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(options.method).toBe("POST");
    expect(
      (options.headers as Record<string, string>)["Authorization"],
    ).toBe("Bearer test-api-key");

    // Verify body is FormData
    expect(options.body).toBeInstanceOf(FormData);
    const formData = options.body as FormData;
    expect(formData.get("model")).toBe("whisper-large-v3-turbo");
    expect(formData.get("response_format")).toBe("json");
    expect(formData.get("file")).toBeInstanceOf(Blob);
  });

  it("throws on unsupported audio format", async () => {
    const provider = new GroqSttProvider("test-api-key");
    const audio = Buffer.from("fake");
    await expect(provider.transcribe(audio, "aac")).rejects.toThrow(
      'Unsupported audio format "aac"',
    );
  });

  it("throws when audio file exceeds 25 MB", async () => {
    const provider = new GroqSttProvider("test-api-key");
    const bigAudio = Buffer.alloc(26 * 1024 * 1024); // 26 MB
    await expect(provider.transcribe(bigAudio, "wav")).rejects.toThrow(
      "Audio file too large",
    );
  });

  it("throws on HTTP error from Groq API", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "Unauthorized",
    } as unknown as Response;

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const provider = new GroqSttProvider("bad-key");
    const audio = Buffer.from("fake audio");
    await expect(provider.transcribe(audio, "mp3")).rejects.toThrow(
      "Groq transcription failed: HTTP 401",
    );
  });
});

// ─── VolcengineSttProvider ──────────────────────────────────────────────────

describe("VolcengineSttProvider", () => {
  const originalFetch = globalThis.fetch;

  /** Helper to create a mock Response with headers */
  function mockResponse(opts: {
    ok: boolean;
    status: number;
    statusCode?: string;
    message?: string;
    json?: unknown;
    text?: string;
  }): Response {
    const headers = new Headers();
    if (opts.statusCode !== undefined)
      headers.set("x-api-status-code", opts.statusCode);
    if (opts.message !== undefined)
      headers.set("x-api-message", opts.message);
    return {
      ok: opts.ok,
      status: opts.status,
      headers,
      json: async () => opts.json ?? {},
      text: async () => opts.text ?? "",
    } as unknown as Response;
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("submits audio and polls until completion, returning text", { timeout: 15_000 }, async () => {
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      callIndex++;
      if (url.includes("submit")) {
        return mockResponse({
          ok: true,
          status: 200,
          statusCode: "20000000",
          message: "ok",
        });
      }
      // First query: still processing
      if (callIndex === 2) {
        return mockResponse({
          ok: true,
          status: 200,
          statusCode: "40000003",
          message: "processing",
        });
      }
      // Second query: done
      return mockResponse({
        ok: true,
        status: 200,
        statusCode: "20000000",
        message: "ok",
        json: { result: { text: "Transcribed text from Volcengine" } },
      });
    });

    globalThis.fetch = fetchMock;

    const provider = new VolcengineSttProvider("app-key", "access-key");
    const audio = Buffer.from("fake audio data");
    const result = await provider.transcribe(audio, "wav");

    expect(result.text).toBe("Transcribed text from Volcengine");
    expect(result.provider).toBe("volcengine");
    expect(result.durationMs).toBeTypeOf("number");

    // Verify submit call
    expect(fetchMock).toHaveBeenCalledTimes(3); // submit + 2 queries
    const [submitUrl, submitOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(submitUrl).toBe(
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit",
    );
    expect(submitOptions.method).toBe("POST");
    const submitHeaders = submitOptions.headers as Record<string, string>;
    expect(submitHeaders["X-Api-App-Key"]).toBe("app-key");
    expect(submitHeaders["X-Api-Access-Key"]).toBe("access-key");
    expect(submitHeaders["X-Api-Resource-Id"]).toBe("volc.seedasr.auc");

    // Verify body contains base64 audio data
    const submitBody = JSON.parse(submitOptions.body as string);
    expect(submitBody.audio.data).toBe(audio.toString("base64"));
    expect(submitBody.audio.format).toBe("wav");
    expect(submitBody.request.model_name).toBe("bigmodel");
  });

  it("returns concatenated utterances when text field is absent", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("submit")) {
        return mockResponse({
          ok: true,
          status: 200,
          statusCode: "20000000",
          message: "ok",
        });
      }
      return mockResponse({
        ok: true,
        status: 200,
        statusCode: "20000000",
        message: "ok",
        json: {
          result: {
            utterances: [{ text: "Hello " }, { text: "world" }],
          },
        },
      });
    });

    globalThis.fetch = fetchMock;

    const provider = new VolcengineSttProvider("app", "key");
    const result = await provider.transcribe(Buffer.from("audio"), "mp3");
    expect(result.text).toBe("Hello world");
  });

  it("throws on submit HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 500,
        statusCode: "50000000",
        message: "Internal Server Error",
        text: "Internal Server Error",
      }),
    );

    const provider = new VolcengineSttProvider("app", "key");
    await expect(
      provider.transcribe(Buffer.from("audio"), "wav"),
    ).rejects.toThrow("Volcengine submit failed: HTTP 500");
  });

  it("throws on submit API error (bad status code)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        status: 200,
        statusCode: "40000001",
        message: "Invalid request",
        text: "",
      }),
    );

    const provider = new VolcengineSttProvider("app", "key");
    await expect(
      provider.transcribe(Buffer.from("audio"), "wav"),
    ).rejects.toThrow("Volcengine submit failed: HTTP 200");
  });

  it("throws on query HTTP error", async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        // submit succeeds
        return mockResponse({
          ok: true,
          status: 200,
          statusCode: "20000000",
          message: "ok",
        });
      }
      // query fails
      return mockResponse({
        ok: false,
        status: 503,
        statusCode: "50300000",
        message: "Service Unavailable",
        text: "Service Unavailable",
      });
    });

    const provider = new VolcengineSttProvider("app", "key");
    await expect(
      provider.transcribe(Buffer.from("audio"), "wav"),
    ).rejects.toThrow("Volcengine query failed: HTTP 503");
  });

  it("throws on query API error (unexpected status code)", async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return mockResponse({
          ok: true,
          status: 200,
          statusCode: "20000000",
          message: "ok",
        });
      }
      return mockResponse({
        ok: true,
        status: 200,
        statusCode: "40000099",
        message: "Processing failed",
        text: "",
      });
    });

    const provider = new VolcengineSttProvider("app", "key");
    await expect(
      provider.transcribe(Buffer.from("audio"), "wav"),
    ).rejects.toThrow("Volcengine query failed: HTTP 200");
  });
});
