# Data Flow & MST Architecture Rules

These rules govern how data flows between Panel, Desktop, and the cloud backend. They exist to maintain a single source of truth, prevent state drift, and keep the codebase auditable as it scales.

## GraphQL Gateway Rule

**All business GraphQL requests must be Panel MST model actions.**

- Panel UI components call `entity.action()` or `entityStore.action()` — never `getClient()` directly.
- No `getClient()` calls outside of MST model files (`store/models/*.ts`, `store/entity-store.ts`).
- Desktop does not independently trigger business GraphQL requests.
- **Exception**: Desktop auth bootstrap (`auth-session.ts`) — ME_QUERY, login, register, token refresh. These run before Panel loads and must bypass the proxy.

To verify compliance: `grep -r "getClient()" apps/panel/src/` should only show results in `store/entity-store.ts` (environment injection) and `api/apollo-client.ts` (definition).

## Mutation Return Rule

**Every GraphQL mutation that modifies an entity must return the full entity.**

- Never return `Boolean` or scalar for entity mutations — return the entity itself (e.g., `MeResponse`, `Shop`, `Surface`).
- Use shared fragments (e.g., `MeFields`, `ShopFields`) to ensure all fields are included.
- This enables Desktop proxy → `ingestGraphQLResponse` → MST → SSE → Panel auto-sync.
- **Delete mutations** return `Boolean` by design — handled by `DELETION_MUTATION_MAP` in the Desktop proxy.

## Unidirectional Data Flow

**Panel's MST state comes exclusively from Desktop via SSE. Panel never modifies its own entity collections.**

```
Panel MST action → GraphQL mutation → Desktop proxy
  → ingestGraphQLResponse → Desktop MST updated
  → SSE patch → Panel MST auto-updated
```

- Panel does not `splice`, `push`, or `destroy` on its own entity arrays.
- Panel does not manually set entity fields (no `(entity as any).field = value`).
- Desktop's `ingestGraphQLResponse` is the single ingestion point for all entity data.
- Delete operations: Desktop proxy uses `DELETION_MUTATION_MAP` to remove entities from Desktop MST after successful delete mutations.

## MST Model Action Patterns

### Entity mutations (update, delete) — on the model instance

```typescript
// ShopModel.ts
update: flow(function* (input) {
  yield client().mutate({ mutation: UPDATE_SHOP_MUTATION, variables: { id: self.id, input } });
  // Desktop proxy ingests response → SSE → Panel auto-updates
}),
```

### Entity creation — on PanelRootStoreModel

Create operations stay on the root store because the instance doesn't exist yet.

### Temporary data (pairing codes, skill templates) — MST action with return value

```typescript
// entityStore action — fires GQL, returns data to caller, nothing stored in MST
generatePairingCode: flow(function* (deviceId: string) {
  const result = yield client().mutate({ mutation: ..., variables: { deviceId } });
  return result.data.generatePairingCode;
}),
```

Components use the return value for local UI state. The data does not enter the MST tree.

## ToolCapability Resolver

### Tools are output, never input

`selectedToolIds` only appears as computation output from `computeEffectiveTools`. No function accepts tool lists as parameters — the resolver works with RunProfile IDs and resolves tools internally.

### ID-only session profiles

`sessionProfiles` stores `{ runProfileId, setAt }` — not copies of tool data. At query time, the resolver looks up the RunProfile by ID to get fresh `selectedToolIds` and `surfaceId`.

### Default RunProfile — single source of truth

`defaultRunProfileId` is read from `currentUser` (persisted via backend, synced via SSE) — not stored as a separate ephemeral field on `toolCapability`. This ensures the value survives app restart.

### Surface filtering is mandatory

`computeEffectiveTools` always resolves the Surface from the RunProfile's `surfaceId`. There is no code path that bypasses Layer 2 (Surface) filtering. The three-layer model is:

1. **Layer 1**: All available tools (system + entitled + extension)
2. **Layer 2**: Surface restriction (resolved from RunProfile's `surfaceId`)
3. **Layer 3**: RunProfile selection (intersection with Layer 2 result)

### Trusted scope without RunProfile

When no RunProfile is set for a trusted scope (CHAT_SESSION, CRON_JOB): return system tools + extension tools only. No entitlement tools without explicit RunProfile selection.

## Desktop auth-session.ts Query Strings

Desktop's `auth-session.ts` contains hardcoded GraphQL query strings (ME_QUERY, LOGIN_MUTATION, REGISTER_MUTATION, REFRESH_TOKEN_MUTATION). These must include ALL fields that the MST `UserModel` expects — especially `defaultRunProfileId`. When adding new fields to the User model, update these strings alongside the Panel's `MeFields` fragment.
