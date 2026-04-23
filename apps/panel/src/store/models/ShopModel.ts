import { flow, getEnv } from "mobx-state-tree";
import { ShopModel as ShopModelBase } from "@rivonclaw/core/models";
import {
  UPDATE_SHOP_MUTATION,
  DELETE_SHOP_MUTATION,
  ECOMMERCE_UPDATE_SHOP_MUTATION,
} from "../../api/shops-queries.js";
import type { PanelStoreEnv } from "../types.js";

export const ShopModel = ShopModelBase.actions((self) => {
  const client = () => getEnv<PanelStoreEnv>(self).apolloClient;

  return {
    update: flow(function* (input: {
      shopName?: string;
      alias?: string;
      authStatus?: string;
      region?: string;
      services?: {
        customerService?: {
          enabled?: boolean;
          businessPrompt?: string;
          runProfileId?: string;
          csDeviceId?: string | null;
          csProviderOverride?: string | null;
          csModelOverride?: string | null;
          escalationChannelId?: string | null;
          escalationRecipientId?: string | null;
        };
      };
    }) {
      const result = yield client().mutate({
        mutation: UPDATE_SHOP_MUTATION,
        variables: { id: self.id, input },
      });
      return result.data!.updateShop;
    }),

    updateAlias: flow(function* (alias: string) {
      const result = yield client().mutate({
        mutation: ECOMMERCE_UPDATE_SHOP_MUTATION,
        variables: { shopId: self.id, alias },
      });
      return result.data!.ecommerceUpdateShop;
    }),

    delete: flow(function* () {
      yield client().mutate({
        mutation: DELETE_SHOP_MUTATION,
        variables: { id: self.id },
      });
      // Desktop proxy removes entity from Desktop MST → SSE patch → Panel auto-updates
    }),
  };
});
