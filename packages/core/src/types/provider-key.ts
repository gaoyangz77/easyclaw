export type ProviderKeyAuthType = "api_key" | "oauth" | "local" | "custom";

export interface ProviderKeyEntry {
  id: string;
  provider: string;
  label: string;
  model: string;
  isDefault: boolean;
  proxyBaseUrl?: string | null;
  authType?: ProviderKeyAuthType;
  /** Per-key endpoint URL. Used by local providers (e.g. Ollama) where the
   *  base URL is user-configurable rather than fixed per provider. */
  baseUrl?: string | null;
  /** Protocol for custom providers: "openai" or "anthropic". NULL for built-in providers. */
  customProtocol?: string | null;
  /** JSON-encoded array of model IDs for custom providers. NULL for built-in providers. */
  customModelsJson?: string | null;
  /** Supported input modalities for the model (e.g. ["text"] or ["text", "image"]).
   *  NULL/undefined defaults to ["text"]. Primarily used by local providers. */
  inputModalities?: string[] | null;
  createdAt: string;
  updatedAt: string;
}
