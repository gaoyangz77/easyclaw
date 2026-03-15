import { app, nativeImage } from "electron";
import type { NativeImage } from "electron";
import type { GatewayState } from "@easyclaw/gateway";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGED_TRAY_ICON_PATH = resolve(__dirname, "../build/trayIcon@2x.png");
const TRAY_ICON_SIZE = 44;

/**
 * Color palette for state indicator dot.
 * Each color is an [r, g, b] tuple.
 */
const STATE_COLORS: Record<GatewayState, [number, number, number]> = {
  running: [76, 175, 80], // green
  starting: [255, 193, 7], // amber
  stopping: [255, 152, 0], // orange
  stopped: [158, 158, 158], // gray
};

/**
 * Create a tray icon from the packaged PNG with a colored status dot overlay.
 * Uses the bundled tray icon regardless of dev/packaged mode.
 * Overlays a small colored circle in the bottom-right corner to indicate gateway state.
 */
export function createTrayIcon(state: GatewayState): NativeImage {
  const source = nativeImage.createFromPath(PACKAGED_TRAY_ICON_PATH);
  const base = source.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });

  // Get the raw RGBA bitmap
  const size = base.getSize();
  const bitmap = base.toBitmap();
  const buffer = Buffer.from(bitmap);
  const w = size.width;
  const h = size.height;

  // Draw a state indicator dot in the bottom-right corner
  const [r, g, b] = STATE_COLORS[state];
  const dotRadius = Math.round(TRAY_ICON_SIZE * 0.18); // ~18% of the visible icon size
  const cx = w - dotRadius - 1;
  const cy = h - dotRadius - 1;

  for (let y = cy - dotRadius; y <= cy + dotRadius; y++) {
    for (let x = cx - dotRadius; x <= cx + dotRadius; x++) {
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const offset = (y * w + x) * 4;

      if (dist <= dotRadius - 1) {
        // Fill
        buffer[offset] = r;
        buffer[offset + 1] = g;
        buffer[offset + 2] = b;
        buffer[offset + 3] = 255;
      } else if (dist <= dotRadius) {
        // 1px white border for visibility
        buffer[offset] = 255;
        buffer[offset + 1] = 255;
        buffer[offset + 2] = 255;
        buffer[offset + 3] = 255;
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, {
    width: w,
    height: h,
    scaleFactor: 2.0,
  });
}
