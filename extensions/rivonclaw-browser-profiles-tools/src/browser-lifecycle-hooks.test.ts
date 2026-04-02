import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/**
 * Sentinel test: proves the browser lifecycle vendor patch is wired through the
 * full vendor pipeline, not just declared in types.ts.
 *
 * These tests are skipped when the vendor patch has NOT been applied.
 * They will pass once the browser lifecycle hooks patch is in place.
 */

const VENDOR_TYPES_FILE = resolve(
  __dirname,
  "../../../vendor/openclaw/src/plugins/types.ts",
);
const VENDOR_HOOKS_FILE = resolve(
  __dirname,
  "../../../vendor/openclaw/src/plugins/hooks.ts",
);
const VENDOR_BROWSER_TOOL_FILE = resolve(
  __dirname,
  "../../../vendor/openclaw/extensions/browser/src/browser-tool.ts",
);

/** Check if the vendor has browser lifecycle hooks patched in. */
function isVendorPatched(): boolean {
  if (!existsSync(VENDOR_TYPES_FILE)) return false;
  const src = readFileSync(VENDOR_TYPES_FILE, "utf-8");
  return src.includes('"browser_session_start"');
}

const BROWSER_HOOK_NAMES = [
  "browser_session_start",
  "browser_session_end",
  "before_browser_action",
  "after_browser_action",
] as const;

const BROWSER_TYPE_NAMES = [
  "PluginHookBrowserContext",
  "PluginHookBrowserSessionStartEvent",
  "PluginHookBrowserSessionEndEvent",
  "PluginHookBeforeBrowserActionEvent",
  "PluginHookBeforeBrowserActionResult",
  "PluginHookAfterBrowserActionEvent",
] as const;

const runOrSkip = isVendorPatched() ? describe : describe.skip;

runOrSkip("browser lifecycle hooks vendor patch sentinel", () => {
  const typesSource = readFileSync(VENDOR_TYPES_FILE, "utf-8");
  const hooksSource = readFileSync(VENDOR_HOOKS_FILE, "utf-8");
  const browserToolSource = readFileSync(VENDOR_BROWSER_TOOL_FILE, "utf-8");

  describe("PLUGIN_HOOK_NAMES array contains browser hooks", () => {
    const hookArrayMatch = typesSource.match(
      /export const PLUGIN_HOOK_NAMES = \[[\s\S]*?\] as const/,
    );

    it("can extract PLUGIN_HOOK_NAMES from vendor source", () => {
      expect(
        hookArrayMatch,
        `Could not extract PLUGIN_HOOK_NAMES from ${VENDOR_TYPES_FILE}. ` +
          "The file structure may have changed significantly.",
      ).not.toBeNull();
    });

    for (const hookName of BROWSER_HOOK_NAMES) {
      it(`includes "${hookName}" in PLUGIN_HOOK_NAMES`, () => {
        expect(
          hookArrayMatch![0],
          formatMissingHookMessage(hookName),
        ).toContain(`"${hookName}"`);
      });
    }
  });

  describe("PluginHookName union type contains browser hooks", () => {
    const hookNameTypeMatch = typesSource.match(
      /export type PluginHookName =[\s\S]*?;/,
    );

    it("can extract PluginHookName type from vendor source", () => {
      expect(
        hookNameTypeMatch,
        `Could not extract PluginHookName type from ${VENDOR_TYPES_FILE}. ` +
          "The file structure may have changed significantly.",
      ).not.toBeNull();
    });

    for (const hookName of BROWSER_HOOK_NAMES) {
      it(`includes "${hookName}" in PluginHookName union`, () => {
        expect(
          hookNameTypeMatch![0],
          formatMissingHookMessage(hookName),
        ).toContain(`"${hookName}"`);
      });
    }
  });

  describe("browser hook types are exported and well-formed", () => {
    for (const typeName of BROWSER_TYPE_NAMES) {
      it(`exports ${typeName}`, () => {
        const pattern = new RegExp(
          `export type ${typeName}\\s*=\\s*\\{[\\s\\S]*?\\};`,
        );
        const match = typesSource.match(pattern);
        expect(
          match,
          formatMissingTypeMessage(typeName),
        ).not.toBeNull();
      });
    }

    it("PluginHookBrowserContext has sessionKey and profile fields", () => {
      const match = typesSource.match(
        /export type PluginHookBrowserContext\s*=\s*\{[\s\S]*?\};/,
      );
      expect(match).not.toBeNull();
      expect(match![0]).toContain("sessionKey");
      expect(match![0]).toContain("profile");
    });

    it("PluginHookBrowserSessionStartEvent has action: 'start'", () => {
      const match = typesSource.match(
        /export type PluginHookBrowserSessionStartEvent\s*=\s*\{[\s\S]*?\};/,
      );
      expect(match).not.toBeNull();
      expect(match![0]).toContain("action");
      expect(match![0]).toContain('"start"');
    });

    it("PluginHookBrowserSessionEndEvent has action: 'stop'", () => {
      const match = typesSource.match(
        /export type PluginHookBrowserSessionEndEvent\s*=\s*\{[\s\S]*?\};/,
      );
      expect(match).not.toBeNull();
      expect(match![0]).toContain("action");
      expect(match![0]).toContain('"stop"');
    });

    it("PluginHookBeforeBrowserActionResult has block and blockReason fields", () => {
      const match = typesSource.match(
        /export type PluginHookBeforeBrowserActionResult\s*=\s*\{[\s\S]*?\};/,
      );
      expect(match).not.toBeNull();
      expect(match![0]).toContain("block");
      expect(match![0]).toContain("blockReason");
    });

    it("PluginHookAfterBrowserActionEvent has durationMs field", () => {
      const match = typesSource.match(
        /export type PluginHookAfterBrowserActionEvent\s*=\s*\{[\s\S]*?\};/,
      );
      expect(match).not.toBeNull();
      expect(match![0]).toContain("durationMs");
    });
  });

  describe("PluginHookHandlerMap includes browser hook entries", () => {
    const handlerMapMatch = typesSource.match(
      /export type PluginHookHandlerMap\s*=\s*\{[\s\S]*?\};/,
    );

    it("can extract PluginHookHandlerMap from vendor source", () => {
      expect(handlerMapMatch).not.toBeNull();
    });

    for (const hookName of BROWSER_HOOK_NAMES) {
      it(`maps "${hookName}" in PluginHookHandlerMap`, () => {
        expect(
          handlerMapMatch![0],
          formatMissingHookMessage(hookName),
        ).toContain(`${hookName}:`);
      });
    }
  });

  describe("hook runner exposes browser hook helpers", () => {
    it("imports the browser hook types in hooks.ts", () => {
      expect(hooksSource).toContain("PluginHookBrowserContext");
      expect(hooksSource).toContain("PluginHookBrowserSessionStartEvent");
      expect(hooksSource).toContain("PluginHookBrowserSessionEndEvent");
      expect(hooksSource).toContain("PluginHookBeforeBrowserActionEvent");
      expect(hooksSource).toContain("PluginHookBeforeBrowserActionResult");
      expect(hooksSource).toContain("PluginHookAfterBrowserActionEvent");
    });

    it("defines mergeBeforeBrowserAction for sequential hook composition", () => {
      expect(
        hooksSource,
        "Missing mergeBeforeBrowserAction in vendor/openclaw/src/plugins/hooks.ts",
      ).toContain("const mergeBeforeBrowserAction");
    });

    it("defines browser hook runner methods", () => {
      for (const methodName of [
        "runBrowserSessionStart",
        "runBrowserSessionEnd",
        "runBeforeBrowserAction",
        "runAfterBrowserAction",
      ]) {
        expect(
          hooksSource,
          `Missing ${methodName} in vendor/openclaw/src/plugins/hooks.ts`,
        ).toContain(`async function ${methodName}`);
      }
    });

    it("returns browser hook runner methods from createHookRunner", () => {
      for (const methodName of [
        "runBrowserSessionStart",
        "runBrowserSessionEnd",
        "runBeforeBrowserAction",
        "runAfterBrowserAction",
      ]) {
        expect(
          hooksSource,
          `Missing ${methodName} from createHookRunner return object`,
        ).toContain(methodName);
      }
    });
  });

  describe("browser tool wires the browser hooks into runtime behavior", () => {
    it("imports getGlobalHookRunner", () => {
      expect(
        browserToolSource,
        "Missing getGlobalHookRunner import in vendor/openclaw/src/agents/tools/browser-tool.ts",
      ).toContain("getGlobalHookRunner");
    });

    it("runs before_browser_action for non-metadata actions", () => {
      expect(browserToolSource).toContain('hookRunner?.hasHooks("before_browser_action")');
      expect(browserToolSource).toContain("hookRunner.runBeforeBrowserAction");
      expect(browserToolSource).toContain('action !== "start"');
      expect(browserToolSource).toContain('action !== "stop"');
      expect(browserToolSource).toContain('action !== "status"');
      expect(browserToolSource).toContain('action !== "profiles"');
    });

    it("fires session start and end hooks from browser-tool", () => {
      expect(browserToolSource).toContain('hookRunner?.hasHooks("browser_session_start")');
      expect(browserToolSource).toContain(
        'hookRunner.runBrowserSessionStart({ profile, action: "start" }, browserHookCtx)',
      );
      expect(browserToolSource).toContain('hookRunner?.hasHooks("browser_session_end")');
      expect(browserToolSource).toContain(
        'hookRunner.runBrowserSessionEnd({ profile, action: "stop" }, browserHookCtx)',
      );
    });

    it("fires after_browser_action with error and duration metadata", () => {
      expect(browserToolSource).toContain('hookRunner?.hasHooks("after_browser_action")');
      expect(browserToolSource).toContain("hookRunner.runAfterBrowserAction");
      expect(browserToolSource).toContain("error: actionError");
      expect(browserToolSource).toContain("durationMs: Date.now() - actionStartTime");
    });

    it("fires browser_session_end only after browserStop succeeds", () => {
      const stopIndex = browserToolSource.indexOf('await browserToolDeps.browserStop(baseUrl, { profile });');
      const sessionEndIndex = browserToolSource.indexOf(
        'hookRunner.runBrowserSessionEnd({ profile, action: "stop" }, browserHookCtx)',
      );
      expect(stopIndex).toBeGreaterThan(-1);
      expect(sessionEndIndex).toBeGreaterThan(-1);
      expect(
        stopIndex,
        "browser_session_end moved ahead of browserStop; cookie capture semantics changed",
      ).toBeLessThan(sessionEndIndex);
    });
  });
});

function formatMissingHookMessage(hookName: string): string {
  return `
=== BROWSER LIFECYCLE HOOKS VENDOR PATCH SENTINEL FAILURE ===

Missing browser hook: "${hookName}"
Files:
- vendor/openclaw/src/plugins/types.ts
- vendor/openclaw/src/plugins/hooks.ts
- vendor/openclaw/extensions/browser/src/browser-tool.ts

RivonClaw requires 4 browser lifecycle hooks patched into the vendor:
  - browser_session_start
  - browser_session_end
  - before_browser_action
  - after_browser_action

These hooks are used by the rivonclaw-browser-profiles-tools extension to manage
browser session lifecycles and intercept browser actions.

Action required:
1. Re-apply or refresh the vendor patch.
2. Verify the hook types, hook runner methods, and browser-tool call sites all exist.
3. Re-run this test to confirm it passes.
=== END SENTINEL ===`;
}

function formatMissingTypeMessage(typeName: string): string {
  return `
=== BROWSER LIFECYCLE HOOKS VENDOR PATCH SENTINEL FAILURE ===

Missing type export: "${typeName}"
File: vendor/openclaw/src/plugins/types.ts

RivonClaw requires browser hook types patched into the vendor:
  - PluginHookBrowserContext
  - PluginHookBrowserSessionStartEvent
  - PluginHookBrowserSessionEndEvent
  - PluginHookBeforeBrowserActionEvent
  - PluginHookBeforeBrowserActionResult
  - PluginHookAfterBrowserActionEvent

Action required:
1. Re-apply or refresh the vendor patch.
2. Verify all browser hook types are exported from
   vendor/openclaw/src/plugins/types.ts.
3. Re-run this test to confirm it passes.
=== END SENTINEL ===`;
}
