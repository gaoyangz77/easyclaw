import { fetchJson, cachedFetch, invalidateCache } from "./client.js";

// --- Skills Marketplace ---

export interface MarketSkill {
  slug: string;
  name_en: string;
  name_zh: string;
  desc_en: string;
  desc_zh: string;
  author: string;
  version: string;
  tags: string[];
  labels: string[];
  chinaAvailable: boolean;
  stars: number;
  downloads: number;
  hidden: boolean;
}

export interface InstalledSkill {
  slug: string;
  name: string;
  description: string;
  author: string;
  version: string;
  filePath: string;
  installedAt: string;
}

export interface SkillCategory {
  id: string;
  name_en: string;
  name_zh: string;
  count: number;
}

export interface MarketResponse {
  skills: MarketSkill[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchMarketSkills(params?: {
  query?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  chinaAvailable?: boolean;
  lang?: string;
}): Promise<MarketResponse> {
  const qs = new URLSearchParams();
  if (params?.query) qs.set("query", params.query);
  if (params?.category) qs.set("category", params.category);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params?.chinaAvailable !== undefined) qs.set("chinaAvailable", String(params.chinaAvailable));
  if (params?.lang) qs.set("lang", params.lang);
  const q = qs.toString();
  return fetchJson<MarketResponse>("/skills/market" + (q ? "?" + q : ""));
}

export async function fetchInstalledSkills(): Promise<InstalledSkill[]> {
  return cachedFetch("installed-skills", async () => {
    const data = await fetchJson<{ skills: InstalledSkill[] }>("/skills/installed");
    return data.skills;
  }, 5000);
}

export async function installSkill(
  slug: string,
  lang?: string,
  meta?: { name?: string; description?: string; author?: string; version?: string },
): Promise<{ ok: boolean; error?: string }> {
  const result = await fetchJson<{ ok: boolean; error?: string }>("/skills/install", {
    method: "POST",
    body: JSON.stringify({ slug, lang, meta }),
  });
  invalidateCache("installed-skills");
  return result;
}

export async function deleteSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
  const result = await fetchJson<{ ok: boolean; error?: string }>("/skills/delete", {
    method: "POST",
    body: JSON.stringify({ slug }),
  });
  invalidateCache("installed-skills");
  return result;
}

export async function openSkillsFolder(): Promise<void> {
  await fetchJson("/skills/open-folder", { method: "POST" });
}

export async function fetchBundledSlugs(): Promise<Set<string>> {
  return cachedFetch("bundled-slugs", async () => {
    const data = await fetchJson<{ slugs: string[] }>("/skills/bundled-slugs");
    return new Set(data.slugs);
  }, 60_000);
}
