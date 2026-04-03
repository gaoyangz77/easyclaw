import type {
  MobileGraphQLRequest,
  MobileGraphQLResponse,
  RegisterPairingInput,
  RegisterPairingResult,
} from "@rivonclaw/core";
import type { ApiContext } from "../api-routes/api-context.js";

interface RegisterPairingData extends Record<string, unknown> {
  registerPairing: RegisterPairingResult;
}

function gqlError(
  message: string,
  path: string[],
  code?: string,
): MobileGraphQLResponse {
  return {
    data: null,
    errors: [{ message, path, extensions: code ? { code } : undefined }],
  };
}

export async function executeMobileGraphQL(
  req: MobileGraphQLRequest,
  ctx: ApiContext,
): Promise<MobileGraphQLResponse> {
  const text = `${req.operationName ?? ""}\n${req.query}`;

  if (text.includes("registerPairing")) {
    return handleRegisterPairing(req, ctx);
  }

  return gqlError("Unknown mobile GraphQL operation", [], "UNKNOWN_OPERATION");
}

async function handleRegisterPairing(
  req: MobileGraphQLRequest,
  ctx: ApiContext,
): Promise<MobileGraphQLResponse<RegisterPairingData>> {
  if (!ctx.mobileManager) {
    return gqlError(
      "Mobile Manager not initialized",
      ["registerPairing"],
      "INTERNAL_ERROR",
    ) as MobileGraphQLResponse<RegisterPairingData>;
  }

  const input = (req.variables?.input ?? {}) as RegisterPairingInput;

  if (!input.accessToken || !input.relayUrl || !input.desktopDeviceId) {
    return gqlError(
      "Missing required fields: desktopDeviceId, accessToken, relayUrl",
      ["registerPairing"],
      "BAD_INPUT",
    ) as MobileGraphQLResponse<RegisterPairingData>;
  }

  // Delegate to MobileManager — single code path for pairing persistence,
  // allowlist, channel_recipients, owner sync, and RPC sync start.
  ctx.mobileManager.completePairing({
    accessToken: input.accessToken,
    relayUrl: input.relayUrl,
    pairingId: input.pairingId,
    desktopDeviceId: input.desktopDeviceId,
    mobileDeviceId: input.mobileDeviceId,
  });

  // completePairing stores the pairing and returns via addPairing; read the
  // recipientId from MST so we can return it in the GraphQL response.
  const latest = ctx.mobileManager.root.mobilePairings;
  const last = latest.length > 0 ? latest[latest.length - 1] : null;
  const recipientId = (last as any)?.pairingId || (last as any)?.id || "";

  return {
    data: {
      registerPairing: {
        success: true,
        pairingId: recipientId,
      },
    },
  };
}
