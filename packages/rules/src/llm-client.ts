import { createLogger } from "@easyclaw/logger";

const log = createLogger("rules:llm-client");

/**
 * Configuration needed to call the local OpenClaw gateway for LLM completions.
 * The gateway handles all provider routing internally (Anthropic, OpenAI, Bedrock, etc.).
 */
export interface LLMConfig {
  gatewayUrl: string;   // e.g. "http://127.0.0.1:18789"
  authToken: string;    // gateway auth token from openclaw.json
}

/** A single chat message in the OpenAI format. */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Parsed response from an LLM chat completion. */
interface LLMResponse {
  content: string;
}

/**
 * Call the local OpenClaw gateway's chat completions endpoint.
 *
 * The gateway exposes an OpenAI-compatible `/v1/chat/completions` API
 * and handles all provider-specific routing internally, so we don't need
 * provider-specific code here.
 *
 * If the gateway is not running, the fetch will fail and the pipeline's
 * retry logic will eventually fall back to heuristic compilation.
 */
export async function chatCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
): Promise<LLMResponse> {
  const url = `${config.gatewayUrl}/v1/chat/completions`;

  log.info(`Calling OpenClaw gateway at ${config.gatewayUrl}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.authToken}`,
    },
    body: JSON.stringify({
      model: "openclaw",
      messages,
      temperature: 0,
      // Tag as internal so the gateway generates a deterministic session key
      // (`openai-user:easyclaw-rule-compile`) that the panel can filter out.
      user: "easyclaw-rule-compile",
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Gateway LLM error: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string; type?: string };
  };

  // Check for OpenAI-format error embedded in a 200 response
  if (data.error) {
    throw new Error(
      `Gateway LLM error: ${data.error.type ?? "unknown"} — ${data.error.message ?? "unknown error"}`,
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Gateway response missing content in choices[0].message.content");
  }

  // Detect upstream provider errors forwarded as content (e.g. "HTTP 401 authentication_error: ...")
  if (content.startsWith("HTTP ") && content.includes("error")) {
    throw new Error(`Gateway upstream error: ${content.slice(0, 500)}`);
  }

  log.info(`LLM response received (${content.length} chars)`);
  return { content };
}
