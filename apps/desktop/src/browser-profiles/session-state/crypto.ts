import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { createLogger } from "@rivonclaw/logger";
import type { SecretStore } from "@rivonclaw/secrets";

const log = createLogger("session-state:crypto");

/**
 * Session state encryption interface.
 *
 * All production callers MUST provide a real implementation.
 * The plaintext passthrough below is for unit tests only.
 */
export interface SessionStateCrypto {
  encrypt(data: Buffer): Promise<Buffer>;
  decrypt(data: Buffer): Promise<Buffer>;
}

/**
 * Plaintext passthrough — **NO actual encryption**.
 *
 * @internal Test-only. Do NOT use in production code.
 */
export function createPlaintextCrypto(): SessionStateCrypto {
  return {
    async encrypt(data: Buffer): Promise<Buffer> {
      return data;
    },
    async decrypt(data: Buffer): Promise<Buffer> {
      return data;
    },
  };
}

const KEYCHAIN_KEY = "session-state.encryption-key";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = 1;

/**
 * Create a production AES-256-GCM crypto implementation.
 *
 * Key management:
 * - A random 256-bit key is generated on first use and stored in the OS keychain
 *   via the provided SecretStore (macOS Keychain, Windows DPAPI, etc.)
 * - The key is cached in memory after first retrieval
 * - Key is stored as hex-encoded string in the keychain
 *
 * Wire format (all fields concatenated):
 * [version: 1 byte] [iv: 12 bytes] [authTag: 16 bytes] [ciphertext: variable]
 *
 * This format is self-describing and supports future version bumps
 * without a separate migration framework.
 */
export async function createAesGcmCrypto(secretStore: SecretStore): Promise<SessionStateCrypto> {
  let cachedKey: Buffer | null = null;

  async function getOrCreateKey(): Promise<Buffer> {
    if (cachedKey) return cachedKey;

    const existing = await secretStore.get(KEYCHAIN_KEY);
    if (existing) {
      cachedKey = Buffer.from(existing, "hex");
      return cachedKey;
    }

    const newKey = randomBytes(32);
    await secretStore.set(KEYCHAIN_KEY, newKey.toString("hex"));
    cachedKey = newKey;
    return cachedKey;
  }

  return {
    async encrypt(data: Buffer): Promise<Buffer> {
      const key = await getOrCreateKey();
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv(ALGO, key, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const tag = cipher.getAuthTag();

      // Wire format: [version][iv][tag][ciphertext]
      const header = Buffer.alloc(1);
      header[0] = VERSION;
      return Buffer.concat([header, iv, tag, encrypted]);
    },

    async decrypt(data: Buffer): Promise<Buffer> {
      const key = await getOrCreateKey();

      // Migration: if data doesn't start with our version byte, treat as plaintext.
      // JSON arrays start with 0x5B ('['), objects with 0x7B ('{') — neither is VERSION (1).
      if (data.length > 0 && data[0] !== VERSION) {
        log.warn("found plaintext snapshot — will be encrypted on next checkpoint");
        return data;
      }

      if (data.length < 1 + IV_LEN + TAG_LEN) {
        throw new Error(`Encrypted session-state data too short: ${data.length} bytes`);
      }

      const version = data[0];
      if (version !== VERSION) {
        throw new Error(`Unsupported session-state crypto version: ${version}`);
      }

      const iv = data.subarray(1, 1 + IV_LEN);
      const tag = data.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
      const ciphertext = data.subarray(1 + IV_LEN + TAG_LEN);

      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    },
  };
}
