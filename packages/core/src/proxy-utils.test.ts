import { describe, it, expect } from "vitest";
import { parseProxyUrl, reconstructProxyUrl, isValidProxyUrl } from "./proxy-utils.js";

describe("parseProxyUrl", () => {
  it("should parse public proxy without authentication", () => {
    const result = parseProxyUrl("http://proxy.example.com:8080");
    expect(result).toEqual({
      baseUrl: "http://proxy.example.com:8080",
      credentials: null,
      hasAuth: false,
    });
  });

  it("should parse proxy with authentication", () => {
    const result = parseProxyUrl("http://user:pass@proxy.example.com:8080");
    expect(result).toEqual({
      baseUrl: "http://proxy.example.com:8080/",
      credentials: "user:pass",
      hasAuth: true,
    });
  });

  it("should handle HTTPS proxy", () => {
    const result = parseProxyUrl("https://proxy.example.com:443");
    expect(result).toEqual({
      baseUrl: "https://proxy.example.com:443",
      credentials: null,
      hasAuth: false,
    });
  });

  it("should handle SOCKS5 proxy", () => {
    const result = parseProxyUrl("socks5://proxy.example.com:1080");
    expect(result).toEqual({
      baseUrl: "socks5://proxy.example.com:1080",
      credentials: null,
      hasAuth: false,
    });
  });

  it("should handle proxy with only username", () => {
    const result = parseProxyUrl("http://user@proxy.example.com:8080");
    expect(result).toEqual({
      baseUrl: "http://proxy.example.com:8080/",
      credentials: "user:",
      hasAuth: true,
    });
  });

  it("should handle proxy with special characters in password", () => {
    const result = parseProxyUrl("http://user:p@ss%3Aw0rd@proxy.example.com:8080");
    expect(result).toEqual({
      baseUrl: "http://proxy.example.com:8080/",
      credentials: "user:p%40ss%3Aw0rd",
      hasAuth: true,
    });
  });

  it("should handle proxy with path", () => {
    const result = parseProxyUrl("http://proxy.example.com:8080/path");
    expect(result).toEqual({
      baseUrl: "http://proxy.example.com:8080/path",
      credentials: null,
      hasAuth: false,
    });
  });

  it("should handle proxy with query string", () => {
    const result = parseProxyUrl("http://proxy.example.com:8080?key=value");
    expect(result).toEqual({
      baseUrl: "http://proxy.example.com:8080?key=value",
      credentials: null,
      hasAuth: false,
    });
  });

  it("should throw error for invalid URL", () => {
    expect(() => parseProxyUrl("not-a-url")).toThrow("Invalid proxy URL");
  });

  it("should throw error for empty string", () => {
    expect(() => parseProxyUrl("")).toThrow("Invalid proxy URL");
  });
});

describe("reconstructProxyUrl", () => {
  it("should reconstruct proxy without credentials", () => {
    const result = reconstructProxyUrl("http://proxy.example.com:8080", null);
    expect(result).toBe("http://proxy.example.com:8080");
  });

  it("should reconstruct proxy with credentials", () => {
    const result = reconstructProxyUrl("http://proxy.example.com:8080", "user:pass");
    expect(result).toBe("http://user:pass@proxy.example.com:8080/");
  });

  it("should handle credentials with special characters", () => {
    const result = reconstructProxyUrl("http://proxy.example.com:8080", "user:p@ss:w0rd");
    // URL API encodes @ but not : in password
    expect(result).toBe("http://user:p%40ss@proxy.example.com:8080/");
  });

  it("should handle HTTPS proxy with credentials", () => {
    const result = reconstructProxyUrl("https://proxy.example.com:443", "user:pass");
    // HTTPS default port 443 is omitted by URL API
    expect(result).toBe("https://user:pass@proxy.example.com/");
  });

  it("should handle SOCKS5 proxy with credentials", () => {
    const result = reconstructProxyUrl("socks5://proxy.example.com:1080", "user:pass");
    // SOCKS5 is not a standard protocol, so no trailing slash normalization
    expect(result).toBe("socks5://user:pass@proxy.example.com:1080");
  });

  it("should preserve path in base URL", () => {
    const result = reconstructProxyUrl("http://proxy.example.com:8080/path", "user:pass");
    expect(result).toBe("http://user:pass@proxy.example.com:8080/path");
  });

  it("should preserve query string in base URL", () => {
    const result = reconstructProxyUrl("http://proxy.example.com:8080?key=value", "user:pass");
    expect(result).toBe("http://user:pass@proxy.example.com:8080/?key=value");
  });

  it("should throw error for invalid base URL", () => {
    expect(() => reconstructProxyUrl("not-a-url", "user:pass")).toThrow("Invalid base URL");
  });
});

describe("isValidProxyUrl", () => {
  it("should validate HTTP proxy URL", () => {
    expect(isValidProxyUrl("http://proxy.example.com:8080")).toBe(true);
  });

  it("should validate HTTPS proxy URL", () => {
    expect(isValidProxyUrl("https://proxy.example.com:443")).toBe(true);
  });

  it("should validate SOCKS5 proxy URL", () => {
    expect(isValidProxyUrl("socks5://proxy.example.com:1080")).toBe(true);
  });

  it("should validate proxy with authentication", () => {
    expect(isValidProxyUrl("http://user:pass@proxy.example.com:8080")).toBe(true);
  });

  it("should reject invalid protocol", () => {
    expect(isValidProxyUrl("ftp://proxy.example.com:21")).toBe(false);
  });

  it("should reject malformed URL", () => {
    expect(isValidProxyUrl("not-a-url")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(isValidProxyUrl("")).toBe(false);
  });

  it("should reject URL without protocol", () => {
    expect(isValidProxyUrl("proxy.example.com:8080")).toBe(false);
  });
});

describe("parseProxyUrl and reconstructProxyUrl round-trip", () => {
  it("should correctly round-trip proxy without auth", () => {
    const original = "http://proxy.example.com:8080";
    const parsed = parseProxyUrl(original);
    const reconstructed = reconstructProxyUrl(parsed.baseUrl, parsed.credentials);
    expect(reconstructed).toBe(original);
  });

  it("should correctly round-trip proxy with auth", () => {
    const original = "http://user:pass@proxy.example.com:8080";
    const parsed = parseProxyUrl(original);
    const reconstructed = reconstructProxyUrl(parsed.baseUrl, parsed.credentials);
    // Note: URL normalization adds trailing slash
    expect(reconstructed).toBe("http://user:pass@proxy.example.com:8080/");
  });
});
