import { types, type Instance } from "mobx-state-tree";

export const ChannelAccountModel = types.model("ChannelAccount", {
  channelId: types.string,
  accountId: types.string,
  name: types.maybeNull(types.string),
  config: types.frozen<Record<string, unknown>>(),
});

export interface ChannelAccount extends Instance<typeof ChannelAccountModel> {}
