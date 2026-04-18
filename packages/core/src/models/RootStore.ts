import { types, type Instance } from "mobx-state-tree";
import { ToolModel } from "./ToolSpec.js";
import { SurfaceModel } from "./Surface.js";
import { RunProfileModel } from "./RunProfile.js";
import { ShopModel } from "./Shop.js";
import { UserSubscriptionModel, LlmQuotaStatusModel } from "./Subscription.js";
import { ProviderKeyModel } from "./ProviderKey.js";
import { ChannelAccountModel } from "./ChannelAccount.js";
import { MobilePairingModel } from "./MobilePairing.js";
import { ToolCapabilityModel } from "./ToolCapability.js";
import { UserModel } from "./User.js";
import { PlatformAppModel } from "./PlatformApp.js";
import { ServiceCreditModel } from "./ServiceCredit.js";

export const RootStoreModel = types
  .model("RootStore", {
    /** System (core) tools — pre-seeded from SYSTEM_TOOL_CATALOG, filtered on gateway init. */
    systemTools: types.optional(types.array(ToolModel), []),
    /** Entitled tools from backend GraphQL (applySnapshot-safe with backend ToolSpec data). */
    entitledTools: types.optional(types.array(ToolModel), []),
    /** Client-side tools (from defineClientTool / gateway RPC). Separate to survive applySnapshot overwrites. */
    clientTools: types.optional(types.array(ToolModel), []),
    surfaces: types.optional(types.array(SurfaceModel), []),
    runProfiles: types.optional(types.array(RunProfileModel), []),
    shops: types.optional(types.array(ShopModel), []),
    providerKeys: types.optional(types.array(ProviderKeyModel), []),
    channelAccounts: types.optional(types.array(ChannelAccountModel), []),
    mobilePairings: types.optional(types.array(MobilePairingModel), []),
    subscriptionStatus: types.maybeNull(UserSubscriptionModel),
    llmQuotaStatus: types.maybeNull(LlmQuotaStatusModel),
    toolCapability: types.optional(ToolCapabilityModel, {}),
    currentUser: types.maybeNull(UserModel),
    platformApps: types.optional(types.array(PlatformAppModel), []),
    credits: types.optional(types.array(ServiceCreditModel), []),
  })
  .views((self) => ({
    get authenticated() {
      return self.currentUser !== null;
    },
    get enrolledModules(): string[] {
      return self.currentUser?.enrolledModules ? [...self.currentUser.enrolledModules] : [];
    },
    isModuleEnrolled(moduleId: string) {
      return self.currentUser?.enrolledModules?.includes(moduleId) ?? false;
    },
  }))
  .views((self) => ({
    /** All tools across all sources: system + entitled + client. */
    get allTools() {
      return [...self.systemTools, ...self.entitledTools, ...self.clientTools];
    },
    /** @deprecated Use allTools */
    get mergedToolSpecs() {
      return [...self.entitledTools, ...self.clientTools];
    },
    /** @deprecated Use entitledTools */
    get toolSpecs() {
      return self.entitledTools;
    },
    getDerivedSurfaces() {
      // Surfaces are derived from entitled + client tools (system tools have no surfaces)
      const specs = this.mergedToolSpecs;
      const surfaceMap = new Map<string, string[]>();
      for (const spec of specs) {
        for (const name of spec.surfaces) {
          let toolIds = surfaceMap.get(name);
          if (!toolIds) {
            toolIds = [];
            surfaceMap.set(name, toolIds);
          }
          toolIds.push(spec.id);
        }
      }
      const derived: { id: string; name: string; allowedToolIds: string[]; userId: string }[] = [];
      for (const [name, toolIds] of surfaceMap) {
        derived.push({ id: name, name, allowedToolIds: toolIds, userId: "" });
      }
      return derived;
    },
    getToolIdsForSurface(surfaceName: string) {
      const target = surfaceName.toUpperCase();
      return this.mergedToolSpecs
        .filter((spec) => spec.surfaces.some((s: string) => s.toUpperCase() === target))
        .map((spec) => spec.id);
    },
    getToolIdsForRunProfile(profileName: string) {
      const target = profileName.toUpperCase();
      return this.mergedToolSpecs
        .filter((spec) => spec.runProfiles.some((rp: string) => rp.toUpperCase() === target))
        .map((spec) => spec.id);
    },
    getChannelAccount(channelId: string, accountId: string) {
      return self.channelAccounts.find((a) => a.channelId === channelId && a.accountId === accountId);
    },
    getMobilePairing(id: string) {
      return self.mobilePairings.find((p) => p.id === id);
    },
    getMobilePairingByPairingId(pairingId: string) {
      return self.mobilePairings.find((p) => p.pairingId === pairingId);
    },
    getShop(id: string) {
      return self.shops.find((s) => s.id === id);
    },
    getShopByPlatformId(platformShopId: string) {
      return self.shops.find((s) => s.platformShopId === platformShopId);
    },
    getRunProfile(id: string) {
      return self.runProfiles.find((p) => p.id === id);
    },
    /** Return the single globally active provider key (isDefault === true). */
    getActiveProviderKey() {
      return self.providerKeys.find((k) => k.isDefault);
    },
    /** Return all provider keys for a given provider. */
    getProviderKeysByProvider(provider: string) {
      return self.providerKeys.filter((k) => k.provider === provider);
    },
  }))
  .views((self) => ({
    getDerivedRunProfiles() {
      const profileMap = new Map<string, string[]>();
      for (const spec of self.mergedToolSpecs) {
        for (const name of spec.runProfiles) {
          let toolIds = profileMap.get(name);
          if (!toolIds) {
            toolIds = [];
            profileMap.set(name, toolIds);
          }
          toolIds.push(spec.id);
        }
      }
      const derivedSurfaces = self.getDerivedSurfaces();
      const profiles: { id: string; name: string; selectedToolIds: string[]; surfaceId: string; userId: string }[] = [];
      for (const [name, toolIds] of profileMap) {
        const matchingSurface = derivedSurfaces.find((s) => {
          if (s.id === "Default") return false;
          const surfaceToolSet = new Set(s.allowedToolIds);
          return toolIds.every((tid) => surfaceToolSet.has(tid));
        });
        profiles.push({
          id: name,
          name,
          selectedToolIds: toolIds,
          surfaceId: matchingSurface?.id ?? "Default",
          userId: "",
        });
      }
      return profiles;
    },
    /** Pass-through to toolCapability.allSurfaces (backward compatibility). */
    get allSurfaces() {
      const defaultSurface = { id: "Default", name: "Default", allowedToolIds: [] as string[], userId: "" };
      return [
        defaultSurface,
        ...self.getDerivedSurfaces(),
        ...self.surfaces.map((s) => ({
          id: s.id,
          name: s.name,
          allowedToolIds: [...s.allowedToolIds],
          userId: s.userId,
        })),
      ];
    },
  }))
  .views((self) => ({
    get allRunProfiles() {
      return [
        ...self.getDerivedRunProfiles(),
        ...self.runProfiles.map((p) => ({
          id: p.id,
          name: p.name,
          selectedToolIds: [...p.selectedToolIds],
          surfaceId: p.surfaceId,
          userId: p.userId,
        })),
      ];
    },
    /** Available tools from ToolCapability sub-model (Panel reads this). */
    get availableTools() {
      return self.toolCapability.availableTools;
    },
  }));

export interface RootStore extends Instance<typeof RootStoreModel> {}
