/**
 * E2E tests for Local LLM (Ollama) support.
 *
 * Starts a mock Ollama HTTP server, then launches the real Electron app
 * and exercises the full UI flow: navigate → configure → save → verify →
 * update → remove, plus API endpoint validation.
 */
import { test, expect } from "./electron-fixture.js";
import { createServer, type Server } from "node:http";

// ---------------------------------------------------------------------------
// Mock Ollama server
// ---------------------------------------------------------------------------

const MOCK_VERSION = "0.5.7";
const MOCK_MODELS = [
  { name: "llama3.2:latest", model: "llama3.2:latest", size: 2_000_000_000 },
  { name: "qwen2.5:7b", model: "qwen2.5:7b", size: 4_000_000_000 },
  { name: "deepseek-r1:latest", model: "deepseek-r1:latest", size: 8_000_000_000 },
];

let mockOllamaServer: Server;
let mockOllamaPort: number;

function startMockOllama(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/api/version") {
        res.end(JSON.stringify({ version: MOCK_VERSION }));
        return;
      }

      if (req.url === "/api/tags") {
        res.end(JSON.stringify({ models: MOCK_MODELS }));
        return;
      }

      if (req.url?.startsWith("/v1/chat/completions")) {
        res.end(
          JSON.stringify({
            id: "mock-001",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Hello from mock Ollama!" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  const { server, port } = await startMockOllama();
  mockOllamaServer = server;
  mockOllamaPort = port;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    mockOllamaServer.close((err) => (err ? reject(err) : resolve()));
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Local Models E2E", () => {
  /** Helper: dismiss any blocking modals, then navigate to the Models page. */
  async function navigateToModels(window: import("@playwright/test").Page) {
    for (let i = 0; i < 3; i++) {
      const backdrop = window.locator(".modal-backdrop");
      if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
      await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
    }

    const modelsBtn = window.locator(".nav-btn", { hasText: "Models" });
    await modelsBtn.click();
    await expect(modelsBtn).toHaveClass(/nav-active/);
  }

  // ── Test 1: Tab rendering, health check, and model fetching ─────────

  test("Local LLM tab renders and connects to mock Ollama", async ({ window }) => {
    await navigateToModels(window);

    const form = window.locator(".page-two-col");

    // -- Click "Local LLM" tab --
    const localTab = form.locator(".tab-btn", { hasText: /Local/i });
    await localTab.click();
    await expect(localTab).toHaveClass(/tab-btn-active/);

    // Subscription and API tabs should NOT be active
    const subTab = form.locator(".tab-btn", { hasText: /Subscription/i });
    const apiTab = form.locator(".tab-btn", { hasText: /API/i });
    await expect(subTab).not.toHaveClass(/tab-btn-active/);
    await expect(apiTab).not.toHaveClass(/tab-btn-active/);

    // -- Verify form elements --
    // Base URL input (default "localhost:11434", but auto-detect may resolve to "127.0.0.1")
    const baseUrlInput = form.locator("input.input-mono[type='text']").first();
    await expect(baseUrlInput).toBeVisible();
    await expect(baseUrlInput).toHaveValue(/^http:\/\/(localhost|127\.0\.0\.1):11434$/);

    // "Server URL" label
    await expect(form.locator(".form-label", { hasText: /Server URL/i })).toBeVisible();

    // "Model" label
    await expect(form.locator(".form-label", { hasText: /Model/i })).toBeVisible();

    // Save button (should be disabled — no model selected yet)
    const saveBtn = form.locator(".form-actions .btn.btn-primary");
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    // Info box on the right side (Ollama setup instructions)
    const infoBox = window.locator(".page-col-side .info-box-blue");
    await expect(infoBox).toBeVisible();
    await expect(infoBox).toContainText(/Ollama/i);

    // -- Type mock Ollama URL and verify connectivity --
    await baseUrlInput.fill(`http://127.0.0.1:${mockOllamaPort}`);

    // Wait for debounce (1.5s) + health check to complete
    const healthBadge = form.locator(".badge-success");
    await expect(healthBadge).toBeVisible({ timeout: 10_000 });
    await expect(healthBadge).toContainText("Connected");

    // -- Verify model select populated with options --
    const modelSelect = form.locator("select.input-full.input-mono");
    await expect(modelSelect).toBeVisible({ timeout: 5_000 });
    const options = modelSelect.locator("option");
    await expect(options).toHaveCount(3);

    // -- Select a model → save button should become enabled --
    await modelSelect.selectOption("llama3.2:latest");
    await expect(saveBtn).toBeEnabled();
  });

  // ── Test 2: Full lifecycle — add, verify, update URL, remove ────────

  test("full local key lifecycle: add, verify card, update URL, remove", async ({ window }) => {
    await navigateToModels(window);

    // Count pre-existing keys (the fixture may seed one when E2E_VOLCENGINE_API_KEY is set)
    const keyCards = window.locator(".key-card");
    const initialCount = await keyCards.count();

    const form = window.locator(".page-two-col");

    // --- Step 1: Fill the Local LLM form ---
    await form.locator(".tab-btn", { hasText: /Local/i }).click();

    const baseUrlInput = form.locator("input.input-mono[type='text']").first();
    const mockUrl = `http://127.0.0.1:${mockOllamaPort}`;
    await baseUrlInput.fill(mockUrl);

    // Wait for health check (1.5s debounce) + model fetch
    await expect(form.locator(".badge-success")).toBeVisible({ timeout: 15_000 });

    // Wait for model select to populate (should have 3 models from mock)
    const modelSelect = form.locator("select.input-full.input-mono");
    await expect(modelSelect.locator("option")).toHaveCount(3, { timeout: 5_000 });

    // Select model name
    await modelSelect.selectOption("llama3.2:latest");

    // Enter a custom label
    const labelInput = form.locator("input.input-full[type='text']");
    await labelInput.fill("My Local Ollama");

    // --- Step 2: Save ---
    const saveBtn = form.locator(".form-actions .btn.btn-primary");
    await saveBtn.click();

    // --- Step 3: Verify key card appears in Configured Keys section ---
    await expect(keyCards).toHaveCount(initialCount + 1, { timeout: 10_000 });

    // Find the newly created card by its label
    const card = window.locator(".key-card", { hasText: /My Local Ollama/i });
    await expect(card).toBeVisible();

    // Provider name: "Ollama"
    await expect(card.locator(".key-meta")).toContainText("Ollama");

    // Auth type badge: "Local"
    await expect(card.locator(".badge-muted")).toContainText("Local");

    // Base URL displayed in metadata
    await expect(card).toContainText(mockUrl);

    // Custom label displayed
    await expect(card.locator(".key-label")).toContainText("My Local Ollama");

    // --- Step 4: Update URL ---
    // Click "Update URL" (not "Update Key", since it's a local provider)
    const updateBtn = card.locator(".btn", { hasText: /Update/i });
    await updateBtn.click();

    // Expanded form should appear with base URL input
    const expandedForm = card.locator(".key-expanded");
    await expect(expandedForm).toBeVisible();

    const editUrlInput = expandedForm.locator("input.input-mono");
    await expect(editUrlInput).toBeVisible();
    await expect(editUrlInput).toHaveValue(mockUrl);

    // Change URL and save
    const newUrl = "http://192.168.1.100:11434";
    await editUrlInput.fill(newUrl);
    const editSaveBtn = expandedForm.locator(".btn.btn-primary");
    await editSaveBtn.click();

    // Wait for "Saved" indicator
    await expect(card.locator(".badge-saved")).toBeVisible({ timeout: 5_000 });

    // Verify the new URL is shown in the metadata
    await expect(card).toContainText(newUrl);

    // --- Step 5: Remove ---
    const removeBtn = card.locator(".btn-danger");
    await removeBtn.click();

    // Key card should disappear
    await expect(keyCards).toHaveCount(initialCount, { timeout: 10_000 });
  });

  // ── Test 3: Connection failure handling ─────────────────────────────

  test("connection failure shows error badge and manual model input", async ({ window }) => {
    await navigateToModels(window);

    const form = window.locator(".page-two-col");
    await form.locator(".tab-btn", { hasText: /Local/i }).click();

    // Type an unreachable URL
    const baseUrlInput = form.locator("input.input-mono[type='text']").first();
    await baseUrlInput.fill("http://127.0.0.1:1");

    // Wait for health check to fail (debounce + timeout)
    const failBadge = form.locator(".badge-danger");
    await expect(failBadge).toBeVisible({ timeout: 15_000 });
    await expect(failBadge).toContainText(/Cannot connect|connect/i);

    // Model select should be visible but only have the placeholder "—" option
    // since no models could be fetched from the unreachable server
    const modelSelect = form.locator("select.input-full.input-mono");
    await expect(modelSelect).toBeVisible();
    const options = modelSelect.locator("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText("—");

    // Save button should be disabled since no model can be selected
    const saveBtn = form.locator(".form-actions .btn.btn-primary");
    await expect(saveBtn).toBeDisabled();
  });

  // ── Test 4: API endpoint validation through the running app ─────────

  test("local model API endpoints respond correctly", async ({ window }) => {
    // Test detection endpoint
    const detectRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/local-models/detect");
      return { status: res.status, body: await res.json() };
    });
    expect(detectRes.status).toBe(200);
    expect(Array.isArray(detectRes.body.servers)).toBe(true);

    // Test model fetching from mock Ollama
    const modelsRes = await window.evaluate(async (port: number) => {
      const res = await fetch(
        `http://127.0.0.1:3210/api/local-models/models?baseUrl=${encodeURIComponent(`http://127.0.0.1:${port}`)}`,
      );
      return { status: res.status, body: await res.json() };
    }, mockOllamaPort);
    expect(modelsRes.status).toBe(200);
    expect(modelsRes.body.models).toHaveLength(3);
    expect(modelsRes.body.models[0].id).toBe("llama3.2:latest");
    expect(modelsRes.body.models[1].id).toBe("qwen2.5:7b");
    expect(modelsRes.body.models[2].id).toBe("deepseek-r1:latest");

    // Test model fetching without baseUrl → 400
    const noUrlRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/local-models/models");
      return { status: res.status };
    });
    expect(noUrlRes.status).toBe(400);

    // Test health check — reachable mock
    const healthOkRes = await window.evaluate(async (port: number) => {
      const res = await fetch("http://127.0.0.1:3210/api/local-models/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: `http://127.0.0.1:${port}` }),
      });
      return { status: res.status, body: await res.json() };
    }, mockOllamaPort);
    expect(healthOkRes.status).toBe(200);
    expect(healthOkRes.body.ok).toBe(true);
    expect(healthOkRes.body.version).toBe(MOCK_VERSION);

    // Test health check — unreachable server
    const healthFailRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/local-models/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: "http://127.0.0.1:1" }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(healthFailRes.status).toBe(200);
    expect(healthFailRes.body.ok).toBe(false);

    // Test provider key CRUD via API
    // Create a local key
    const createRes = await window.evaluate(async (port: number) => {
      const res = await fetch("http://127.0.0.1:3210/api/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "ollama",
          label: "API Test Ollama",
          model: "llama3.2:latest",
          authType: "local",
          baseUrl: `http://127.0.0.1:${port}`,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, mockOllamaPort);
    expect(createRes.status).toBe(201);
    expect(createRes.body.provider).toBe("ollama");
    expect(createRes.body.authType).toBe("local");
    expect(createRes.body.model).toBe("llama3.2:latest");
    const keyId = createRes.body.id as string;

    // List keys and verify local key appears with baseUrl
    const listRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/provider-keys");
      return { status: res.status, body: await res.json() };
    });
    expect(listRes.status).toBe(200);
    const localKey = listRes.body.keys.find((k: { id: string }) => k.id === keyId);
    expect(localKey).toBeDefined();
    expect(localKey.provider).toBe("ollama");
    expect(localKey.authType).toBe("local");
    expect(localKey.baseUrl).toBe(`http://127.0.0.1:${mockOllamaPort}`);

    // Update base URL
    const updateRes = await window.evaluate(async (id: string) => {
      const res = await fetch(`http://127.0.0.1:3210/api/provider-keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: "http://192.168.1.50:11434" }),
      });
      return { status: res.status, body: await res.json() };
    }, keyId);
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.baseUrl).toBe("http://192.168.1.50:11434");

    // Delete the key
    const deleteRes = await window.evaluate(async (id: string) => {
      const res = await fetch(`http://127.0.0.1:3210/api/provider-keys/${id}`, {
        method: "DELETE",
      });
      return { status: res.status };
    }, keyId);
    expect(deleteRes.status).toBe(200);

    // Verify key is gone
    const listAfterRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/provider-keys");
      return { status: res.status, body: await res.json() };
    });
    const deletedKey = listAfterRes.body.keys.find((k: { id: string }) => k.id === keyId);
    expect(deletedKey).toBeUndefined();
  });

  // ── Test 5: Seed local key via DB and verify display ────────────────

  test("seeded local key displays correctly with Local badge", async ({ window }) => {
    // Seed a local key via the panel API (goes through the Electron process's storage)
    const createRes = await window.evaluate(async (port: number) => {
      const res = await fetch("http://127.0.0.1:3210/api/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "ollama",
          label: "Seeded Ollama",
          model: "deepseek-r1:latest",
          authType: "local",
          baseUrl: `http://127.0.0.1:${port}`,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, mockOllamaPort);
    expect(createRes.status).toBe(201);
    const keyId = createRes.body.id as string;

    // Activate the key and set it as the default provider
    await window.evaluate(async (id: string) => {
      await fetch(`http://127.0.0.1:3210/api/provider-keys/${id}/activate`, { method: "POST" });
      await fetch("http://127.0.0.1:3210/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "llm-provider": "ollama" }),
      });
    }, keyId);

    // Creating a key + activating triggers gateway restarts. Wait for
    // them to settle, then reload so the Models page fetches fresh data.
    await window.waitForTimeout(3_000);
    await window.reload();
    await window.waitForSelector(".sidebar-brand", { timeout: 45_000 });

    // Navigate to Models page — the seeded key should appear
    await navigateToModels(window);

    // Wait for key cards to render
    const keyCards = window.locator(".key-card");
    await expect(keyCards.first()).toBeVisible({ timeout: 15_000 });

    // Find the seeded card
    const ollamaCard = window.locator(".key-card", { hasText: /Seeded Ollama/i });
    await expect(ollamaCard).toBeVisible();

    // Verify "Ollama" provider name
    await expect(ollamaCard.locator(".key-meta")).toContainText("Ollama");

    // Verify "Local" badge
    await expect(ollamaCard.locator(".badge-muted")).toContainText("Local");

    // Verify base URL displayed
    await expect(ollamaCard).toContainText(`http://127.0.0.1:${mockOllamaPort}`);

    // Verify it's active (is_default=1 and llm-provider=ollama)
    await expect(ollamaCard).toHaveClass(/key-card-active/);
    await expect(ollamaCard.locator(".badge-active")).toBeVisible();

    // Verify model is shown
    await expect(ollamaCard).toContainText("deepseek-r1");

    // Verify "Update URL" button (not "Update Key")
    const updateBtn = ollamaCard.locator(".btn-secondary", { hasText: /Update/i });
    await expect(updateBtn).toBeVisible();
    await expect(updateBtn).toContainText(/URL/i);
  });
});
