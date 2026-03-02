import { join } from "node:path";
import { resolveMediaDir as _resolveMediaDir } from "@easyclaw/core/node";

/** Resolve the base media directory (~/.easyclaw/openclaw/media). */
export function resolveMediaBase(): string {
  return _resolveMediaDir();
}

/** Resolve a media subdirectory (e.g. "inbound", "outbound"). */
export function resolveMediaDir(sub: "inbound" | "outbound"): string {
  return join(_resolveMediaDir(), sub);
}
