import { createLogger } from "@rivonclaw/logger";
import { net } from "electron";

const log = createLogger("deps-provisioner");

export type Region = "global" | "cn";

/**
 * Detect network region by probing Google.
 * If Google is reachable within the timeout, the user is on the global internet.
 * If not (GFW, timeout, DNS failure), assume China region and use mirrors.
 */
export async function detectRegion(timeoutMs = 3000): Promise<Region> {
  try {
    const reachable = await Promise.race([
      checkGoogle(),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    if (reachable) {
      log.info("Google reachable — using global sources");
      return "global";
    }
  } catch {
    // Network error — treat as China
  }
  log.info("Google unreachable — using China mirror sources");
  return "cn";
}

async function checkGoogle(): Promise<boolean> {
  // Use Electron's net module which respects system proxy settings.
  // A simple HEAD request to google.com is enough.
  return new Promise<boolean>((resolve) => {
    const request = net.request({
      method: "HEAD",
      url: "https://www.google.com/generate_204",
    });
    request.on("response", () => resolve(true));
    request.on("error", () => resolve(false));
    request.end();
  });
}
