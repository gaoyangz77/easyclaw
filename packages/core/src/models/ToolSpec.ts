import { types, type Instance } from "mobx-state-tree";

export const ToolParamSpecModel: any = types.late(() =>
  types.model("ToolParamSpec", {
    name: types.string,
    type: types.string,
    description: types.string,
    graphqlVar: types.string,
    required: types.boolean,
    isList: types.maybe(types.boolean),
    defaultValue: types.maybeNull(types.string),
    enumValues: types.optional(types.array(types.string), []),
    children: types.optional(types.array(ToolParamSpecModel), []),
  }),
);

export const ToolContextBindingModel = types.model("ToolContextBinding", {
  paramName: types.string,
  contextField: types.string,
});

/**
 * Unified tool model — single MST representation for system, entitled, and client tools.
 *
 * The `source` field distinguishes origin:
 * - "system"   — core OpenClaw tools from the static catalog
 * - "entitled" — backend-provided tools via GraphQL (default for backend data)
 * - "client"   — local tools registered via defineClientTool / gateway RPC
 */
export const ToolModel = types
  .model("Tool", {
    id: types.identifier,
    name: types.string,
    displayName: types.string,
    description: types.optional(types.string, ""),
    supportsPersistResult: types.maybeNull(types.boolean),
    resultSchema: types.maybeNull(types.string),
    category: types.string,
    source: types.optional(types.string, "entitled"),
    operationType: types.optional(types.string, ""),
    graphqlOperation: types.maybeNull(types.string),
    restMethod: types.maybeNull(types.string),
    restEndpoint: types.maybeNull(types.string),
    restContentType: types.maybeNull(types.string),
    surfaces: types.optional(types.array(types.string), []),
    runProfiles: types.optional(types.array(types.string), []),
    supportedPlatforms: types.optional(types.array(types.string), []),
    parameters: types.optional(types.array(ToolParamSpecModel), []),
    contextBindings: types.optional(types.array(ToolContextBindingModel), []),
    prune: types.optional(types.array(types.string), []),
  })
  .views((self) => ({
    /** i18n key for the tool's category label. */
    get categoryKey(): string {
      return `tools.selector.category.${self.category}`;
    },
    /** i18n key for the tool's name label. */
    get nameKey(): string {
      return `tools.selector.name.${self.id}`;
    },
  }));

/** @deprecated Use ToolModel */
export const ToolSpecModel = ToolModel;

export type Tool = Instance<typeof ToolModel>;
/** @deprecated Use Tool */
export type ToolSpec = Tool;
export interface ToolParamSpec extends Instance<typeof ToolParamSpecModel> {}
export interface ToolContextBinding extends Instance<typeof ToolContextBindingModel> {}
