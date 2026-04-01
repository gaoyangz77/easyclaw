import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiContext } from "../api-context.js";
import { handleCloudGraphqlRoutes } from "../cloud-graphql-routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(method: string, body?: unknown): IncomingMessage {
  const readable = new Readable({ read() {} });
  if (body !== undefined) {
    readable.push(JSON.stringify(body));
  }
  readable.push(null);
  (readable as any).method = method;
  (readable as any).headers = {};
  return readable as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: null as unknown,
    writeHead(status: number, _headers?: Record<string, string>) {
      res._status = status;
      return res;
    },
    end(data?: string) {
      if (data) res._body = JSON.parse(data);
    },
  } as unknown as ServerResponse & { _status: number; _body: unknown };
  return res;
}

function makeUrl(path: string): URL {
  return new URL(`http://localhost${path}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCloudGraphqlRoutes", () => {
  const pathname = "/api/cloud/graphql";

  it("returns false for non-matching routes", async () => {
    const req = makeReq("POST", { query: "{ me { id } }" });
    const res = makeRes();
    const ctx = {} as ApiContext;
    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl("/api/other"), "/api/other", ctx);
    expect(handled).toBe(false);
  });

  it("returns false for non-POST requests", async () => {
    const req = makeReq("GET");
    const res = makeRes();
    const ctx = {} as ApiContext;
    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);
    expect(handled).toBe(false);
  });

  it("returns 200 with errors when authSession is not available", async () => {
    const req = makeReq("POST", { query: "{ me { id } }" });
    const res = makeRes();
    const ctx = {} as ApiContext;

    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ errors: [{ message: "Auth session not ready" }] });
  });

  it("returns 200 with errors when body is missing query field", async () => {
    const req = makeReq("POST", { variables: {} });
    const res = makeRes();
    const ctx = {
      authSession: { getAccessToken: () => "valid-token" },
    } as unknown as ApiContext;

    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ errors: [{ message: "Missing query" }] });
  });

  it("forwards public queries without token (transparent proxy)", async () => {
    const mockData = { skills: [{ slug: "1password" }] };
    const req = makeReq("POST", { query: "{ skills { slug } }" });
    const res = makeRes();
    const ctx = {
      authSession: {
        getAccessToken: () => null,
        graphqlFetch: vi.fn().mockResolvedValue(mockData),
      },
    } as unknown as ApiContext;

    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ data: mockData });
  });

  it("returns { data } on successful graphqlFetch", async () => {
    const mockData = { me: { id: "1", email: "test@example.com" } };
    const req = makeReq("POST", { query: "{ me { id email } }" });
    const res = makeRes();
    const ctx = {
      authSession: {
        getAccessToken: () => "valid-token",
        graphqlFetch: vi.fn().mockResolvedValue(mockData),
      },
    } as unknown as ApiContext;

    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ data: mockData });
  });

  it("returns 200 with errors on auth-related errors", async () => {
    const req = makeReq("POST", { query: "{ me { id } }" });
    const res = makeRes();
    const ctx = {
      authSession: {
        getAccessToken: () => "expired-token",
        graphqlFetch: vi.fn().mockRejectedValue(new Error("Token expired")),
      },
    } as unknown as ApiContext;

    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ errors: [{ message: "Token expired" }] });
  });

  it("returns 200 with errors for 'Not authenticated'", async () => {
    const req = makeReq("POST", { query: "{ me { id } }" });
    const res = makeRes();
    const ctx = {
      authSession: {
        getAccessToken: () => null,
        graphqlFetch: vi.fn().mockRejectedValue(new Error("Not authenticated")),
      },
    } as unknown as ApiContext;

    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ errors: [{ message: "Not authenticated" }] });
  });

  it("returns 200 with errors on non-auth errors", async () => {
    const req = makeReq("POST", { query: "{ shop { id } }" });
    const res = makeRes();
    const ctx = {
      authSession: {
        getAccessToken: () => "valid-token",
        graphqlFetch: vi.fn().mockRejectedValue(new Error("Internal server error")),
      },
    } as unknown as ApiContext;

    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ errors: [{ message: "Internal server error" }] });
  });

  it("handles non-Error thrown values", async () => {
    const req = makeReq("POST", { query: "{ me { id } }" });
    const res = makeRes();
    const ctx = {
      authSession: {
        getAccessToken: () => "valid-token",
        graphqlFetch: vi.fn().mockRejectedValue("string-error"),
      },
    } as unknown as ApiContext;

    const handled = await handleCloudGraphqlRoutes(req, res, makeUrl(pathname), pathname, ctx);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ errors: [{ message: "Cloud GraphQL request failed" }] });
  });
});
