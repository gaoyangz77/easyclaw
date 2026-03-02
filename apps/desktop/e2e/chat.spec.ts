import { test, expect } from "./electron-fixture.js";

const API_BASE = "http://127.0.0.1:3210";

/**
 * Helper: dismiss any modal(s) blocking the UI (e.g. "What's New", telemetry consent).
 */
async function dismissModals(window: import("@playwright/test").Page) {
  await window.evaluate(() => localStorage.setItem("telemetry.consentShown", "1"));

  for (let i = 0; i < 5; i++) {
    const backdrop = window.locator(".modal-backdrop");
    if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
    const closeBtn = backdrop.locator(".modal-close-btn");
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    }
    await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  }
}

/**
 * Helper: wait for the session tab bar to appear.
 * On a fresh database with no messages, `sessions.list` returns 0 sessions
 * and the tab bar (SessionTabBar) won't render. Returns true if visible.
 */
async function waitForTabBar(window: import("@playwright/test").Page, timeoutMs = 20_000): Promise<boolean> {
  const tabBar = window.locator(".chat-session-tabs");
  try {
    await expect(tabBar).toBeVisible({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: send a short message and wait for the assistant response + tab bar.
 * This materializes a session on the gateway so the tab bar becomes visible.
 */
async function ensureSessionExists(window: import("@playwright/test").Page): Promise<void> {
  // If tab bar is already visible, a session exists
  const tabBar = window.locator(".chat-session-tabs");
  if (await tabBar.isVisible({ timeout: 1_000 }).catch(() => false)) return;

  const textarea = window.locator(".chat-input-area textarea");
  await textarea.fill("Say ok.");
  await window.locator(".chat-input-area .btn-primary").click();

  // Wait for response
  const bubble = window.locator(".chat-bubble-assistant:not(.chat-thinking):not(.chat-streaming-cursor)");
  await expect(bubble.last()).toBeVisible({ timeout: 60_000 });

  // Wait for tab bar to appear
  await expect(tabBar).toBeVisible({ timeout: 20_000 });
}

test.describe("Chat Page — Comprehensive", () => {

  // ──────────────────────────────────────────────────────────────────
  // 1. Page load, connection, and basic structure
  // ──────────────────────────────────────────────────────────────────

  test("chat page is the default nav item and connects to gateway", async ({ window }) => {
    await dismissModals(window);

    // Chat should be the active nav item by default
    const firstNav = window.locator(".nav-list .nav-btn").first();
    await expect(firstNav).toHaveClass(/nav-active/);

    // Wait for gateway to reach "Connected" state
    const connectedDot = window.locator(".chat-status-dot-connected");
    await expect(connectedDot).toBeVisible({ timeout: 30_000 });

    // Verify connection stays stable for 3 seconds
    await window.waitForTimeout(3_000);
    await expect(connectedDot).toBeVisible();
  });

  test("chat container has correct DOM structure", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Core layout elements
    await expect(window.locator(".chat-container")).toBeVisible();
    await expect(window.locator(".chat-input-area")).toBeVisible();
    await expect(window.locator(".chat-status")).toBeVisible();

    // Status bar shows "Connected"
    const statusBar = window.locator(".chat-status");
    await expect(statusBar).toContainText(/Connected|已连接/);
  });

  // ──────────────────────────────────────────────────────────────────
  // 2. Empty state and example cards
  // ──────────────────────────────────────────────────────────────────

  test("shows empty state with examples on fresh start", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Empty state prompt
    const emptyState = window.locator(".chat-empty");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/Start a conversation|开始对话/);

    // Example cards section exists
    const examples = window.locator(".chat-examples");
    await expect(examples).toBeVisible();

    // Toggle button exists
    const toggle = window.locator(".chat-examples-toggle");
    await expect(toggle).toBeVisible();
  });

  test("example cards toggle expand/collapse and populate input", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Expand examples if collapsed
    const exampleGrid = window.locator(".chat-examples-grid");
    if (!await exampleGrid.isVisible().catch(() => false)) {
      await window.locator(".chat-examples-toggle").click();
    }
    await expect(exampleGrid).toBeVisible();

    // Should have 6 example cards
    const cards = window.locator(".chat-example-card");
    await expect(cards).toHaveCount(6);

    // Click the first example card
    const firstCard = cards.first();
    const cardText = await firstCard.textContent();
    await firstCard.click();

    // The textarea should now contain the example text
    const textarea = window.locator(".chat-input-area textarea");
    await expect(textarea).toHaveValue(cardText!.trim());

    // Collapse examples
    await window.locator(".chat-examples-toggle").click();
    await expect(exampleGrid).not.toBeVisible();

    // Clear draft for next tests
    await textarea.fill("");
  });

  // ──────────────────────────────────────────────────────────────────
  // 3. Input area (ChatInputArea component)
  // ──────────────────────────────────────────────────────────────────

  test("input area has textarea, send button, emoji and attach buttons", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Textarea
    const textarea = window.locator(".chat-input-area textarea");
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEditable();

    // Send button (primary, visible when not streaming)
    const sendBtn = window.locator(".chat-input-area .btn-primary");
    await expect(sendBtn).toBeVisible();

    // Emoji button
    const emojiBtn = window.locator(".chat-emoji-btn");
    await expect(emojiBtn).toBeVisible();

    // Attach buttons (file path + image)
    const attachBtns = window.locator(".chat-attach-btn");
    const count = await attachBtns.count();
    expect(count).toBe(2);
  });

  test("send button is disabled when textarea is empty and enabled when typed", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    const sendBtn = window.locator(".chat-input-area .btn-primary");
    await expect(sendBtn).toBeDisabled();

    // Type something — button becomes enabled
    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("hello");
    await expect(sendBtn).toBeEnabled();

    // Clear — disabled again
    await textarea.fill("");
    await expect(sendBtn).toBeDisabled();
  });

  test("emoji picker opens and closes on button click", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    const emojiBtn = window.locator(".chat-emoji-btn");
    const picker = window.locator(".chat-emoji-picker");

    // Picker should be hidden initially
    await expect(picker).not.toBeVisible();

    // Click to open
    await emojiBtn.click();
    await expect(picker).toBeVisible();

    // Click again to close
    await emojiBtn.click();
    await expect(picker).not.toBeVisible();
  });

  test("input row has correct layout structure", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Input row wraps the textarea and buttons
    const inputRow = window.locator(".chat-input-row");
    await expect(inputRow).toBeVisible();

    // Emoji wrapper contains the button and (when open) the picker
    const emojiWrapper = window.locator(".chat-emoji-wrapper");
    await expect(emojiWrapper).toBeVisible();

    // Hidden file inputs exist for image and file path attachment
    const srInputs = window.locator(".chat-input-area .sr-input");
    const srCount = await srInputs.count();
    expect(srCount).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────
  // 4. Session tab bar (requires at least one session)
  //    The tab bar only renders when sessions.length > 0.
  //    On a fresh database, sessions.list returns 0 sessions until
  //    a message is sent. These tests require an API key.
  // ──────────────────────────────────────────────────────────────────

  test("session tab bar appears after sending a message", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Send a quick message to create a session
    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("Say ok.");
    await window.locator(".chat-input-area .btn-primary").click();

    // Wait for response so the session is materialized on the gateway
    const assistantBubble = window.locator(".chat-bubble-assistant:not(.chat-thinking):not(.chat-streaming-cursor)");
    await expect(assistantBubble.last()).toBeVisible({ timeout: 60_000 });

    // Tab bar should appear after event-driven sessions.list refresh
    const tabBar = window.locator(".chat-session-tabs");
    await expect(tabBar).toBeVisible({ timeout: 20_000 });

    // Scrollable container for tabs
    const scrollArea = tabBar.locator(".chat-session-tabs-scroll");
    await expect(scrollArea).toBeVisible();

    // Should have at least one session tab
    const tabs = scrollArea.locator(".chat-session-tab");
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(1);

    // First tab should be active
    const firstTab = tabs.first();
    await expect(firstTab).toHaveClass(/chat-session-tab-active/);

    // Tab has a label
    const label = firstTab.locator(".chat-session-tab-label");
    await expect(label).toBeVisible();
  });

  test("session tab bar has new-chat and archived buttons", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    const tabBarVisible = await waitForTabBar(window);
    test.skip(!tabBarVisible, "Tab bar not visible (no sessions)");

    const tabBar = window.locator(".chat-session-tabs");

    // New chat (+) button is inside the scroll container, after the tabs
    const newChatBtn = tabBar.locator(".chat-session-tab-new-btn");
    await expect(newChatBtn).toBeVisible();
    await expect(newChatBtn.locator("svg")).toBeVisible();

    // Actions container has the archived button
    const actions = tabBar.locator(".chat-session-tabs-actions");
    await expect(actions).toBeVisible();
    const archiveBtn = actions.locator(".chat-session-tab-action-btn");
    await expect(archiveBtn).toHaveCount(1);
    await expect(archiveBtn.locator("svg")).toBeVisible();
  });

  test("new chat button creates a new session tab", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    const tabBarVisible = await waitForTabBar(window);
    test.skip(!tabBarVisible, "Tab bar not visible (no sessions)");

    const tabBar = window.locator(".chat-session-tabs");
    const scrollArea = tabBar.locator(".chat-session-tabs-scroll");
    const tabs = scrollArea.locator(".chat-session-tab");
    const countBefore = await tabs.count();

    // Click the new chat (+) button
    const newChatBtn = tabBar.locator(".chat-session-tab-new-btn");
    await newChatBtn.click();

    // A new tab should appear
    await expect(tabs).toHaveCount(countBefore + 1);

    // The new tab should be active
    const newTab = tabs.last();
    await expect(newTab).toHaveClass(/chat-session-tab-active/);

    // The new tab should have a close button (it's not the main tab)
    const closeBtn = newTab.locator(".chat-session-tab-close");
    await expect(closeBtn).toBeVisible();
  });

  test("main session tab does not show close button", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    const tabBarVisible = await waitForTabBar(window);
    test.skip(!tabBarVisible, "Tab bar not visible (no sessions)");

    const tabBar = window.locator(".chat-session-tabs");

    // Main tab (first active tab) should not have a close (X) button
    const mainTab = tabBar.locator(".chat-session-tab-active").first();
    const closeBtn = mainTab.locator(".chat-session-tab-close");
    await expect(closeBtn).toHaveCount(0);
  });

  test("archived sessions dropdown opens and shows empty state", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    const tabBarVisible = await waitForTabBar(window);
    test.skip(!tabBarVisible, "Tab bar not visible (no sessions)");

    const tabBar = window.locator(".chat-session-tabs");

    // Click the archived sessions action button
    const archivedBtn = tabBar.locator(".chat-archived-trigger-wrap .chat-session-tab-action-btn");
    await expect(archivedBtn).toBeVisible();
    await archivedBtn.click();

    // Dropdown should appear
    const dropdown = window.locator(".chat-archived-dropdown");
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    // Has a header
    const header = dropdown.locator(".chat-archived-header");
    await expect(header).toBeVisible();
    await expect(header).toContainText(/Archived|归档/);

    // Has a search input
    const search = dropdown.locator(".chat-archived-search input");
    await expect(search).toBeVisible();

    // On a fresh test, there should be no archived sessions
    const emptyMsg = dropdown.locator(".chat-archived-empty");
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 });

    // Close by clicking the button again
    await archivedBtn.click();
    await expect(dropdown).not.toBeVisible({ timeout: 3_000 });
  });

  test("session tab remains active after sending a message", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    const tabBarVisible = await waitForTabBar(window);
    test.skip(!tabBarVisible, "Tab bar not visible (no sessions)");

    const tabBar = window.locator(".chat-session-tabs");

    // Note the active tab label
    const activeTab = tabBar.locator(".chat-session-tab-active");
    const activeLabel = await activeTab.textContent();

    // Send a message
    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("Say ok.");
    await window.locator(".chat-input-area .btn-primary").click();

    // Wait for response
    const assistantBubble = window.locator(".chat-bubble-assistant:not(.chat-thinking):not(.chat-streaming-cursor)");
    await expect(assistantBubble.last()).toBeVisible({ timeout: 60_000 });

    // The same tab should still be active
    const activeTabAfter = tabBar.locator(".chat-session-tab-active");
    await expect(activeTabAfter).toContainText(activeLabel!);
  });

  // ──────────────────────────────────────────────────────────────────
  // 5. Status bar
  // ──────────────────────────────────────────────────────────────────

  test("status bar shows connection state and reset button", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    const statusBar = window.locator(".chat-status");

    // Status dot
    const dot = statusBar.locator(".chat-status-dot");
    await expect(dot).toBeVisible();
    await expect(dot).toHaveClass(/chat-status-dot-connected/);

    // Connection text
    await expect(statusBar).toContainText(/Connected|已连接/);

    // Reset / "New Chat" button in status bar
    const resetBtn = statusBar.locator(".btn-secondary");
    await expect(resetBtn).toBeVisible();
    await expect(resetBtn).toContainText(/New Chat|新对话|Reset|重置/);
    await expect(resetBtn).toBeEnabled();
  });

  test("status bar reset button triggers confirmation modal", async ({ window }) => {
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // The status bar "New Chat" / reset button
    const statusResetBtn = window.locator(".chat-status .btn-secondary");
    await expect(statusResetBtn).toBeVisible();
    await statusResetBtn.click();

    // Confirmation modal appears
    const modal = window.locator(".modal-backdrop");
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal).toContainText(/New Chat|新对话|Reset|重置/);

    // Modal has cancel and confirm (danger) buttons
    const cancelBtn = modal.locator(".btn-secondary");
    const confirmBtn = modal.locator(".btn-danger");
    await expect(cancelBtn).toBeVisible();
    await expect(confirmBtn).toBeVisible();

    // Cancel
    await cancelBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 3_000 });
  });

  // ──────────────────────────────────────────────────────────────────
  // 6. CSS classes in stylesheet
  // ──────────────────────────────────────────────────────────────────

  test("session tab bar CSS classes exist in stylesheet", async ({ window }) => {
    const result = await window.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      const selectors = new Set<string>();
      for (const sheet of sheets) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule instanceof CSSStyleRule) {
              selectors.add(rule.selectorText);
            }
          }
        } catch {
          // Cross-origin stylesheets
        }
      }
      const has = (cls: string) => [...selectors].some((s) => s.includes(cls));
      return {
        tabs: has(".chat-session-tabs"),
        tabsScroll: has(".chat-session-tabs-scroll"),
        tab: has(".chat-session-tab"),
        tabActive: has(".chat-session-tab-active"),
        tabUnread: has(".chat-session-tab-unread"),
        tabLabel: has(".chat-session-tab-label"),
        tabClose: has(".chat-session-tab-close"),
        tabPinned: has(".chat-session-tab-pinned"),
        tabActions: has(".chat-session-tabs-actions"),
        tabActionBtn: has(".chat-session-tab-action-btn"),
        tabNewBtn: has(".chat-session-tab-new-btn"),
        channelBadge: has(".chat-tab-channel-badge"),
        renameInput: has(".chat-tab-rename-input"),
        archivedDropdown: has(".chat-archived-dropdown"),
        archivedItem: has(".chat-archived-item"),
        archivedSwipe: has(".chat-archived-swipe-wrap"),
        archivedDeleteBtn: has(".chat-archived-delete-btn"),
      };
    });

    expect(result.tabs).toBe(true);
    expect(result.tabsScroll).toBe(true);
    expect(result.tab).toBe(true);
    expect(result.tabActive).toBe(true);
    expect(result.tabUnread).toBe(true);
    expect(result.tabLabel).toBe(true);
    expect(result.tabClose).toBe(true);
    expect(result.tabPinned).toBe(true);
    expect(result.tabActions).toBe(true);
    expect(result.tabActionBtn).toBe(true);
    expect(result.tabNewBtn).toBe(true);
    expect(result.channelBadge).toBe(true);
    expect(result.renameInput).toBe(true);
    expect(result.archivedDropdown).toBe(true);
    expect(result.archivedItem).toBe(true);
    expect(result.archivedSwipe).toBe(true);
    expect(result.archivedDeleteBtn).toBe(true);
  });

  test("input area and message CSS classes exist in stylesheet", async ({ window }) => {
    const result = await window.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      const selectors = new Set<string>();
      for (const sheet of sheets) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule instanceof CSSStyleRule) {
              selectors.add(rule.selectorText);
            }
          }
        } catch {}
      }
      const has = (cls: string) => [...selectors].some((s) => s.includes(cls));
      return {
        inputArea: has(".chat-input-area"),
        inputRow: has(".chat-input-row"),
        bubble: has(".chat-bubble"),
        bubbleUser: has(".chat-bubble-user"),
        bubbleAssistant: has(".chat-bubble-assistant"),
        bubbleExternal: has(".chat-bubble-external"),
        thinking: has(".chat-thinking"),
        streamingCursor: has(".chat-streaming-cursor"),
        agentPhase: has(".chat-agent-phase"),
        toolEvent: has(".chat-tool-event"),
        scrollBottom: has(".chat-scroll-bottom"),
        collapsible: has(".chat-bubble-collapsed"),
        imagePreview: has(".chat-image-preview"),
        emojiPicker: has(".chat-emoji-picker"),
        emptyState: has(".chat-empty"),
        historyEnd: has(".chat-history-end"),
      };
    });

    expect(result.inputArea).toBe(true);
    expect(result.inputRow).toBe(true);
    expect(result.bubble).toBe(true);
    expect(result.bubbleUser).toBe(true);
    expect(result.bubbleAssistant).toBe(true);
    expect(result.bubbleExternal).toBe(true);
    expect(result.thinking).toBe(true);
    expect(result.streamingCursor).toBe(true);
    expect(result.agentPhase).toBe(true);
    expect(result.toolEvent).toBe(true);
    expect(result.scrollBottom).toBe(true);
    expect(result.collapsible).toBe(true);
    expect(result.imagePreview).toBe(true);
    expect(result.emojiPicker).toBe(true);
    expect(result.emptyState).toBe(true);
    expect(result.historyEnd).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // 7. i18n keys for chat page
  // ──────────────────────────────────────────────────────────────────

  test("session and chat i18n keys resolve to non-empty strings", async ({ window }) => {
    const keys = [
      // Session management
      "chat.newSession",
      "chat.newSessionTitle",
      "chat.sessionMain",
      "chat.sessionUntitled",
      "chat.archiveSession",
      "chat.archivedSessions",
      "chat.searchArchived",
      "chat.noArchivedSessions",
      "chat.noSearchResults",
      "chat.deleteSession",
      "chat.imageAttachment",
      // Chat flow
      "chat.resetCommand",
      "chat.resetConfirm",
      "chat.resetCommandFeedback",
      "chat.resetTooltip",
      "chat.emptyState",
      "chat.placeholder",
      "chat.send",
      "chat.stop",
      "chat.emoji",
      "chat.attachFile",
      "chat.attachImage",
      "chat.examplesTitle",
      "chat.historyEnd",
      // Connection status
      "chat.connected",
      "chat.connecting",
      "chat.disconnected",
      // Channel badges
      "chat.channelTelegram",
      "chat.channelFeishu",
      "chat.channelWebchat",
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
        // i18next returns the key itself if translation is missing
        expect(value, `i18n key "${key}" should resolve`).not.toBe(key);
        expect(value.length, `i18n key "${key}" should be non-empty`).toBeGreaterThan(0);
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // 8. Gateway API endpoints
  // ──────────────────────────────────────────────────────────────────

  test("gateway-info endpoint is accessible and returns wsUrl", async ({ window }) => {
    const gwInfo = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/app/gateway-info`);
      return { status: res.status, body: await res.json() };
    }, API_BASE);

    expect(gwInfo.status).toBe(200);
    expect(gwInfo.body.wsUrl).toBeTruthy();
  });

  test("chat-sessions API supports list, upsert, and delete", async ({ window }) => {
    // List should return an array (may be empty on fresh start)
    const listResult = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/chat-sessions`);
      return { status: res.status, body: await res.json() };
    }, API_BASE);
    expect(listResult.status).toBe(200);
    expect(Array.isArray(listResult.body.sessions)).toBe(true);

    // Upsert a test session
    const upsertResult = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/chat-sessions/${encodeURIComponent("test:e2e:session")}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customTitle: "E2E Test Session", pinned: false }),
      });
      return { status: res.status, body: await res.json() };
    }, API_BASE);
    expect(upsertResult.status).toBe(200);
    expect(upsertResult.body.session.key).toBe("test:e2e:session");
    expect(upsertResult.body.session.customTitle).toBe("E2E Test Session");

    // Delete the test session
    const deleteResult = await window.evaluate(async (base) => {
      const res = await fetch(`${base}/api/chat-sessions/${encodeURIComponent("test:e2e:session")}`, {
        method: "DELETE",
      });
      return { status: res.status, body: await res.json() };
    }, API_BASE);
    expect(deleteResult.status).toBe(200);
    expect(deleteResult.body.ok).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // 9. Chat message flow (requires API key)
  // ──────────────────────────────────────────────────────────────────

  test("sending a message shows user bubble and receives response", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");

    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Type and send
    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("Say hi in one word.");
    const sendBtn = window.locator(".chat-input-area .btn-primary");
    await sendBtn.click();

    // User bubble should appear
    const userBubble = window.locator(".chat-bubble-user");
    await expect(userBubble.last()).toContainText("Say hi in one word.");

    // Empty state should disappear
    await expect(window.locator(".chat-empty")).not.toBeVisible();

    // Thinking or streaming response appears
    const thinkingOrResponse = window.locator(".chat-thinking, .chat-bubble-assistant:not(.chat-thinking)");
    await expect(thinkingOrResponse.first()).toBeVisible({ timeout: 30_000 });

    // Eventually, a final assistant response arrives
    const assistantBubble = window.locator(".chat-bubble-assistant:not(.chat-thinking):not(.chat-streaming-cursor)");
    await expect(assistantBubble.last()).toBeVisible({ timeout: 60_000 });

    // Thinking indicator should disappear
    await expect(window.locator(".chat-thinking")).not.toBeVisible({ timeout: 10_000 });

    // Textarea should be cleared
    await expect(textarea).toHaveValue("");
  });

  test("stop button appears during streaming and works", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");

    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Send a message that should produce a longer response
    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("Count from 1 to 100 slowly, one number per line.");
    await window.locator(".chat-input-area .btn-primary").click();

    // Wait for streaming to start (stop button appears)
    const stopBtn = window.locator(".chat-input-area .btn-danger");
    await expect(stopBtn).toBeVisible({ timeout: 30_000 });

    // Click stop
    await stopBtn.click();

    // Stop button should eventually disappear (send button returns)
    const sendBtn = window.locator(".chat-input-area .btn-primary");
    await expect(sendBtn).toBeVisible({ timeout: 15_000 });
  });

  // ──────────────────────────────────────────────────────────────────
  // 10. Multi-tab functionality
  // ──────────────────────────────────────────────────────────────────

  test("switching tabs isolates messages", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Materialize a session so the tab bar appears
    await ensureSessionExists(window);

    const tabBar = window.locator(".chat-session-tabs");
    const scrollArea = tabBar.locator(".chat-session-tabs-scroll");
    const tabs = scrollArea.locator(".chat-session-tab");

    // We should have user bubbles from ensureSessionExists
    const userBubbles = window.locator(".chat-bubble-user");
    expect(await userBubbles.count()).toBeGreaterThan(0);

    // Create a new tab via + button
    await tabBar.locator(".chat-session-tab-new-btn").click();
    const newTabCount = await tabs.count();
    expect(newTabCount).toBeGreaterThanOrEqual(2);

    // New tab should show empty state (no messages from other session)
    await expect(window.locator(".chat-empty")).toBeVisible({ timeout: 5_000 });

    // Switch back to the first tab (main)
    const mainTab = tabs.first();
    await mainTab.click();
    await expect(mainTab).toHaveClass(/chat-session-tab-active/);

    // Messages should be restored
    await expect(userBubbles.first()).toBeVisible({ timeout: 5_000 });
  });

  test("archiving a tab removes it and switches to main", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Materialize a session so the tab bar appears
    await ensureSessionExists(window);

    const tabBar = window.locator(".chat-session-tabs");
    const scrollArea = tabBar.locator(".chat-session-tabs-scroll");
    const tabs = scrollArea.locator(".chat-session-tab");

    // Create a new tab so we have something to archive
    await tabBar.locator(".chat-session-tab-new-btn").click();
    const countBefore = await tabs.count();
    expect(countBefore).toBeGreaterThanOrEqual(2);

    // The new tab (last) should be active and have a close button
    const newTab = tabs.last();
    await expect(newTab).toHaveClass(/chat-session-tab-active/);

    // Click the close (archive) button on the new tab
    const closeBtn = newTab.locator(".chat-session-tab-close");
    await closeBtn.click();

    // Tab count should decrease
    await expect(tabs).toHaveCount(countBefore - 1);

    // Main tab should now be active
    const mainTab = tabs.first();
    await expect(mainTab).toHaveClass(/chat-session-tab-active/);
  });

  test("renaming a tab via double-click", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Materialize a session so the tab bar appears
    await ensureSessionExists(window);

    const tabBar = window.locator(".chat-session-tabs");
    const scrollArea = tabBar.locator(".chat-session-tabs-scroll");
    const tabs = scrollArea.locator(".chat-session-tab");

    // Remember how many tabs we have before creating a new one
    const countBefore = await tabs.count();

    // Create a new tab and send a message to materialize it,
    // so refreshSessions won't remove it
    await tabBar.locator(".chat-session-tab-new-btn").click();
    await expect(tabs).toHaveCount(countBefore + 1);

    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("Say ok.");
    await window.locator(".chat-input-area .btn-primary").click();
    const assistantBubble = window.locator(".chat-bubble-assistant:not(.chat-thinking):not(.chat-streaming-cursor)");
    await expect(assistantBubble.last()).toBeVisible({ timeout: 60_000 });

    // The new (non-main) tab should be active — use nth to avoid stale locator
    const newTab = tabs.nth(countBefore);
    await expect(newTab).toHaveClass(/chat-session-tab-active/);

    // Double-click to rename
    await newTab.dblclick();

    // Inline rename input should appear
    const renameInput = newTab.locator(".chat-tab-rename-input");
    await expect(renameInput).toBeVisible({ timeout: 3_000 });

    // Type a new name and confirm with Enter
    await renameInput.fill("E2E Test Tab");
    await renameInput.press("Enter");

    // Input should disappear, label should show new name
    await expect(renameInput).not.toBeVisible({ timeout: 3_000 });
    const label = newTab.locator(".chat-session-tab-label");
    await expect(label).toContainText("E2E Test Tab");

    // Clean up: archive the tab
    await newTab.locator(".chat-session-tab-close").click();
  });

  test("sending a message in a new tab materializes the session", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");
    await dismissModals(window);
    await expect(window.locator(".chat-status-dot-connected")).toBeVisible({ timeout: 30_000 });

    // Materialize a session so the tab bar appears
    await ensureSessionExists(window);

    const tabBar = window.locator(".chat-session-tabs");
    const scrollArea = tabBar.locator(".chat-session-tabs-scroll");
    const tabs = scrollArea.locator(".chat-session-tab");

    // Create a new tab
    await tabBar.locator(".chat-session-tab-new-btn").click();
    // Use active-class selector — stable even if refreshSessions re-sorts tabs
    const activeTab = scrollArea.locator(".chat-session-tab.chat-session-tab-active");
    await expect(activeTab).toBeVisible({ timeout: 3_000 });

    // Send a message in the new tab
    const textarea = window.locator(".chat-input-area textarea");
    await textarea.fill("Say ok.");
    await window.locator(".chat-input-area .btn-primary").click();

    // User bubble should appear in this tab
    const userBubble = window.locator(".chat-bubble-user");
    await expect(userBubble.last()).toContainText("Say ok.");

    // Wait for assistant response
    const assistantBubble = window.locator(".chat-bubble-assistant:not(.chat-thinking):not(.chat-streaming-cursor)");
    await expect(assistantBubble.last()).toBeVisible({ timeout: 60_000 });

    // The tab should still be active
    await expect(activeTab).toHaveClass(/chat-session-tab-active/);

    // Switch to main and back — messages should persist
    const mainTab = tabs.first();
    await mainTab.click();
    await expect(mainTab).toHaveClass(/chat-session-tab-active/);

    await activeTab.click();
    await expect(activeTab).toHaveClass(/chat-session-tab-active/);
    await expect(userBubble.last()).toContainText("Say ok.");
  });

  // ──────────────────────────────────────────────────────────────────
  // 11. Gateway reconnect after model switch
  // ──────────────────────────────────────────────────────────────────

  test("gateway reconnects within 10s after model switch", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");

    const connectedDot = window.locator(".chat-status-dot-connected");
    await expect(connectedDot).toBeVisible();

    // Get the active provider key
    const keysRes = await fetch(`${API_BASE}/api/provider-keys`);
    const { keys } = (await keysRes.json()) as {
      keys: Array<{ id: string; model: string; isDefault: boolean }>;
    };
    const activeKey = keys.find((k) => k.isDefault);
    expect(activeKey).toBeTruthy();

    const newModel = activeKey!.model.includes("pro")
      ? "doubao-seed-1-6-flash-250828"
      : "doubao-1.5-pro-32k-250115";

    const switchStart = Date.now();
    const res = await fetch(`${API_BASE}/api/provider-keys/${activeKey!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: newModel }),
    });
    expect(res.ok).toBe(true);

    // Gateway does full stop+start on model change
    await connectedDot.waitFor({ state: "hidden", timeout: 5_000 });
    await expect(connectedDot).toBeVisible({ timeout: 10_000 });

    const elapsed = Date.now() - switchStart;
    expect(elapsed).toBeLessThan(10_000);
  });
});
