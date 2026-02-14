import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { createStorage, type Storage } from "@easyclaw/storage";
import { startPanelServer } from "./panel-server.js";

let server: Server;
let storage: Storage;
let baseUrl: string;
const ruleChanges: Array<{ action: string; ruleId: string }> = [];

/**
 * Helper to find the randomly-assigned port after the server starts listening.
 */
function getPort(srv: Server): number {
  const addr = srv.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("Server not listening");
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(baseUrl + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

beforeAll(async () => {
  storage = createStorage(":memory:");

  server = startPanelServer({
    port: 0, // random port
    panelDistDir: "/tmp/nonexistent-panel-dist", // no static files needed for API tests
    storage,
    secretStore: { get: async () => null, set: async () => {}, delete: async () => {} } as any,
    onRuleChange: (action, ruleId) => {
      ruleChanges.push({ action, ruleId });
    },
  });

  // Wait for server to start listening
  await new Promise<void>((resolve) => {
    server.on("listening", resolve);
  });

  baseUrl = `http://127.0.0.1:${getPort(server)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  storage.close();
});

describe("panel-server API", () => {
  // --- Status ---
  describe("GET /api/status", () => {
    it("returns ok status with counts", async () => {
      const { status, body } = await fetchJson<{ status: string; ruleCount: number; artifactCount: number }>("/api/status");
      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.ruleCount).toBe(0);
      expect(body.artifactCount).toBe(0);
    });
  });

  // --- Rules CRUD ---
  describe("Rules CRUD", () => {
    let createdRuleId: string;

    it("POST /api/rules creates a rule", async () => {
      const { status, body } = await fetchJson<{ id: string; text: string; createdAt: string; updatedAt: string }>("/api/rules", {
        method: "POST",
        body: JSON.stringify({ text: "Never access /etc/shadow" }),
      });

      expect(status).toBe(201);
      expect(body.id).toBeTruthy();
      expect(body.text).toBe("Never access /etc/shadow");
      expect(body.createdAt).toBeTruthy();
      expect(body.updatedAt).toBeTruthy();
      createdRuleId = body.id;
    });

    it("POST /api/rules returns 400 for missing text", async () => {
      const { status, body } = await fetchJson<{ error: string }>("/api/rules", {
        method: "POST",
        body: JSON.stringify({}),
      });

      expect(status).toBe(400);
      expect(body.error).toContain("text");
    });

    it("GET /api/rules returns the created rule", async () => {
      const { status, body } = await fetchJson<{ rules: Array<{ id: string; text: string; artifactStatus?: string; artifactType?: string }> }>("/api/rules");

      expect(status).toBe(200);
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0].id).toBe(createdRuleId);
      expect(body.rules[0].text).toBe("Never access /etc/shadow");
      // No artifacts yet, so these should be undefined
      expect(body.rules[0].artifactStatus).toBeUndefined();
      expect(body.rules[0].artifactType).toBeUndefined();
    });

    it("GET /api/rules returns rules with artifact status when artifacts exist", async () => {
      // Create an artifact for the rule
      storage.artifacts.create({
        id: "artifact-1",
        ruleId: createdRuleId,
        type: "policy-fragment",
        content: "compiled policy content",
        status: "ok",
        compiledAt: new Date().toISOString(),
      });

      const { status, body } = await fetchJson<{ rules: Array<{ id: string; artifactStatus?: string; artifactType?: string }> }>("/api/rules");

      expect(status).toBe(200);
      expect(body.rules[0].artifactStatus).toBe("ok");
      expect(body.rules[0].artifactType).toBe("policy-fragment");

      // Clean up the artifact
      storage.artifacts.deleteByRuleId(createdRuleId);
    });

    it("PUT /api/rules/:id updates a rule", async () => {
      const { status, body } = await fetchJson<{ id: string; text: string }>(
        `/api/rules/${createdRuleId}`,
        {
          method: "PUT",
          body: JSON.stringify({ text: "Updated: never access /etc/passwd" }),
        },
      );

      expect(status).toBe(200);
      expect(body.id).toBe(createdRuleId);
      expect(body.text).toBe("Updated: never access /etc/passwd");
    });

    it("PUT /api/rules/:id returns 404 for non-existent rule", async () => {
      const { status, body } = await fetchJson<{ error: string }>(
        "/api/rules/non-existent-id",
        {
          method: "PUT",
          body: JSON.stringify({ text: "some text" }),
        },
      );

      expect(status).toBe(404);
      expect(body.error).toContain("not found");
    });

    it("PUT /api/rules/:id returns 400 for missing text", async () => {
      const { status, body } = await fetchJson<{ error: string }>(
        `/api/rules/${createdRuleId}`,
        {
          method: "PUT",
          body: JSON.stringify({}),
        },
      );

      expect(status).toBe(400);
      expect(body.error).toContain("text");
    });

    it("DELETE /api/rules/:id deletes a rule", async () => {
      const { status, body } = await fetchJson<{ ok: boolean }>(
        `/api/rules/${createdRuleId}`,
        { method: "DELETE" },
      );

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { body: listBody } = await fetchJson<{ rules: unknown[] }>("/api/rules");
      expect(listBody.rules).toHaveLength(0);
    });

    it("DELETE /api/rules/:id returns 404 for non-existent rule", async () => {
      const { status, body } = await fetchJson<{ error: string }>(
        "/api/rules/non-existent-id",
        { method: "DELETE" },
      );

      expect(status).toBe(404);
      expect(body.error).toContain("not found");
    });
  });

  // --- onRuleChange callback ---
  describe("onRuleChange callback", () => {
    it("fires on create, update, and delete", async () => {
      ruleChanges.length = 0; // reset

      // Create
      const { body: created } = await fetchJson<{ id: string }>("/api/rules", {
        method: "POST",
        body: JSON.stringify({ text: "test callback rule" }),
      });

      // Update
      await fetchJson(`/api/rules/${created.id}`, {
        method: "PUT",
        body: JSON.stringify({ text: "updated callback rule" }),
      });

      // Delete
      await fetchJson(`/api/rules/${created.id}`, {
        method: "DELETE",
      });

      expect(ruleChanges).toEqual([
        { action: "created", ruleId: created.id },
        { action: "updated", ruleId: created.id },
        { action: "deleted", ruleId: created.id },
      ]);
    });
  });

  // --- Settings ---
  describe("Settings", () => {
    it("GET /api/settings returns default settings initially", async () => {
      const { status, body } = await fetchJson<{ settings: Record<string, string> }>("/api/settings");
      expect(status).toBe(200);
      expect(body.settings).toEqual({
        "file-permissions-full-access": "true",
      });
    });

    it("PUT /api/settings stores settings", async () => {
      const { status } = await fetchJson("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ theme: "dark", locale: "zh-CN" }),
      });
      expect(status).toBe(200);

      const { body } = await fetchJson<{ settings: Record<string, string> }>("/api/settings");
      expect(body.settings.theme).toBe("dark");
      expect(body.settings.locale).toBe("zh-CN");
    });

    it("PUT /api/settings overwrites existing keys", async () => {
      await fetchJson("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ theme: "light" }),
      });

      const { body } = await fetchJson<{ settings: Record<string, string> }>("/api/settings");
      expect(body.settings.theme).toBe("light");
      expect(body.settings.locale).toBe("zh-CN"); // unchanged
    });
  });

  // --- Permissions ---
  describe("Permissions", () => {
    it("GET /api/permissions returns default empty permissions", async () => {
      const { status, body } = await fetchJson<{ permissions: { readPaths: string[]; writePaths: string[] } }>("/api/permissions");
      expect(status).toBe(200);
      expect(body.permissions.readPaths).toEqual([]);
      expect(body.permissions.writePaths).toEqual([]);
    });

    it("PUT /api/permissions updates permissions", async () => {
      const { status } = await fetchJson("/api/permissions", {
        method: "PUT",
        body: JSON.stringify({
          readPaths: ["/home/user/docs"],
          writePaths: ["/home/user/output"],
        }),
      });
      expect(status).toBe(200);

      const { body } = await fetchJson<{ permissions: { readPaths: string[]; writePaths: string[] } }>("/api/permissions");
      expect(body.permissions.readPaths).toEqual(["/home/user/docs"]);
      expect(body.permissions.writePaths).toEqual(["/home/user/output"]);
    });
  });

  // --- Channels ---
  describe("Channels", () => {
    it("GET /api/channels returns empty channels initially", async () => {
      const { status, body } = await fetchJson<{ channels: unknown[] }>("/api/channels");
      expect(status).toBe(200);
      expect(body.channels).toEqual([]);
    });
  });

  // --- Status with data ---
  describe("Status with data", () => {
    it("reflects correct rule and artifact counts", async () => {
      // Create two rules
      const { body: r1 } = await fetchJson<{ id: string }>("/api/rules", {
        method: "POST",
        body: JSON.stringify({ text: "rule one" }),
      });
      const { body: r2 } = await fetchJson<{ id: string }>("/api/rules", {
        method: "POST",
        body: JSON.stringify({ text: "rule two" }),
      });

      // Create an artifact
      storage.artifacts.create({
        id: "art-status-1",
        ruleId: r1.id,
        type: "guard",
        content: "guard content",
        status: "ok",
        compiledAt: new Date().toISOString(),
      });

      const { body } = await fetchJson<{ status: string; ruleCount: number; artifactCount: number }>("/api/status");
      expect(body.status).toBe("ok");
      expect(body.ruleCount).toBeGreaterThanOrEqual(2);
      expect(body.artifactCount).toBeGreaterThanOrEqual(1);

      // Cleanup
      storage.artifacts.deleteByRuleId(r1.id);
      await fetchJson(`/api/rules/${r1.id}`, { method: "DELETE" });
      await fetchJson(`/api/rules/${r2.id}`, { method: "DELETE" });
    });
  });

  // --- 404 for unknown routes ---
  describe("404 handling", () => {
    it("returns 404 for unknown API routes", async () => {
      const { status, body } = await fetchJson<{ error: string }>("/api/unknown");
      expect(status).toBe(404);
      expect(body.error).toBe("Not found");
    });
  });

  // --- CORS ---
  describe("CORS", () => {
    it("responds to OPTIONS with 204", async () => {
      const res = await fetch(baseUrl + "/api/rules", { method: "OPTIONS" });
      expect(res.status).toBe(204);
    });

    it("includes CORS headers on responses", async () => {
      const res = await fetch(baseUrl + "/api/status");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  // --- DELETE /api/rules/:id also deletes artifacts ---
  describe("Rule deletion cascades to artifacts", () => {
    it("deletes artifacts when rule is deleted", async () => {
      const { body: rule } = await fetchJson<{ id: string }>("/api/rules", {
        method: "POST",
        body: JSON.stringify({ text: "rule with artifact" }),
      });

      storage.artifacts.create({
        id: "art-cascade-1",
        ruleId: rule.id,
        type: "action-bundle",
        content: "bundle content",
        status: "pending",
        compiledAt: new Date().toISOString(),
      });

      // Verify artifact exists
      expect(storage.artifacts.getByRuleId(rule.id)).toHaveLength(1);

      // Delete the rule
      await fetchJson(`/api/rules/${rule.id}`, { method: "DELETE" });

      // Verify artifact is gone
      expect(storage.artifacts.getByRuleId(rule.id)).toHaveLength(0);
    });
  });
});
