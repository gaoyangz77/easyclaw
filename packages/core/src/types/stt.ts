/**
 * STT (Speech-to-Text) provider types
 */
export type SttProvider = "volcengine" | "groq";

/**
 * STT configuration stored in settings
 */
export interface SttSettings {
  /** Selected STT provider (default: region-aware) */
  provider: SttProvider;
  /** Whether STT is enabled globally */
  enabled: boolean;
}

/**
 * Default STT settings
 */
export const DEFAULT_STT_SETTINGS: SttSettings = {
  provider: "groq",
  enabled: false,
};

/**
 * Settings keys for STT configuration
 */
export const STT_SETTINGS_KEYS = {
  PROVIDER: "stt.provider",
  ENABLED: "stt.enabled",
  VOLCENGINE_APP_KEY_ID: "stt.volcengine.appKeyId",
  VOLCENGINE_ACCESS_KEY_ID: "stt.volcengine.accessKeyId",
  GROQ_API_KEY_ID: "stt.groq.apiKeyId",
} as const;

/**
 * Keychain secret keys for STT credentials
 */
export const STT_SECRET_KEYS = {
  VOLCENGINE_APP_KEY: "stt-volcengine-appkey",
  VOLCENGINE_ACCESS_KEY: "stt-volcengine-accesskey",
  GROQ_API_KEY: "stt-groq-apikey",
} as const;
