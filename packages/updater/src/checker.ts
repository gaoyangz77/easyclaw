import { createLogger } from "@easyclaw/logger";
import type { UpdateManifest, UpdateCheckResult } from "./types.js";
import { isNewerVersion } from "./version.js";

const log = createLogger("updater");

export const DEFAULT_MANIFEST_URL =
  "https://www.easy-claw.com/update-manifest.json";

/**
 * Fetch the update manifest from the given URL (or the default).
 * Times out after 10 seconds. Throws on non-ok responses or network errors.
 */
export async function fetchManifest(
  manifestUrl?: string,
): Promise<UpdateManifest> {
  const url = manifestUrl ?? DEFAULT_MANIFEST_URL;
  log.debug(`Fetching update manifest from ${url}`);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch manifest: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const manifest = (await response.json()) as UpdateManifest;
  return manifest;
}

/**
 * Returns the platform key for the current OS.
 * Maps process.platform to "mac" or "win".
 * Throws on unsupported platforms.
 */
export function getPlatformKey(): "mac" | "win" {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "win";
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

/**
 * Check for updates against the static manifest.
 * Never throws -- errors are captured in the result.
 *
 * @param options.region - User region ("cn" | "us" etc.). Appended as ?region= query param
 *   so the server can return region-appropriate download URLs (e.g. China CDN mirror).
 */
export async function checkForUpdate(
  currentVersion: string,
  options?: { manifestUrl?: string; region?: string },
): Promise<UpdateCheckResult> {
  try {
    let manifestUrl = options?.manifestUrl;
    if (options?.region) {
      const base = manifestUrl ?? DEFAULT_MANIFEST_URL;
      const sep = base.includes("?") ? "&" : "?";
      manifestUrl = `${base}${sep}region=${options.region}`;
    }
    const manifest = await fetchManifest(manifestUrl);
    const updateAvailable = isNewerVersion(currentVersion, manifest.latestVersion);

    let platformKey: "mac" | "win";
    try {
      platformKey = getPlatformKey();
    } catch {
      // On unsupported platform, still report version info but no download
      log.warn("Running on unsupported platform; cannot resolve download info");
      return {
        updateAvailable,
        currentVersion,
        latestVersion: manifest.latestVersion,
        releaseNotes: manifest.releaseNotes,
      };
    }

    const download = manifest.downloads[platformKey];

    log.info(
      updateAvailable
        ? `Update available: ${currentVersion} -> ${manifest.latestVersion}`
        : `Already up to date (${currentVersion})`,
    );

    return {
      updateAvailable,
      currentVersion,
      latestVersion: manifest.latestVersion,
      download,
      releaseNotes: manifest.releaseNotes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Update check failed: ${message}`);
    return {
      updateAvailable: false,
      currentVersion,
      error: message,
    };
  }
}
