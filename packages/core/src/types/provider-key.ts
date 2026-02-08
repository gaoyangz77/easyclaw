export interface ProviderKeyEntry {
  id: string;
  provider: string;
  label: string;
  model: string;
  isDefault: boolean;
  proxyBaseUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}
