import { join } from "node:path";
import type { SessionStateRuntimeTarget } from "@rivonclaw/core";

/** Root session-state directory for a profile, namespaced by runtime target. */
export function sessionStateDirPath(
  profileBasePath: string,
  target: SessionStateRuntimeTarget,
  profileId: string,
): string {
  return join(profileBasePath, "session-state", target, profileId);
}

/** Path to the session state manifest. */
export function manifestPath(
  profileBasePath: string,
  target: SessionStateRuntimeTarget,
  profileId: string,
): string {
  return join(sessionStateDirPath(profileBasePath, target, profileId), "manifest.json");
}

/**
 * Path to the cookie snapshot file.
 *
 * Extension is `.json.enc` — contents are encrypted with AES-256-GCM
 * using a machine-bound key stored in the OS keychain.
 *
 * Migration: existing plaintext `.json` files from before encryption
 * was enabled are detected automatically by the crypto layer and
 * re-encrypted on the next checkpoint flush.
 */
export function cookieSnapshotPath(
  profileBasePath: string,
  target: SessionStateRuntimeTarget,
  profileId: string,
): string {
  return join(sessionStateDirPath(profileBasePath, target, profileId), "cookies.json.enc");
}
