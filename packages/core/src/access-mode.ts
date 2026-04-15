/** Which LLM access mode the user has selected. */
export type AccessMode = "credits" | "coding-plan" | "subscription";

/** Settings key used to persist the current access mode in SQLite. */
export const ACCESS_MODE_KEY = "access_mode" as const;

/** Default mode for new installations. */
export const DEFAULT_ACCESS_MODE: AccessMode = "credits";

/** Settings key where the credits JWT is cached. */
export const CREDITS_TOKEN_KEY = "credits_token" as const;

/** Settings key where the cloud-api base URL is configured. */
export const CLOUD_API_URL_KEY = "cloud_api_url" as const;

/** Default cloud-api URL — can be overridden via the settings key. */
export const DEFAULT_CLOUD_API_URL = "http://localhost:3100" as const;
