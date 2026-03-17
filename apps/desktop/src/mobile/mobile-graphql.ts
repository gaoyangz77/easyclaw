import type {
  MobileGraphQLRequest,
  MobileGraphQLResponse,
  RegisterPairingInput,
  RegisterPairingResult,
} from "@rivonclaw/core";
import type { ApiContext } from "../api-routes/api-context.js";
import {
  readMobileAllowlist,
  writeMobileAllowlist,
} from "../api-routes/mobile-chat-routes.js";
import { resolveOpenClawConfigPath } from "@rivonclaw/gateway";
import { syncOwnerAllowFrom } from "../auth/owner-sync.js";

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

  const newPairing = ctx.storage.mobilePairings.setPairing({
    pairingId: input.pairingId,
    deviceId: input.desktopDeviceId,
    accessToken: input.accessToken,
    relayUrl: input.relayUrl,
    mobileDeviceId: input.mobileDeviceId,
  });

  ctx.mobileManager.clearActiveCode();

  // Add the pairing as a recipient in the mobile channel allowlist (keyed by pairingId)
  const recipientId = newPairing.pairingId || newPairing.id;
  try {
    const allowlist = await readMobileAllowlist();
    if (!allowlist.includes(recipientId)) {
      allowlist.push(recipientId);
      await writeMobileAllowlist(allowlist);
    }
    // Create channel_recipients record for label/owner management
    const isFirstRecipient = !ctx.storage.channelRecipients.hasAnyOwner();
    ctx.storage.channelRecipients.ensureExists(
      "mobile",
      recipientId,
      isFirstRecipient,
    );
    if (isFirstRecipient) {
      const configPath = resolveOpenClawConfigPath();
      syncOwnerAllowFrom(ctx.storage, configPath);
    }
    console.log(
      "[MobileChat] Added recipient to mobile allowlist:",
      recipientId,
    );
  } catch (err: any) {
    console.error("[MobileChat] Failed to update mobile allowlist:", err);
  }

  const rpcClient = ctx.getRpcClient?.();
  if (rpcClient?.isConnected()) {
    console.log(
      "[MobileChat] Sending mobile_chat_start_sync RPC. relayUrl:",
      input.relayUrl,
    );
    rpcClient
      .request("mobile_chat_start_sync", {
        pairingId: newPairing.pairingId || newPairing.id,
        accessToken: input.accessToken,
        relayUrl: input.relayUrl,
        desktopDeviceId: newPairing.deviceId,
        mobileDeviceId: newPairing.mobileDeviceId || newPairing.id,
      })
      .catch((err: any) => {
        console.error(
          "[MobileChat] Failed to start mobile sync via RPC:",
          err,
        );
      });
  } else {
    console.warn(
      "[MobileChat] RPC client not connected — cannot start sync engine. It will start on next gateway reconnect.",
    );
  }

  return {
    data: {
      registerPairing: {
        success: true,
        pairingId: recipientId,
      },
    },
  };
}
