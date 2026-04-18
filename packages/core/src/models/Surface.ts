import { types, type Instance } from "mobx-state-tree";

export const SurfaceModel = types
  .model("Surface", {
    id: types.identifier,
    name: types.string,
    description: types.maybeNull(types.string),
    allowedToolIds: types.optional(types.array(types.string), []),
    userId: types.optional(types.string, ""),
    createdAt: types.string, // ISO DateTime
    updatedAt: types.string, // ISO DateTime
  })
  .views((self) => ({
    get isSystem() {
      return !self.userId;
    },
  }));

export interface Surface extends Instance<typeof SurfaceModel> {}
