export interface WeComRelayState {
  relayUrl: string;
  authToken: string;
  connected: boolean;
  externalUserId?: string;
  bindingToken?: string;
  customerServiceUrl?: string;
}

export interface WeComConnParams {
  relayUrl: string;
  authToken: string;
  gatewayId: string;
  gatewayWsUrl: string;
  gatewayToken?: string;
}

export interface SttManager {
  transcribe(audio: Buffer, format: string): Promise<string | null>;
  isEnabled(): boolean;
}

export interface WeComRelayDeps {
  pushChatSSE: (event: string, data: unknown) => void;
}

export const WECOM_RECONNECT_MIN_MS = 1_000;
export const WECOM_RECONNECT_MAX_MS = 30_000;
