import { createLogger } from "@easyclaw/logger";
import type { SttProvider as SttProviderType } from "@easyclaw/core";

const log = createLogger("gateway:audio-config");

/**
 * OpenClaw audio understanding model configuration.
 * Maps to tools.media.audio.models in openclaw.json.
 */
interface AudioModelConfig {
  provider: string;
  model?: string;
  type: "provider";
  capabilities: ["audio"];
  language?: string;
}

/**
 * Generate OpenClaw audio understanding configuration based on EasyClaw STT settings.
 *
 * This function creates the `tools.media.audio` configuration that tells OpenClaw
 * how to transcribe voice messages.
 *
 * @param enabled - Whether STT is enabled
 * @param provider - STT provider (groq or volcengine)
 * @returns OpenClaw tools.media.audio configuration object
 */
export function generateAudioConfig(
  enabled: boolean,
  provider: SttProviderType,
): Record<string, unknown> | null {
  if (!enabled) {
    return null;
  }

  const models: AudioModelConfig[] = [];

  if (provider === "groq") {
    // Groq uses OpenAI-compatible API with Whisper model
    models.push({
      provider: "openai",
      model: "whisper-1", // OpenAI Whisper API compatible
      type: "provider",
      capabilities: ["audio"],
    });
  } else if (provider === "volcengine") {
    // Volcengine uses its own API
    models.push({
      provider: "volcengine",
      type: "provider",
      capabilities: ["audio"],
      language: "zh-CN", // Default to Chinese for Volcengine
    });
  }

  if (models.length === 0) {
    log.warn(`No audio models configured for provider: ${provider}`);
    return null;
  }

  return {
    enabled: true,
    models,
    // Optional: Configure behavior
    maxBytes: 25 * 1024 * 1024, // 25MB limit
    timeoutSeconds: 60, // 1 minute timeout
    scope: {
      default: "allow", // Allow audio transcription by default
    },
  };
}

/**
 * Merge audio configuration into OpenClaw config object.
 *
 * This writes to tools.media.audio in the config.
 *
 * @param config - Existing OpenClaw config object
 * @param audioConfig - Audio configuration from generateAudioConfig()
 * @returns Updated config object
 */
export function mergeAudioConfig(
  config: Record<string, unknown>,
  audioConfig: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!audioConfig) {
    // If audio is disabled, remove the config
    const tools = config.tools as Record<string, unknown> | undefined;
    if (tools) {
      const media = tools.media as Record<string, unknown> | undefined;
      if (media) {
        delete media.audio;
      }
    }
    return config;
  }

  // Ensure tools.media.audio path exists
  const tools = (config.tools as Record<string, unknown>) ?? {};
  const media = (tools.media as Record<string, unknown>) ?? {};

  // Set audio config
  media.audio = audioConfig;
  tools.media = media;
  config.tools = tools;

  log.info("Audio configuration merged into OpenClaw config");
  return config;
}
