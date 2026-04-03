import { flow } from "mobx-state-tree";
import { ChannelAccountModel as ChannelAccountModelBase } from "@rivonclaw/core/models";
import { fetchJson } from "../../api/client.js";

export const ChannelAccountModel = ChannelAccountModelBase.actions((self) => ({
  /** Update this channel account's config and/or secrets. */
  update: flow(function* (
    fields: { name?: string; config: Record<string, unknown>; secrets?: Record<string, string> },
  ) {
    yield fetchJson(
      `/channels/accounts/${encodeURIComponent(self.channelId)}/${encodeURIComponent(self.accountId)}`,
      { method: "PUT", body: JSON.stringify(fields) },
    );
    // Desktop REST handler -> channelManager.updateAccount() -> Desktop MST -> SSE -> Panel auto-updates
  }),

  /** Delete this channel account. */
  delete: flow(function* () {
    yield fetchJson(
      `/channels/accounts/${encodeURIComponent(self.channelId)}/${encodeURIComponent(self.accountId)}`,
      { method: "DELETE" },
    );
    // Desktop REST handler -> channelManager.removeAccount() -> Desktop MST -> SSE -> Panel auto-updates
  }),
}));
