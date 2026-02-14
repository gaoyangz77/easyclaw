/**
 * search-browser-fallback plugin
 *
 * Intercepts web_search tool calls when no search API key is configured
 * and redirects the agent to use the browser tool with Google search instead.
 */

import type { OpenClawPluginDefinition } from "openclaw/plugin-sdk";

function hasSearchApiKey(config: Record<string, unknown> | undefined): boolean {
  const envKeys = [
    "BRAVE_API_KEY",
    "PERPLEXITY_API_KEY",
    "OPENROUTER_API_KEY",
    "XAI_API_KEY",
  ];
  for (const key of envKeys) {
    if (process.env[key]?.trim()) return true;
  }

  const tools = config?.tools as Record<string, unknown> | undefined;
  const web = tools?.web as Record<string, unknown> | undefined;
  const search = web?.search as Record<string, unknown> | undefined;
  if (!search) return false;

  if (typeof search.apiKey === "string" && search.apiKey.trim()) return true;

  const perplexity = search.perplexity as Record<string, unknown> | undefined;
  if (typeof perplexity?.apiKey === "string" && perplexity.apiKey.trim()) return true;

  const grok = search.grok as Record<string, unknown> | undefined;
  if (typeof grok?.apiKey === "string" && grok.apiKey.trim()) return true;

  return false;
}

const plugin: OpenClawPluginDefinition = {
  id: "search-browser-fallback",
  name: "Search Browser Fallback",
  description: "Falls back to browser-based Google search when no search API key is configured",

  register(api) {
    api.on("before_tool_call", (event) => {
      if (event.toolName !== "web_search") return;
      if (hasSearchApiKey(api.config as Record<string, unknown> | undefined)) return;

      const query = typeof event.params.query === "string" ? event.params.query : "";

      return {
        block: true,
        blockReason:
          `No search API key is configured. ` +
          `Use the browser tool to search instead:\n` +
          `1. Pick a search engine appropriate for the user's locale (e.g. Bing, Baidu, Google, DuckDuckGo).\n` +
          `2. Call browser with action="open", url="<search engine url>?q=${encodeURIComponent(query)}".\n` +
          `3. Call browser with action="snapshot" to read the search results.`,
      };
    });
  },
};

export default plugin;
