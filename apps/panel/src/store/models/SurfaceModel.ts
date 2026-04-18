import { flow, getEnv } from "mobx-state-tree";
import { SurfaceModel as SurfaceModelBase } from "@rivonclaw/core/models";
import {
  UPDATE_SURFACE_MUTATION,
  DELETE_SURFACE_MUTATION,
} from "../../api/surfaces-queries.js";
import type { PanelStoreEnv } from "../types.js";

export const SurfaceModel = SurfaceModelBase.actions((self) => {
  const client = () => getEnv<PanelStoreEnv>(self).apolloClient;

  return {
    update: flow(function* (input: {
      name?: string;
      description?: string;
      allowedToolIds?: string[];
    }) {
      const result = yield client().mutate({
        mutation: UPDATE_SURFACE_MUTATION,
        variables: { id: self.id, input },
      });
      return result.data!.updateSurface;
    }),

    delete: flow(function* () {
      yield client().mutate({
        mutation: DELETE_SURFACE_MUTATION,
        variables: { id: self.id },
      });
      // Desktop proxy removes entity from Desktop MST → SSE patch → Panel auto-updates
    }),
  };
});
