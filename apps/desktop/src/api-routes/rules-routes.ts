import { randomUUID } from "node:crypto";
import type { ArtifactStatus, ArtifactType } from "@easyclaw/core";
import { removeSkillFile } from "@easyclaw/rules";
import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody, extractIdFromPath } from "./route-utils.js";

export const handleRulesRoutes: RouteHandler = async (req, res, _url, pathname, ctx) => {
  const { storage, onRuleChange } = ctx;

  if (pathname === "/api/rules" && req.method === "GET") {
    const rules = storage.rules.getAll();
    const allArtifacts = storage.artifacts.getAll();

    const artifactByRuleId = new Map<string, { status: ArtifactStatus; type: ArtifactType }>();
    for (const artifact of allArtifacts) {
      artifactByRuleId.set(artifact.ruleId, {
        status: artifact.status,
        type: artifact.type,
      });
    }

    const enrichedRules = rules.map((rule) => {
      const artifact = artifactByRuleId.get(rule.id);
      return {
        ...rule,
        artifactStatus: artifact?.status,
        artifactType: artifact?.type,
      };
    });

    sendJson(res, 200, { rules: enrichedRules });
    return true;
  }

  if (pathname === "/api/rules" && req.method === "POST") {
    const body = (await parseBody(req)) as { text?: string };
    if (!body.text || typeof body.text !== "string") {
      sendJson(res, 400, { error: "Missing required field: text" });
      return true;
    }

    const id = randomUUID();
    const created = storage.rules.create({ id, text: body.text });
    onRuleChange?.("created", id);
    sendJson(res, 201, created);
    return true;
  }

  const ruleId = extractIdFromPath(pathname, "/api/rules/");
  if (ruleId) {
    if (req.method === "PUT") {
      const body = (await parseBody(req)) as { text?: string };
      if (!body.text || typeof body.text !== "string") {
        sendJson(res, 400, { error: "Missing required field: text" });
        return true;
      }

      const updated = storage.rules.update(ruleId, { text: body.text });
      if (!updated) {
        sendJson(res, 404, { error: "Rule not found" });
        return true;
      }

      onRuleChange?.("updated", ruleId);
      sendJson(res, 200, updated);
      return true;
    }

    if (req.method === "DELETE") {
      const artifacts = storage.artifacts.getByRuleId(ruleId);
      for (const artifact of artifacts) {
        if (artifact.type === "action-bundle" && artifact.outputPath) {
          removeSkillFile(artifact.outputPath);
        }
      }

      storage.artifacts.deleteByRuleId(ruleId);
      const deleted = storage.rules.delete(ruleId);
      if (!deleted) {
        sendJson(res, 404, { error: "Rule not found" });
        return true;
      }

      onRuleChange?.("deleted", ruleId);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  return false;
};
