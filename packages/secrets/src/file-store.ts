import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { hostname, userInfo } from "node:os";
import { resolveSecretsDir } from "@easyclaw/core/node";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import type { SecretKey, SecretStore } from "./types.js";
import { createLogger } from "@easyclaw/logger";

const log = createLogger("secrets:file");

/** Directory where encrypted secret files are stored. */
const DEFAULT_SECRETS_DIR = resolveSecretsDir();

/** AES-256-GCM encryption parameters. */
const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a machine-scoped encryption key.
 *
 * For V0 we use a fixed salt derived from the hostname + username.
 * This is NOT a production-grade KDF strategy -- it is a placeholder
 * until proper DPAPI / OS secret store integration is added.
 */
function deriveKey(): Buffer {
  const user = userInfo().username;
  const host = hostname();
  const salt = "easyclaw-" + host + "-" + user;
  return scryptSync(salt, "easyclaw-v0-salt", 32);
}

function sanitizeFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * File-based encrypted secret store.
 *
 * Used as a fallback on platforms without a native secret manager
 * (Linux, or as a Windows DPAPI placeholder in V0).
 *
 * Each secret is stored as a separate file in ~/.easyclaw/secrets/
 * encrypted with AES-256-GCM using a machine-derived key.
 */
export class FileSecretStore implements SecretStore {
  private readonly dir: string;
  private readonly encKey: Buffer;

  constructor(dir?: string) {
    this.dir = dir ?? DEFAULT_SECRETS_DIR;
    mkdirSync(this.dir, { recursive: true });
    this.encKey = deriveKey();
  }

  private filePath(key: string): string {
    return join(this.dir, sanitizeFilename(key) + ".enc");
  }

  private encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.encKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Format: [iv (16)] [authTag (16)] [ciphertext (rest)]
    return Buffer.concat([iv, authTag, encrypted]);
  }

  private decrypt(data: Buffer): string {
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.encKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  }

  async get(key: SecretKey): Promise<string | null> {
    const fp = this.filePath(key);
    try {
      const data = readFileSync(fp);
      const value = this.decrypt(data);
      log.debug("get secret: key=" + key + " found=true");
      return value;
    } catch {
      log.debug("get secret: key=" + key + " found=false");
      return null;
    }
  }

  async set(key: SecretKey, value: string): Promise<void> {
    const fp = this.filePath(key);
    const encrypted = this.encrypt(value);
    writeFileSync(fp, encrypted);
    log.debug("set secret: key=" + key);
  }

  async delete(key: SecretKey): Promise<boolean> {
    const fp = this.filePath(key);
    try {
      unlinkSync(fp);
      log.debug("delete secret: key=" + key + " existed=true");
      return true;
    } catch {
      log.debug("delete secret: key=" + key + " existed=false");
      return false;
    }
  }

  async listKeys(): Promise<string[]> {
    try {
      const files = readdirSync(this.dir);
      const keys = files
        .filter((f) => f.endsWith(".enc"))
        .map((f) => f.slice(0, -4));
      log.debug("listKeys: count=" + keys.length);
      return keys;
    } catch {
      log.debug("listKeys: directory not found");
      return [];
    }
  }
}
