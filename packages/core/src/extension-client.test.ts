import { describe, it, expect, vi, beforeEach } from "vitest";
import { extensionGraphqlFetch, extensionRestFetch } from "./extension-client.js";
import { DEFAULTS } from "./defaults.js";

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("extensionGraphqlFetch", () => {
  it("sends POST with correct URL and body", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { hello: "world" } }),
    });

    const result = await extensionGraphqlFetch("query { hello }", { id: "1" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`http://127.0.0.1:${DEFAULTS.ports.panel}/api/cloud/graphql`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Request-Source": "extension" });
    expect(JSON.parse(init.body)).toEqual({ query: "query { hello }", variables: { id: "1" } });
    expect(result).toEqual({ data: { hello: "world" } });
  });

  it("throws on non-ok HTTP status", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(extensionGraphqlFetch("query { fail }")).rejects.toThrow(
      "GraphQL HTTP error: 500 Internal Server Error",
    );
  });

  it("sends request without variables when omitted", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: null }),
    });

    await extensionGraphqlFetch("query { hello }");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({ query: "query { hello }" });
  });
});

describe("extensionRestFetch", () => {
  it("sends request with correct URL and default headers", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: "ok" }),
    });

    const result = await extensionRestFetch("/api/test");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`http://127.0.0.1:${DEFAULTS.ports.panel}/api/test`);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(result).toEqual({ result: "ok" });
  });

  it("throws on non-ok HTTP status", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    });

    await expect(extensionRestFetch("/api/missing")).rejects.toThrow(
      "Extension REST error: 404 Not Found",
    );
  });

  it("merges custom init options with default headers", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ created: true }),
    });

    await extensionRestFetch("/api/create", {
      method: "POST",
      body: JSON.stringify({ name: "test" }),
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "test" }));
  });
});
