import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the absolute path to the compiled Volcengine STT CLI script.
 *
 * In dev: resolves relative to the source directory (dist/volcengine-stt-cli.mjs).
 * In packaged app: the caller should pass an override path since the script
 * is bundled into Electron's resources.
 *
 * @param overridePath - Optional absolute path override (for packaged apps)
 */
export function resolveVolcengineSttCliPath(overridePath?: string): string {
  if (overridePath) {
    return overridePath;
  }
  // In dev/build: the CLI script is a sibling file in the same dist/ directory
  return join(thisDir, "volcengine-stt-cli.mjs");
}
