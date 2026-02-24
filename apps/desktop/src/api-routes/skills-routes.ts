import { join } from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import AdmZip from "adm-zip";
import { createLogger } from "@easyclaw/logger";
import { initCSBridge, startCS, stopCS, getCSStatus, updateCSConfig } from "../customer-service-bridge.js";
import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody, proxiedFetch, parseSkillFrontmatter, invalidateSkillsSnapshot, USER_SKILLS_DIR } from "./route-utils.js";

const log = createLogger("panel-server");

export const handleSkillsRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  const { vendorDir } = ctx;

  // --- Skills Marketplace ---
  if (pathname === "/api/skills/market" && req.method === "GET") {
    const query = url.searchParams.get("query") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    const page = url.searchParams.get("page") ? Number(url.searchParams.get("page")) : undefined;
    const pageSize = url.searchParams.get("pageSize") ? Number(url.searchParams.get("pageSize")) : undefined;
    const chinaAvailableParam = url.searchParams.get("chinaAvailable");
    const chinaAvailable = chinaAvailableParam === "true" ? true : chinaAvailableParam === "false" ? false : undefined;
    const lang = url.searchParams.get("lang") ?? "en";
    const apiUrl = lang === "zh" ? "https://api-cn.easy-claw.com/graphql" : "https://api.easy-claw.com/graphql";
    try {
      const gqlRes = await proxiedFetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($query: String, $category: String, $page: Int, $pageSize: Int, $chinaAvailable: Boolean) {
            skills(query: $query, category: $category, page: $page, pageSize: $pageSize, chinaAvailable: $chinaAvailable) {
              skills { slug name_en name_zh desc_en desc_zh author version tags labels chinaAvailable stars downloads }
              total page pageSize
            }
          }`,
          variables: { query, category, page, pageSize, chinaAvailable },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!gqlRes.ok) {
        sendJson(res, 502, { error: `GraphQL API returned ${gqlRes.status}` });
        return true;
      }
      const json = (await gqlRes.json()) as { data?: { skills?: unknown } };
      sendJson(res, 200, json.data?.skills ?? { skills: [], total: 0, page: 1, pageSize: 20 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: msg });
    }
    return true;
  }

  if (pathname === "/api/skills/bundled-slugs" && req.method === "GET") {
    const resolvedVendorDir = vendorDir ?? join(import.meta.dirname, "..", "..", "..", "..", "vendor", "openclaw");
    const bundledSkillsDir = join(resolvedVendorDir, "skills");
    try {
      const entries = await fs.readdir(bundledSkillsDir);
      const slugs: string[] = [];
      for (const entry of entries) {
        const stat = await fs.stat(join(bundledSkillsDir, entry));
        if (stat.isDirectory()) slugs.push(entry);
      }
      sendJson(res, 200, { slugs });
    } catch {
      sendJson(res, 200, { slugs: [] });
    }
    return true;
  }

  if (pathname === "/api/skills/installed" && req.method === "GET") {
    const skillsDir = USER_SKILLS_DIR;
    try {
      let entries: string[];
      try {
        entries = await fs.readdir(skillsDir);
      } catch {
        sendJson(res, 200, { skills: [] });
        return true;
      }

      const skills: Array<{ slug: string; name?: string; description?: string; author?: string; version?: string }> = [];
      for (const entry of entries) {
        const entryPath = join(skillsDir, entry);
        const stat = await fs.stat(entryPath);
        if (!stat.isDirectory()) continue;

        let fmMeta: { name?: string; description?: string; author?: string; version?: string } = {};
        try {
          const content = await fs.readFile(join(entryPath, "SKILL.md"), "utf-8");
          fmMeta = parseSkillFrontmatter(content);
        } catch { /* SKILL.md missing or unreadable */ }

        let installMeta: { name?: string; description?: string; author?: string; version?: string } = {};
        try {
          installMeta = JSON.parse(await fs.readFile(join(entryPath, "_meta.json"), "utf-8"));
        } catch { /* _meta.json missing */ }

        skills.push({
          slug: entry,
          name: installMeta.name || fmMeta.name,
          description: installMeta.description || fmMeta.description,
          author: installMeta.author || fmMeta.author,
          version: installMeta.version || fmMeta.version,
        });
      }
      sendJson(res, 200, { skills });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return true;
  }

  if (pathname === "/api/skills/install" && req.method === "POST") {
    const body = (await parseBody(req)) as { slug?: string; lang?: string; meta?: { name?: string; description?: string; author?: string; version?: string } };
    if (!body.slug) {
      sendJson(res, 400, { error: "Missing required field: slug" });
      return true;
    }
    if (body.slug.includes("..") || body.slug.includes("/") || body.slug.includes("\\")) {
      sendJson(res, 400, { error: "Invalid slug" });
      return true;
    }

    const lang = body.lang ?? "en";
    const apiBase = lang === "zh"
      ? "https://api-cn.easy-claw.com"
      : "https://api.easy-claw.com";
    const downloadUrl = `${apiBase}/api/skills/${encodeURIComponent(body.slug)}/download`;

    try {
      const response = await proxiedFetch(downloadUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const errText = await response.text();
        sendJson(res, 200, { ok: false, error: `Server returned ${response.status}: ${errText}` });
        return true;
      }

      const zipBuffer = Buffer.from(await response.arrayBuffer());
      const skillsDir = USER_SKILLS_DIR;
      const skillDir = join(skillsDir, body.slug);
      await fs.mkdir(skillDir, { recursive: true });

      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(skillDir, true);

      if (body.meta) {
        await fs.writeFile(join(skillDir, "_meta.json"), JSON.stringify(body.meta), "utf-8");
      }

      invalidateSkillsSnapshot();
      sendJson(res, 200, { ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 200, { ok: false, error: msg });
    }
    return true;
  }

  if (pathname === "/api/skills/delete" && req.method === "POST") {
    const body = (await parseBody(req)) as { slug?: string };
    if (!body.slug) {
      sendJson(res, 400, { error: "Missing required field: slug" });
      return true;
    }
    if (body.slug.includes("..") || body.slug.includes("/") || body.slug.includes("\\")) {
      sendJson(res, 400, { error: "Invalid slug" });
      return true;
    }
    const skillsDir = USER_SKILLS_DIR;
    try {
      await fs.rm(join(skillsDir, body.slug), { recursive: true, force: true });
      invalidateSkillsSnapshot();
      sendJson(res, 200, { ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return true;
  }

  if (pathname === "/api/skills/open-folder" && req.method === "POST") {
    const skillsDir = USER_SKILLS_DIR;
    await fs.mkdir(skillsDir, { recursive: true });
    const cmd = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "explorer"
      : "xdg-open";
    execFile(cmd, [skillsDir], (err) => {
      if (err) {
        sendJson(res, 500, { error: err.message });
      } else {
        sendJson(res, 200, { ok: true });
      }
    });
    return true;
  }

  // --- Customer Service ---
  if (pathname === "/api/customer-service/status" && req.method === "GET") {
    const status = getCSStatus();
    sendJson(res, 200, status);
    return true;
  }

  if (pathname === "/api/customer-service/start" && req.method === "POST") {
    try {
      const body = await parseBody(req) as {
        businessPrompt?: string;
        platforms?: string[];
      };
      startCS({
        businessPrompt: body.businessPrompt ?? "",
        platforms: body.platforms ?? [],
      });
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return true;
  }

  if (pathname === "/api/customer-service/stop" && req.method === "POST") {
    stopCS();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/customer-service/config" && req.method === "PUT") {
    try {
      const body = await parseBody(req) as {
        businessPrompt?: string;
        platforms?: string[];
      };
      updateCSConfig(body);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return true;
  }

  if (pathname === "/api/customer-service/platforms" && req.method === "GET") {
    const status = getCSStatus();
    const platforms = (status?.platforms ?? []).map((p: { platform: string; boundCustomers: number }) => ({
      platform: p.platform,
      boundCustomers: p.boundCustomers,
    }));
    sendJson(res, 200, { platforms });
    return true;
  }

  return false;
};
