import type { BrowserProfileProxyTestResult } from "@rivonclaw/core";
import { getClient, trackedQuery } from "./apollo-client.js";
import {
  BROWSER_PROFILES_QUERY,
  CREATE_BROWSER_PROFILE_MUTATION,
  UPDATE_BROWSER_PROFILE_MUTATION,
  DELETE_BROWSER_PROFILE_MUTATION,
  BATCH_ARCHIVE_BROWSER_PROFILES_MUTATION,
  BATCH_DELETE_BROWSER_PROFILES_MUTATION,
} from "./browser-profiles-queries.js";

/** Shape returned by the cloud BrowserProfile type. */
export interface CloudBrowserProfile {
  id: string;
  name: string;
  proxyPolicy: { enabled: boolean; baseUrl?: string | null };
  sessionStatePolicy: {
    enabled: boolean;
    checkpointIntervalSec: number;
    mode: string;
    storage: string;
  };
  tags: string[];
  notes?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserProfilesPage {
  items: CloudBrowserProfile[];
  total: number;
  offset: number;
  limit: number;
}

export async function fetchBrowserProfiles(
  filter?: { status?: string[]; tags?: string[]; query?: string },
  pagination?: { offset?: number; limit?: number },
): Promise<BrowserProfilesPage> {
  return trackedQuery(async () => {
    const result = await getClient().query<{ browserProfiles: BrowserProfilesPage }>({
      query: BROWSER_PROFILES_QUERY,
      variables: { filter, pagination },
      fetchPolicy: "network-only",
    });
    if (!result.data) {
      throw new Error("No data returned from browserProfiles query");
    }
    return result.data.browserProfiles;
  });
}

export async function createBrowserProfile(input: {
  name: string;
  proxyEnabled?: boolean;
  proxyBaseUrl?: string | null;
  tags?: string[];
  notes?: string | null;
  sessionStatePolicy?: {
    enabled?: boolean;
    checkpointIntervalSec?: number;
    mode?: string;
    storage?: string;
  };
}): Promise<CloudBrowserProfile> {
  return trackedQuery(async () => {
    const { data } = await getClient().mutate<{ createBrowserProfile: CloudBrowserProfile }>({
      mutation: CREATE_BROWSER_PROFILE_MUTATION,
      variables: { input },
    });
    if (!data?.createBrowserProfile) {
      throw new Error("No data returned from createBrowserProfile mutation");
    }
    return data.createBrowserProfile;
  });
}

export async function updateBrowserProfile(
  id: string,
  input: {
    name?: string;
    proxyEnabled?: boolean;
    proxyBaseUrl?: string | null;
    tags?: string[];
    notes?: string | null;
    status?: string;
    sessionStatePolicy?: {
      enabled?: boolean;
      checkpointIntervalSec?: number;
      mode?: string;
      storage?: string;
    };
  },
): Promise<CloudBrowserProfile> {
  return trackedQuery(async () => {
    const { data } = await getClient().mutate<{ updateBrowserProfile: CloudBrowserProfile }>({
      mutation: UPDATE_BROWSER_PROFILE_MUTATION,
      variables: { id, input },
    });
    if (!data?.updateBrowserProfile) {
      throw new Error("No data returned from updateBrowserProfile mutation");
    }
    return data.updateBrowserProfile;
  });
}

export async function deleteBrowserProfile(id: string): Promise<void> {
  return trackedQuery(async () => {
    await getClient().mutate<{ deleteBrowserProfile: boolean }>({
      mutation: DELETE_BROWSER_PROFILE_MUTATION,
      variables: { id },
    });

    // Fire-and-forget: clean up local Chrome profile directory
    fetch(`/api/browser-profiles/${id}/data`, { method: "DELETE" }).catch(() => {});
  });
}

export async function batchArchiveBrowserProfiles(ids: string[]): Promise<number> {
  return trackedQuery(async () => {
    const { data } = await getClient().mutate<{ batchArchiveBrowserProfiles: number }>({
      mutation: BATCH_ARCHIVE_BROWSER_PROFILES_MUTATION,
      variables: { ids },
    });
    if (data?.batchArchiveBrowserProfiles == null) {
      throw new Error("No data returned from batchArchiveBrowserProfiles mutation");
    }
    return data.batchArchiveBrowserProfiles;
  });
}

export async function batchDeleteBrowserProfiles(ids: string[]): Promise<number> {
  return trackedQuery(async () => {
    const { data } = await getClient().mutate<{ batchDeleteBrowserProfiles: number }>({
      mutation: BATCH_DELETE_BROWSER_PROFILES_MUTATION,
      variables: { ids },
    });
    if (data?.batchDeleteBrowserProfiles == null) {
      throw new Error("No data returned from batchDeleteBrowserProfiles mutation");
    }
    return data.batchDeleteBrowserProfiles;
  });
}

export async function testBrowserProfileProxy(
  id: string,
): Promise<BrowserProfileProxyTestResult> {
  const res = await fetch("/api/browser-profiles/test-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    throw new Error(`Proxy test request failed: ${res.status}`);
  }
  return res.json() as Promise<BrowserProfileProxyTestResult>;
}
