import { types, flow } from "mobx-state-tree";
import { fetchJson } from "../../api/client.js";

/** Fired after any channel configuration change. */
const CHANNEL_CHANGED_EVENT = "channel-changed";

/**
 * Channel management operations as MST actions on the Panel entity store.
 *
 * Holds no observable state — channel accounts live on rootStore.channelAccounts.
 * This is an action container mounted as `entityStore.channelManager`.
 */
export const ChannelManagerModel = types
  .model("ChannelManager", {})
  .actions((self) => {
    function broadcast(): void {
      window.dispatchEvent(new CustomEvent(CHANNEL_CHANGED_EVENT));
    }

    return {
      /** Create a new channel account. */
      createAccount: flow(function* (data: {
        channelId: string;
        accountId: string;
        name?: string;
        config: Record<string, unknown>;
        secrets?: Record<string, string>;
      }) {
        yield fetchJson("/channels/accounts", {
          method: "POST",
          body: JSON.stringify(data),
        });
        broadcast();
        // Desktop REST -> channelManager.addAccount() -> Desktop MST -> SSE -> Panel auto-updates
      }),

      /** Get full account config (including secrets) from Desktop SQLite. */
      getAccountConfig: flow(function* (channelId: string, accountId: string) {
        return yield fetchJson(
          `/channels/accounts/${encodeURIComponent(channelId)}/${encodeURIComponent(accountId)}`,
        );
      }),

      /** Broadcast channel change to all listeners (for cross-page coordination). */
      broadcast,

      /** Subscribe to channel changes. Returns cleanup function. */
      onChange(callback: () => void): () => void {
        window.addEventListener(CHANNEL_CHANGED_EVENT, callback);
        return () => window.removeEventListener(CHANNEL_CHANGED_EVENT, callback);
      },
    };
  });
