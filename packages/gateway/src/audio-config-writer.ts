import { createLogger } from "@easyclaw/logger";
import type { SttProvider as SttProviderType } from "@easyclaw/core";

const log = createLogger("gateway:audio-config");

/**
 * OpenClaw audio understanding model configuration.
 * Maps to tools.media.audio.models in openclaw.json.
 */
interface AudioModelConfig {
  provider?: string;
  model?: string;
  type: "provider" | "cli";
  command?: string;
  args?: string[];
  capabilities?: ["audio"];
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
 * @param options - Additional options for CLI-based providers
 * @returns OpenClaw tools.media.audio configuration object
 */
export function generateAudioConfig(
  enabled: boolean,
  provider: SttProviderType,
  options?: {
    /** Absolute path to the Node.js binary (for CLI-based providers). */
    nodeBin?: string;
    /** Absolute path to the Volcengine STT CLI script. */
    sttCliPath?: string;
  },
): Record<string, unknown> | null {
  if (!enabled) {
    return null;
  }

  const models: AudioModelConfig[] = [];

  if (provider === "groq") {
    // Groq has native support in OpenClaw with whisper-large-v3-turbo
    models.push({
      provider: "groq",
      model: "whisper-large-v3-turbo",
      type: "provider",
      capabilities: ["audio"],
    });
  } else if (provider === "volcengine") {
    // Volcengine is not natively supported in OpenClaw, so we use a CLI bridge script.
    // The script reads VOLCENGINE_APP_KEY and VOLCENGINE_ACCESS_KEY from env vars
    // (already injected by secret-injector.ts) and calls the Volcengine API.
    if (options?.nodeBin && options?.sttCliPath) {
      models.push({
        type: "cli",
        command: options.nodeBin,
        args: [options.sttCliPath, "{{MediaPath}}"],
      });
    } else {
      log.warn("Volcengine STT requires nodeBin and sttCliPath; skipping audio config");
    }
  }

  if (models.length === 0) {
    log.warn(`No audio models configured for provider: ${provider}`);
    return null;
  }

  return {
    enabled: true,
    models,
    maxBytes: 25 * 1024 * 1024, // 25MB limit
    timeoutSeconds: 300, // 5 minutes (volcengine uses async submit+poll)
    scope: {
      default: "allow",
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
