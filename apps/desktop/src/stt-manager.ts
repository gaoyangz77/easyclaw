import { createLogger } from "@easyclaw/logger";
import type { SttProvider as SttProviderType } from "@easyclaw/core";
import { createSttProvider } from "@easyclaw/stt";
import type { SttProvider, SttConfig } from "@easyclaw/stt";
import type { SecretStore } from "@easyclaw/secrets";
import type { Storage } from "@easyclaw/storage";

const log = createLogger("stt-manager");

/**
 * Manages the STT (Speech-to-Text) service instance.
 *
 * Reads configuration from storage and creates the appropriate STT provider
 * with credentials from the secret store.
 */
export class SttManager {
  private provider: SttProvider | null = null;
  private enabled = false;

  constructor(
    private storage: Storage,
    private secretStore: SecretStore,
  ) {}

  /**
   * Initialize the STT service by loading configuration and credentials.
   * Should be called at app startup and whenever STT settings change.
   */
  async initialize(): Promise<void> {
    try {
      // Read STT settings
      const enabledSetting = this.storage.settings.get("stt.enabled");
      const providerSetting = this.storage.settings.get("stt.provider") as SttProviderType | undefined;

      this.enabled = enabledSetting === "true";

      if (!this.enabled) {
        log.info("STT is disabled");
        this.provider = null;
        return;
      }

      const provider = providerSetting || "groq";
      log.info(`Initializing STT with provider: ${provider}`);

      // Load credentials from secret store
      const config = await this.loadConfig(provider);

      if (!config) {
        log.warn(`STT enabled but credentials not found for provider: ${provider}`);
        this.enabled = false;
        this.provider = null;
        return;
      }

      // Create STT provider instance
      this.provider = createSttProvider(config);
      log.info(`STT service initialized successfully with ${provider}`);
    } catch (err) {
      log.error("Failed to initialize STT service", err);
      this.enabled = false;
      this.provider = null;
    }
  }

  /**
   * Load STT configuration with credentials from secret store.
   */
  private async loadConfig(provider: SttProviderType): Promise<SttConfig | null> {
    if (provider === "groq") {
      const apiKey = await this.secretStore.get("stt-groq-apikey");
      if (!apiKey) {
        return null;
      }
      return {
        provider: "groq",
        groq: { apiKey },
      };
    } else if (provider === "volcengine") {
      const appKey = await this.secretStore.get("stt-volcengine-appkey");
      const accessKey = await this.secretStore.get("stt-volcengine-accesskey");
      if (!appKey || !accessKey) {
        return null;
      }
      return {
        provider: "volcengine",
        volcengine: { appKey, accessKey },
      };
    }
    return null;
  }

  /**
   * Transcribe audio buffer to text.
   *
   * @param audio - Audio buffer
   * @param format - Audio format (e.g., "wav", "mp3", "ogg")
   * @returns Transcribed text or null if STT is disabled/failed
   */
  async transcribe(audio: Buffer, format: string): Promise<string | null> {
    if (!this.enabled || !this.provider) {
      log.debug("STT is not enabled or not initialized");
      return null;
    }

    try {
      log.info(`Transcribing ${audio.length} bytes of ${format} audio`);
      const result = await this.provider.transcribe(audio, format);
      log.info(`Transcription complete: ${result.text.substring(0, 100)}...`);
      return result.text;
    } catch (err) {
      log.error("Transcription failed", err);
      return null;
    }
  }

  /**
   * Check if STT is currently enabled and ready.
   */
  isEnabled(): boolean {
    return this.enabled && this.provider !== null;
  }

  /**
   * Get the current provider name.
   */
  getProvider(): SttProviderType | null {
    if (!this.enabled || !this.provider) {
      return null;
    }
    return this.provider.name as SttProviderType;
  }
}
