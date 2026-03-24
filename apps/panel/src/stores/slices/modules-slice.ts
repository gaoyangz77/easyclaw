import type { StateCreator } from "zustand";
import { getClient } from "../../api/apollo-client.js";
import { ENROLL_MODULE_MUTATION, UNENROLL_MODULE_MUTATION } from "../../api/auth-queries.js";
import type { GQL } from "@rivonclaw/core";
import type { PanelStore } from "../panel-store.js";

export type ModuleId = "GLOBAL_ECOMMERCE_SELLER";

export interface ModulesSlice {
  enrolledModules: Set<ModuleId>;
  enrollModule: (moduleId: ModuleId) => Promise<void>;
  unenrollModule: (moduleId: ModuleId) => Promise<void>;
  isModuleEnrolled: (moduleId: ModuleId) => boolean;
  /** Sync enrolled modules from user data (called after login / me query). */
  syncEnrolledModules: (modules: ModuleId[]) => void;
}

export const createModulesSlice: StateCreator<PanelStore, [], [], ModulesSlice> = (set, get) => ({
  enrolledModules: new Set(),

  enrollModule: async (moduleId) => {
    const { data } = await getClient().mutate<{ enrollModule: GQL.MeResponse }>({
      mutation: ENROLL_MODULE_MUTATION,
      variables: { moduleId },
    });
    if (data?.enrollModule) {
      set({ enrolledModules: new Set(data.enrollModule.enrolledModules as ModuleId[]) });
    }
  },

  unenrollModule: async (moduleId) => {
    const { data } = await getClient().mutate<{ unenrollModule: GQL.MeResponse }>({
      mutation: UNENROLL_MODULE_MUTATION,
      variables: { moduleId },
    });
    if (data?.unenrollModule) {
      set({ enrolledModules: new Set(data.unenrollModule.enrolledModules as ModuleId[]) });
    }
  },

  isModuleEnrolled: (moduleId) => {
    return get().enrolledModules.has(moduleId);
  },

  syncEnrolledModules: (modules) => {
    set({ enrolledModules: new Set(modules) });
  },
});
