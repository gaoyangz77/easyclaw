import { types, type Instance } from "mobx-state-tree";
import { assembleCsPrompt } from "../prompts/cs-prompt.js";

export const CustomerServiceConfigModel = types
  .model("CustomerServiceConfig", {
    enabled: types.optional(types.boolean, false),
    businessPrompt: types.optional(types.string, ""),
    csDeviceId: types.maybeNull(types.string),
    csProviderOverride: types.maybeNull(types.string),
    csModelOverride: types.maybeNull(types.string),
    escalationChannelId: types.maybeNull(types.string),
    escalationRecipientId: types.maybeNull(types.string),
    runProfileId: types.maybeNull(types.string),
    /**
     * Platform-managed CS system prompt, embedded on every shop response by
     * the backend (see `CustomerServiceSettings.platformSystemPrompt` virtual
     * getter). Same value for every shop on a given backend version; carried
     * per-shop so Panel MST / Desktop cs-bridge can assemble the final prompt
     * from `self`-props only — no root-store lookup, no separate singleton.
     *
     * Null until the first `shops` query / subscription payload arrives, or
     * when the backend has no platform prompt configured.
     */
    platformSystemPrompt: types.maybeNull(types.string),
  })
  .views((self) => ({
    /**
     * Fully assembled CS system prompt: platform prompt + business prompt.
     *
     * Resolved purely from this model's own props — no `getRoot`, no cross
     * entity lookup. Returns `null` when CS is disabled for the shop or when
     * the platform prompt is missing (either CS is turned off or the shop
     * payload has not arrived yet); consumers must treat `null` as
     * "not ready".
     */
    get assembledPrompt(): string | null {
      if (!self.enabled) return null;
      return assembleCsPrompt({
        platformSystemPrompt: self.platformSystemPrompt,
        businessPrompt: self.businessPrompt,
      });
    },
  }));

export const CustomerServiceBillingModel = types.model("CustomerServiceBilling", {
  balance: types.optional(types.integer, 0),
  balanceExpiresAt: types.maybeNull(types.string),
  periodEnd: types.maybeNull(types.string),
  tier: types.maybeNull(types.string),
});

export const ShopServiceConfigModel = types.model("ShopServiceConfig", {
  customerService: types.maybeNull(CustomerServiceConfigModel),
  customerServiceBilling: types.maybeNull(CustomerServiceBillingModel),
});

export const ShopModel = types.model("Shop", {
  id: types.identifier,
  platform: types.string,
  platformAppId: types.optional(types.string, ""),
  platformShopId: types.string,
  shopName: types.string,
  alias: types.optional(types.maybeNull(types.string), null),
  authStatus: types.optional(types.string, ""),
  region: types.optional(types.string, ""),
  accessTokenExpiresAt: types.maybeNull(types.string),
  refreshTokenExpiresAt: types.maybeNull(types.string),
  services: types.maybeNull(ShopServiceConfigModel),
});

export interface Shop extends Instance<typeof ShopModel> {}
export interface CustomerServiceConfig extends Instance<typeof CustomerServiceConfigModel> {}
export interface CustomerServiceBilling extends Instance<typeof CustomerServiceBillingModel> {}
export interface ShopServiceConfig extends Instance<typeof ShopServiceConfigModel> {}
