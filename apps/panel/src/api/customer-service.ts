import { fetchJson } from "./client.js";

// --- Customer Service (W19-0D) ---

export interface CustomerServiceStatus {
  connected: boolean;
  platforms: Array<{ platform: string; boundCustomers: number }>;
}

export interface CustomerServicePlatformInfo {
  platform: string;
  boundCustomers: number;
  bindingToken?: string;
  customerServiceUrl?: string;
}

export async function fetchCSStatus(): Promise<CustomerServiceStatus | null> {
  return fetchJson<CustomerServiceStatus | null>("/customer-service/status");
}

export async function startCS(config: {
  businessPrompt: string;
  platforms: string[];
}): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>("/customer-service/start", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function stopCS(): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>("/customer-service/stop", {
    method: "POST",
  });
}

export async function updateCSConfig(config: {
  businessPrompt?: string;
  platforms?: string[];
}): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>("/customer-service/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function fetchCSPlatforms(): Promise<CustomerServicePlatformInfo[]> {
  const data = await fetchJson<{ platforms: CustomerServicePlatformInfo[] }>("/customer-service/platforms");
  return data.platforms;
}

// --- WeCom Cloud Config ---

export interface WeComConfigInput {
  corpId: string;
  appSecret: string;
  token: string;
  encodingAesKey: string;
  kfLinkId: string;
}

export interface WeComConfigStatus {
  hasToken: boolean;
  corpId: string | null;
}

export async function fetchWeComConfigStatus(): Promise<WeComConfigStatus> {
  return fetchJson<WeComConfigStatus>("/wecom-config/status");
}

export async function saveWeComConfig(
  input: WeComConfigInput,
  panelToken: string,
  lang: string,
): Promise<{ wecom: Partial<WeComConfigInput> | null }> {
  return fetchJson<{ wecom: Partial<WeComConfigInput> | null }>("/wecom-config/save", {
    method: "POST",
    body: JSON.stringify({ ...input, panelToken, lang }),
  });
}

export async function deleteWeComConfig(
  corpId: string,
  panelToken: string,
  lang: string,
): Promise<{ wecom: { corpId: string } | null }> {
  return fetchJson<{ wecom: { corpId: string } | null }>("/wecom-config/delete", {
    method: "POST",
    body: JSON.stringify({ corpId, panelToken, lang }),
  });
}
