/**
 * Providers Tool
 *
 * Lets the AI agent manage LLM provider API keys through conversation
 * instead of requiring the panel UI.  Calls the EasyClaw panel-server
 * HTTP API at http://127.0.0.1:{PANEL_PORT}/api/provider-keys.
 */

import { Type } from "@sinclair/typebox";

// Minimal tool types — inlined to avoid depending on vendor internals.
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

type EasyClawToolDef = {
  label: string;
  name: string;
  description: string;
  ownerOnly?: boolean;
  parameters: ReturnType<typeof Type.Object>;
  execute: (toolCallId: string, args: unknown) => Promise<ToolResult>;
};

function jsonResult(payload: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function stringEnum<T extends readonly string[]>(values: T) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values] });
}

/** Must match DEFAULT_PANEL_PORT in @easyclaw/core (packages/core/src/ports.ts). */
const PANEL_BASE_URL = "http://127.0.0.1:3210";

const PROVIDER_ACTIONS = ["list", "add", "activate", "remove"] as const;

async function panelFetch(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${PANEL_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json();
  return { status: res.status, body };
}

export function createProvidersTool(): EasyClawToolDef {
  return {
    label: "Providers",
    name: "providers",
    ownerOnly: true,
    description:
      "Manage LLM provider API keys. " +
      "Use `list` to see configured keys. " +
      "Use `add` to add a new API key (requires provider name and apiKey). " +
      "Use `activate` to set a key as the default. " +
      "Use `remove` to delete a key.",
    parameters: Type.Object({
      action: stringEnum(PROVIDER_ACTIONS),
      provider: Type.Optional(
        Type.String({ description: "Provider ID for add, e.g. openai, anthropic, google, deepseek" }),
      ),
      apiKey: Type.Optional(
        Type.String({ description: "The API key to add" }),
      ),
      model: Type.Optional(
        Type.String({ description: "Model ID override (optional, auto-detected from provider)" }),
      ),
      label: Type.Optional(
        Type.String({ description: "Display label for this key (optional)" }),
      ),
      id: Type.Optional(
        Type.String({ description: "Key UUID for activate/remove actions" }),
      ),
    }),
    execute: async (_toolCallId: string, args: unknown): Promise<ToolResult> => {
      const { action, provider, apiKey, model, label, id } = args as Record<string, string | undefined>;

      try {
        if (action === "list") {
          const { body } = await panelFetch("/api/provider-keys");
          return jsonResult(body);
        }

        if (action === "add") {
          if (!provider) {
            return jsonResult({ error: "Missing required parameter: provider" });
          }
          if (!apiKey) {
            return jsonResult({ error: "Missing required parameter: apiKey" });
          }
          const { status, body } = await panelFetch("/api/provider-keys", {
            method: "POST",
            body: JSON.stringify({ provider, apiKey, model, label }),
          });
          if (status === 422) {
            const msg = (body as { error?: string }).error ?? "API key validation failed";
            return jsonResult({ error: msg });
          }
          if (status >= 400) {
            const msg = (body as { error?: string }).error ?? `Request failed (${status})`;
            return jsonResult({ error: msg });
          }
          return jsonResult(body);
        }

        if (action === "activate") {
          if (!id) {
            return jsonResult({ error: "Missing required parameter: id" });
          }
          const { status, body } = await panelFetch(
            `/api/provider-keys/${encodeURIComponent(id)}/activate`,
            { method: "POST" },
          );
          if (status >= 400) {
            const msg = (body as { error?: string }).error ?? `Request failed (${status})`;
            return jsonResult({ error: msg });
          }
          return jsonResult({ ok: true, message: "Key activated as default" });
        }

        if (action === "remove") {
          if (!id) {
            return jsonResult({ error: "Missing required parameter: id" });
          }
          const { status, body } = await panelFetch(
            `/api/provider-keys/${encodeURIComponent(id)}`,
            { method: "DELETE" },
          );
          if (status >= 400) {
            const msg = (body as { error?: string }).error ?? `Request failed (${status})`;
            return jsonResult({ error: msg });
          }
          return jsonResult({ ok: true, message: "Key removed" });
        }

        return jsonResult({ error: `Unknown action: ${action}` });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        return jsonResult({
          error: `Failed to reach EasyClaw panel server: ${message}`,
        });
      }
    },
  };
}
