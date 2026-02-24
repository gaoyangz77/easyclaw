import { fetchChannelStatus } from "../api/index.js";

/**
 * Poll until the gateway responds with fresh channel data after a config change.
 * Used after adding/editing/deleting channel accounts (gateway restarts on SIGUSR1).
 *
 * @param onSuccess - Called with the fresh snapshot once the gateway responds.
 * @param opts.initialDelay - Delay before first poll (default 800ms).
 * @param opts.retryDelay - Delay between retries (default 400ms).
 * @param opts.maxRetries - Maximum number of retries (default 15).
 */
export async function pollGatewayReady(
  onSuccess?: () => void,
  opts?: { initialDelay?: number; retryDelay?: number; maxRetries?: number },
): Promise<void> {
  const { initialDelay = 800, retryDelay = 400, maxRetries = 15 } = opts ?? {};

  // Give gateway time to receive SIGUSR1 and start reloading
  await new Promise(r => setTimeout(r, initialDelay));

  // Poll until gateway responds with fresh data
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetchChannelStatus(true);
      onSuccess?.();
      return;
    } catch {
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }
}
