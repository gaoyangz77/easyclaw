import { join } from "node:path";
import { homedir } from "node:os";

const MEDIA_BASE = join(homedir(), ".easyclaw", "openclaw", "media");

/** Resolve the base media directory (~/.easyclaw/openclaw/media). */
export function resolveMediaBase(): string {
  return MEDIA_BASE;
}

/** Resolve a media subdirectory (e.g. "inbound", "outbound"). */
export function resolveMediaDir(sub: "inbound" | "outbound"): string {
  return join(MEDIA_BASE, sub);
}
