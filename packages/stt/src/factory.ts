import type { SttConfig, SttProvider } from "./types.js";
import { VolcengineSttProvider } from "./volcengine.js";
import { GroqSttProvider } from "./groq.js";

/**
 * Creates an STT provider based on the given configuration.
 * Validates that the required credentials are present for the selected provider.
 */
export function createSttProvider(config: SttConfig): SttProvider {
  switch (config.provider) {
    case "volcengine": {
      if (!config.volcengine) {
        throw new Error(
          "Volcengine STT requires volcengine config (appKey, accessKey)",
        );
      }
      if (!config.volcengine.appKey || !config.volcengine.accessKey) {
        throw new Error(
          "Volcengine STT requires both appKey and accessKey",
        );
      }
      return new VolcengineSttProvider(
        config.volcengine.appKey,
        config.volcengine.accessKey,
      );
    }

    case "groq": {
      if (!config.groq) {
        throw new Error("Groq STT requires groq config (apiKey)");
      }
      if (!config.groq.apiKey) {
        throw new Error("Groq STT requires an apiKey");
      }
      return new GroqSttProvider(config.groq.apiKey);
    }

    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown STT provider: ${exhaustive}`);
    }
  }
}
