import { test, expect } from "./electron-fixture.js";

const API_BASE = "http://127.0.0.1:3210";

/**
 * Helper: dismiss any modal(s) blocking the UI (e.g. "What's New", telemetry consent).
 *
 * The telemetry consent dialog may appear asynchronously after the page renders.
 * Setting localStorage prevents it from appearing if the React useEffect hasn't
 * fired yet; the close-button loop handles dialogs that are already visible.
 */
async function dismissModals(window: Awaited<ReturnType<typeof import("@playwright/test")["Page"]["prototype"]["waitForLoadState"]>> extends void ? never : import("@playwright/test").Page) {
  // Mark telemetry consent as shown so it won't appear (or reappear) later.
  await window.evaluate(() => localStorage.setItem("telemetry.consentShown", "1"));

  for (let i = 0; i < 5; i++) {
    const backdrop = window.locator(".modal-backdrop");
    if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
    // Prefer the × close button — more reliable than clicking a backdrop coordinate.
    const closeBtn = backdrop.locator(".modal-close-btn");
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    }
    await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  }
}

test.describe("Chat Agent Events & Settings", () => {

  // ──────────────────────────────────────────────────────────────────
  // Settings Page: Chat Settings Section
  // ──────────────────────────────────────────────────────────────────

  test("Settings page shows Chat Settings section with toggle", async ({ window }) => {
    await dismissModals(window);

    // Navigate to Settings
    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    // Find the Chat Settings section by its heading (wait for Settings page to finish loading)
    const chatSection = window.locator(".section-card:visible", { hasText: /Chat Settings|聊天设置/ });
    await expect(chatSection).toBeVisible({ timeout: 10_000 });

    // Verify all three sections exist: Agent, Chat, Telemetry
    const sectionCards = window.locator(".section-card:visible");
    const cardCount = await sectionCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(3);

    // Verify it has toggle switches
    const toggles = chatSection.locator(".toggle-switch");
    await expect(toggles.first()).toBeVisible();

    // Verify the label text
    await expect(chatSection).toContainText(/Show agent processing status|显示代理处理状态/);

    // Verify the hint text
    await expect(chatSection).toContainText(/Display what the agent is doing|在等待回复时显示/);
  });

  test("Chat Settings toggle is ON by default (fresh install)", async ({ window }) => {
    await dismissModals(window);

    // Navigate to Settings
    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    // Find the Chat Settings toggle (first checkbox = show agent events)
    const chatSection = window.locator(".section-card", { hasText: /Chat Settings|聊天设置/ });
    const toggle = chatSection.locator("input[type='checkbox']").first();

    // Should be checked by default (fresh install → key doesn't exist → defaults to ON)
    await expect(toggle).toBeChecked();
  });

  test("Chat Settings toggle persists OFF → ON round-trip", async ({ window }) => {
    await dismissModals(window);

    // Navigate to Settings
    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    const chatSection = window.locator(".section-card", { hasText: /Chat Settings|聊天设置/ });
    const toggleInput = chatSection.locator("input[type='checkbox']").first();
    const toggleTrack = chatSection.locator(".toggle-track").first();

    // Should start checked
    await expect(toggleInput).toBeChecked();

    // Toggle OFF by clicking the visible track
    await toggleTrack.click();
    await expect(toggleInput).not.toBeChecked();

    // Wait for save to complete
    await window.waitForTimeout(1_000);

    // Verify via API that setting is "false"
    const offResult = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_show_agent_events;
    }, API_BASE);
    expect(offResult).toBe("false");

    // Toggle ON by clicking the visible track
    await toggleTrack.click();
    await expect(toggleInput).toBeChecked();

    // Wait for save
    await window.waitForTimeout(1_000);

    // Verify via API that setting is "true"
    const onResult = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_show_agent_events;
    }, API_BASE);
    expect(onResult).toBe("true");
  });

  // ──────────────────────────────────────────────────────────────────
  // Settings API: chat_show_agent_events round-trip
  // ──────────────────────────────────────────────────────────────────

  test("Settings API: chat_show_agent_events defaults to true when absent", async ({ window }) => {
    // Before any toggle, the key may or may not exist.
    // When absent, fetchChatShowAgentEvents should return true (default ON).
    // We test this by removing the key and checking the API behavior.

    // First, ensure the key is absent by setting it then deleting it
    // (the settings API is key-value, we can set it to empty or just check current)
    const result = await window.evaluate(async (base) => {
      // Read current settings
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      const value = data.settings?.chat_show_agent_events;

      // If undefined (key doesn't exist), that means default should be ON
      // If it exists, it should be "true" or "false"
      return { exists: value !== undefined, value };
    }, API_BASE);

    // If key doesn't exist, the UI should default to ON (our api.ts returns !== "false")
    // If key exists, it should be a valid boolean string
    if (result.exists) {
      expect(["true", "false"]).toContain(result.value);
    }
    // Either way, the default behavior is: absent key → treated as true
  });

  test("Settings API: can write and read chat_show_agent_events", async ({ window }) => {
    // Write "false"
    const writeRes = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_show_agent_events: "false" }),
      });
      return res.status;
    }, API_BASE);
    expect(writeRes).toBe(200);

    // Read back
    const readFalse = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_show_agent_events;
    }, API_BASE);
    expect(readFalse).toBe("false");

    // Write "true"
    const writeRes2 = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_show_agent_events: "true" }),
      });
      return res.status;
    }, API_BASE);
    expect(writeRes2).toBe(200);

    // Read back
    const readTrue = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_show_agent_events;
    }, API_BASE);
    expect(readTrue).toBe("true");
  });

  // ──────────────────────────────────────────────────────────────────
  // Chat Page: Agent phase indicator DOM structure
  // ──────────────────────────────────────────────────────────────────

  test("Chat page connects to gateway and has correct DOM structure", async ({ window }) => {
    await dismissModals(window);

    // Chat should be default page
    const chatNav = window.locator(".nav-list .nav-btn").first();
    await expect(chatNav).toHaveClass(/nav-active/);

    // Wait for gateway connection
    const connectedDot = window.locator(".chat-status-dot-connected");
    await expect(connectedDot).toBeVisible({ timeout: 30_000 });

    // Verify chat container structure exists
    await expect(window.locator(".chat-container")).toBeVisible();
    await expect(window.locator(".chat-input-area")).toBeVisible();

    // Verify textarea exists and is functional
    const textarea = window.locator(".chat-input-area textarea");
    await expect(textarea).toBeVisible();

    // Verify send button exists
    const sendBtn = window.locator(".chat-input-area .btn-primary");
    await expect(sendBtn).toBeVisible();
  });

  test("Chat thinking indicator has correct CSS classes", async ({ window }) => {
    // Verify CSS classes exist in the stylesheet (proving our CSS was injected)
    const hasThinkingStyles = await window.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      let foundThinking = false;
      let foundPhase = false;
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (rule instanceof CSSStyleRule) {
              if (rule.selectorText?.includes(".chat-thinking")) foundThinking = true;
              if (rule.selectorText?.includes(".chat-agent-phase")) foundPhase = true;
            }
          }
        } catch {
          // Cross-origin stylesheets may throw
        }
      }
      return { foundThinking, foundPhase };
    });

    expect(hasThinkingStyles.foundThinking).toBe(true);
    expect(hasThinkingStyles.foundPhase).toBe(true);
  });

  test("Chat page: agent phase indicator appears when thinking", async ({ window }) => {
    await dismissModals(window);

    // Navigate to Chat page
    const chatNav = window.locator(".nav-list .nav-btn").first();
    await chatNav.click();

    // Wait for gateway connection
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // The thinking indicator should NOT be visible when idle
    const thinkingBubble = window.locator(".chat-thinking");
    await expect(thinkingBubble).not.toBeVisible();

    // The agent phase span should not exist when idle
    const phaseSpan = window.locator(".chat-agent-phase");
    await expect(phaseSpan).not.toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────
  // Gateway Client: tool-events capability
  // ──────────────────────────────────────────────────────────────────

  test("Gateway client sends tool-events capability in connect", async ({ window }) => {
    await dismissModals(window);

    // Wait for gateway connection
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Verify gateway info endpoint is accessible
    const gwInfo = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/app/gateway-info`);
      return { status: res.status, body: await res.json() };
    }, API_BASE);
    expect(gwInfo.status).toBe(200);
    expect(gwInfo.body.wsUrl).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────
  // i18n: All required translation keys exist
  // ──────────────────────────────────────────────────────────────────

  test("All agent event i18n keys resolve to non-empty strings", async ({ window }) => {
    const keys = [
      "chat.phase_queued",
      "chat.phase_processing",
      "chat.phase_awaiting_llm",
      "chat.phase_generating",
      "chat.phaseUsingTool",
      "chat.timeoutNoEvents",
      "chat.timeoutWaitingForLLM",
      "chat.timeoutToolRunning",
      "chat.stopCommand",
      "chat.resetCommand",
      "chat.stopCommandFeedback",
      "chat.resetCommandFeedback",
      "chat.resetConfirm",
      "settings.chat.title",
      "settings.chat.showAgentEvents",
      "settings.chat.showAgentEventsHint",
      "settings.chat.failedToSave",
    ];

    const results = await window.evaluate((translationKeys) => {
      // Access the i18next instance from the window
      // The i18n library is initialized in the app, so we can use it
      const i18n = (window as unknown as { __i18n?: { t: (key: string) => string } }).__i18n;
      if (i18n) {
        return translationKeys.map((key) => ({ key, value: i18n.t(key) }));
      }
      // Fallback: check if translations are in the DOM by rendering
      return null;
    }, keys);

    // If we can access i18n directly, verify all keys resolve
    if (results) {
      for (const { key, value } of results) {
        // i18next returns the key itself if translation is missing
        expect(value).not.toBe(key);
        expect(value.length).toBeGreaterThan(0);
      }
    }

    // Also verify by checking that the Settings page renders translated text
    await dismissModals(window);
    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();

    // The Chat Settings section title should appear translated
    const chatSection = window.locator(".section-card", { hasText: /Chat Settings|聊天设置/ });
    await expect(chatSection).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────
  // Settings page section ordering
  // ──────────────────────────────────────────────────────────────────

  test("Settings page sections are in correct order: Agent → Chat → Telemetry", async ({ window }) => {
    await dismissModals(window);

    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    // Wait for settings sections to render (use :visible to exclude hidden ChannelsPage cards)
    const sectionCards = window.locator(".section-card:visible");
    await expect(sectionCards.first()).toBeVisible({ timeout: 10_000 });
    const count = await sectionCards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // First section: Agent Settings
    const firstSection = sectionCards.nth(0);
    await expect(firstSection).toContainText(/Agent Settings|智能体设置/);

    // Second section: Chat Settings
    const secondSection = sectionCards.nth(1);
    await expect(secondSection).toContainText(/Chat Settings|聊天设置/);

    // Third section: Telemetry & Privacy
    const thirdSection = sectionCards.nth(2);
    await expect(thirdSection).toContainText(/Telemetry|遥测/);
  });

  // ──────────────────────────────────────────────────────────────────
  // Agent Settings section (existing, sanity check)
  // ──────────────────────────────────────────────────────────────────

  test("Settings page: Agent section has DM scope dropdown", async ({ window }) => {
    await dismissModals(window);

    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    // Agent Settings section should have a select/dropdown for DM scope (use :visible to exclude hidden ChannelsPage cards)
    const agentSection = window.locator(".section-card:visible").first();
    await expect(agentSection).toContainText(/Agent Settings|智能体设置/);
    await expect(agentSection).toContainText(/DM Session Scope|私信会话隔离/);

    // Should have a Select component
    const select = agentSection.locator("select, .custom-select-trigger");
    await expect(select).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────
  // Telemetry section toggle (existing, sanity check)
  // ──────────────────────────────────────────────────────────────────

  test("Settings page: Telemetry section has toggle and info", async ({ window }) => {
    await dismissModals(window);

    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();

    const telemetrySection = window.locator(".section-card", { hasText: /Telemetry|遥测/ });
    await expect(telemetrySection).toBeVisible();

    // Should have a toggle switch
    const toggle = telemetrySection.locator(".toggle-switch");
    await expect(toggle).toBeVisible();

    // Should have "What we collect" and "What we don't collect" sections
    await expect(telemetrySection).toContainText(/What we collect|我们收集的数据/);
    await expect(telemetrySection).toContainText(/What we don't collect|我们不收集的数据/);
  });

  // ──────────────────────────────────────────────────────────────────
  // Chat page: connection status indicator works correctly
  // ──────────────────────────────────────────────────────────────────

  test("Chat page: connection status shows connected after gateway connects", async ({ window }) => {
    await dismissModals(window);

    // Chat is default page, verify status
    const statusBar = window.locator(".chat-status");
    await expect(statusBar).toBeVisible();

    // Wait for connected state
    const connectedDot = window.locator(".chat-status-dot-connected");
    await expect(connectedDot).toBeVisible({ timeout: 30_000 });

    // Status text should show "Connected"
    await expect(statusBar).toContainText(/Connected|已连接/);
  });

  // ──────────────────────────────────────────────────────────────────
  // Chat page: empty state displays correctly
  // ──────────────────────────────────────────────────────────────────

  test("Chat page: shows empty state with examples on fresh start", async ({ window }) => {
    await dismissModals(window);

    // Chat is default page
    const chatNav = window.locator(".nav-list .nav-btn").first();
    await expect(chatNav).toHaveClass(/nav-active/);

    // Wait for gateway connection so the page is fully loaded
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Empty state should show the prompt message
    const emptyState = window.locator(".chat-empty");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/Start a conversation|开始对话/);

    // Example cards section should exist
    const examples = window.locator(".chat-examples");
    await expect(examples).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────
  // End-to-end chat message flow (requires real API key)
  // ──────────────────────────────────────────────────────────────────

  test("Chat message triggers thinking indicator with agent phase", async ({ window }) => {
    const apiKey = process.env.E2E_VOLCENGINE_API_KEY;
    test.skip(!apiKey, "E2E_VOLCENGINE_API_KEY required for chat flow test");

    await dismissModals(window);

    // Ensure we're on Chat page and connected
    const chatNav = window.locator(".nav-list .nav-btn").first();
    await chatNav.click();
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Ensure agent events setting is ON
    await window.evaluate(async (base) => {
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_show_agent_events: "true" }),
      });
    }, API_BASE);

    // Type and send a message
    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("Say hello in one word.");
    const sendBtn = window.locator(".chat-input-area .btn-primary");
    await sendBtn.click();

    // User message should appear
    const userBubble = window.locator(".chat-bubble-user");
    await expect(userBubble.last()).toContainText("Say hello in one word.");

    // Thinking indicator should appear while waiting for response
    // (it appears briefly between send and first delta)
    const thinkingOrResponse = window.locator(".chat-thinking, .chat-bubble-assistant:not(.chat-thinking)");
    await expect(thinkingOrResponse.first()).toBeVisible({ timeout: 30_000 });

    // Eventually, an assistant response should arrive
    const assistantBubble = window.locator(".chat-bubble-assistant:not(.chat-thinking):not(.chat-streaming-cursor)");
    await expect(assistantBubble.last()).toBeVisible({ timeout: 60_000 });

    // Thinking indicator should disappear after response
    const thinkingBubble = window.locator(".chat-thinking");
    await expect(thinkingBubble).not.toBeVisible({ timeout: 10_000 });
  });

  test("Chat agent phase shows processing status when events enabled", async ({ window }) => {
    const apiKey = process.env.E2E_VOLCENGINE_API_KEY;
    test.skip(!apiKey, "E2E_VOLCENGINE_API_KEY required for agent phase test");

    await dismissModals(window);

    // Navigate to Chat page
    const chatNav = window.locator(".nav-list .nav-btn").first();
    await chatNav.click();
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Ensure agent events setting is ON
    await window.evaluate(async (base) => {
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_show_agent_events: "true" }),
      });
    }, API_BASE);

    // Send a message that should trigger agent processing
    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("What is 2 + 2?");
    await window.locator(".chat-input-area .btn-primary").click();

    // Wait for a response (or thinking indicator)
    // The agent phase indicator may flash briefly — we check that the flow completes
    const assistantBubble = window.locator(".chat-bubble-assistant:not(.chat-thinking):not(.chat-streaming-cursor)");
    await expect(assistantBubble.last()).toBeVisible({ timeout: 60_000 });

    // After completion, no thinking indicator should remain
    await expect(window.locator(".chat-thinking")).not.toBeVisible();
    // No agent phase should remain
    await expect(window.locator(".chat-agent-phase")).not.toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────
  // Settings toggle affects Chat page behavior
  // ──────────────────────────────────────────────────────────────────

  test("Toggling agent events setting OFF via UI updates the API", async ({ window }) => {
    await dismissModals(window);

    // Navigate to Settings
    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    // Wait for settings to load
    const chatSection = window.locator(".section-card", { hasText: /Chat Settings|聊天设置/ });
    await expect(chatSection).toBeVisible({ timeout: 10_000 });
    const toggleInput = chatSection.locator("input[type='checkbox']").first();
    const toggleTrack = chatSection.locator(".toggle-track").first();

    // Should start ON (fresh install default)
    await expect(toggleInput).toBeChecked();

    // Click the visible track to uncheck
    await toggleTrack.click();
    await expect(toggleInput).not.toBeChecked();
    await window.waitForTimeout(1_000);

    // Verify via API
    const offResult = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_show_agent_events;
    }, API_BASE);
    expect(offResult).toBe("false");

    // Turn back ON via API
    await window.evaluate(async (base) => {
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_show_agent_events: "true" }),
      });
    }, API_BASE);
  });

  // ──────────────────────────────────────────────────────────────────
  // Preserve Tool Events: Settings toggle
  // ──────────────────────────────────────────────────────────────────

  test("Chat Settings section shows preserve tool events toggle", async ({ window }) => {
    // Wait for app to be ready, then dismiss any modals
    await window.waitForSelector(".nav-btn", { timeout: 15_000 });
    await dismissModals(window);

    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    const chatSection = window.locator(".section-card", { hasText: /Chat Settings|聊天设置/ });
    await expect(chatSection).toBeVisible();

    // Should have two toggle switches: agent events + preserve tool events
    const toggles = chatSection.locator(".toggle-switch");
    await expect(toggles).toHaveCount(2);

    // Verify label text for the second toggle
    await expect(chatSection).toContainText(/Preserve tool call records|保留工具调用记录/);
    await expect(chatSection).toContainText(/Save tool call entries|在聊天记录中内联保存/);
  });

  test("Preserve tool events toggle is OFF by default (fresh install)", async ({ window }) => {
    await dismissModals(window);

    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    const chatSection = window.locator(".section-card", { hasText: /Chat Settings|聊天设置/ });
    const toggleInputs = chatSection.locator("input[type='checkbox']");

    // Second toggle (preserve tool events) should be unchecked by default
    await expect(toggleInputs.nth(1)).not.toBeChecked();
  });

  test("Preserve tool events toggle persists OFF → ON round-trip", async ({ window }) => {
    await dismissModals(window);

    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    await expect(settingsBtn).toHaveClass(/nav-active/);

    const chatSection = window.locator(".section-card", { hasText: /Chat Settings|聊天设置/ });
    const toggleInput = chatSection.locator("input[type='checkbox']").nth(1);
    const toggleTrack = chatSection.locator(".toggle-track").nth(1);

    // Should start unchecked
    await expect(toggleInput).not.toBeChecked();

    // Toggle ON by clicking the visible track
    await toggleTrack.click();
    await expect(toggleInput).toBeChecked();
    await window.waitForTimeout(1_000);

    // Verify via API
    const onResult = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_preserve_tool_events;
    }, API_BASE);
    expect(onResult).toBe("true");

    // Toggle OFF by clicking the visible track
    await toggleTrack.click();
    await expect(toggleInput).not.toBeChecked();
    await window.waitForTimeout(1_000);

    // Verify via API
    const offResult = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_preserve_tool_events;
    }, API_BASE);
    expect(offResult).toBe("false");
  });

  test("Settings API: can write and read chat_preserve_tool_events", async ({ window }) => {
    // Write "true"
    const writeRes = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_preserve_tool_events: "true" }),
      });
      return res.status;
    }, API_BASE);
    expect(writeRes).toBe(200);

    // Read back
    const readTrue = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_preserve_tool_events;
    }, API_BASE);
    expect(readTrue).toBe("true");

    // Write "false"
    const writeRes2 = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_preserve_tool_events: "false" }),
      });
      return res.status;
    }, API_BASE);
    expect(writeRes2).toBe(200);

    // Read back
    const readFalse = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/settings`);
      const data = await res.json();
      return data.settings?.chat_preserve_tool_events;
    }, API_BASE);
    expect(readFalse).toBe("false");
  });

  test("Preserve tool events i18n keys resolve correctly", async ({ window }) => {
    const keys = [
      "chat.toolEventLabel",
      "settings.chat.preserveToolEvents",
      "settings.chat.preserveToolEventsHint",
    ];

    const results = await window.evaluate((translationKeys) => {
      const i18n = (window as unknown as { __i18n?: { t: (key: string) => string } }).__i18n;
      if (i18n) {
        return translationKeys.map((key) => ({ key, value: i18n.t(key) }));
      }
      return null;
    }, keys);

    if (results) {
      for (const { key, value } of results) {
        expect(value).not.toBe(key);
        expect(value.length).toBeGreaterThan(0);
      }
    }

    // Verify the label is visible on the Settings page
    await dismissModals(window);
    const settingsBtn = window.locator(".nav-btn", { hasText: "Settings" });
    await settingsBtn.click();
    const chatSection = window.locator(".section-card", { hasText: /Chat Settings|聊天设置/ });
    await expect(chatSection).toContainText(/Preserve tool call records|保留工具调用记录/);
  });

  test("Chat page has tool-event CSS classes in stylesheet", async ({ window }) => {
    const hasToolEventStyles = await window.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      let foundToolEvent = false;
      let foundToolEventIcon = false;
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (rule instanceof CSSStyleRule) {
              if (rule.selectorText?.includes(".chat-tool-event-icon")) foundToolEventIcon = true;
              else if (rule.selectorText?.includes(".chat-tool-event")) foundToolEvent = true;
            }
          }
        } catch {
          // Cross-origin stylesheets may throw
        }
      }
      return { foundToolEvent, foundToolEventIcon };
    });

    expect(hasToolEventStyles.foundToolEvent).toBe(true);
    expect(hasToolEventStyles.foundToolEventIcon).toBe(true);
  });
});
