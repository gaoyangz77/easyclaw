import { types, type Instance } from "mobx-state-tree";

export const ChannelAccountStatusModel = types.model("ChannelAccountStatus", {
  hasContextToken: types.maybeNull(types.boolean),
});

export const ChannelPairingRequestModel = types.model("ChannelPairingRequest", {
  id: types.string,
  code: types.string,
  createdAt: types.string,
  lastSeenAt: types.string,
  meta: types.optional(types.frozen<Record<string, string>>(), {}),
});

export const ChannelRecipientsModel = types.model("ChannelRecipients", {
  allowlist: types.optional(types.array(types.string), []),
  labels: types.optional(types.frozen<Record<string, string>>(), {}),
  owners: types.optional(types.frozen<Record<string, boolean>>(), {}),
  pairingRequests: types.optional(types.array(ChannelPairingRequestModel), []),
});

export const ChannelAccountModel = types.model("ChannelAccount", {
  channelId: types.string,
  accountId: types.string,
  name: types.maybeNull(types.string),
  config: types.frozen<Record<string, unknown>>(),
  status: types.optional(ChannelAccountStatusModel, {}),
  recipients: types.optional(ChannelRecipientsModel, {}),
});

export interface ChannelAccount extends Instance<typeof ChannelAccountModel> {}
