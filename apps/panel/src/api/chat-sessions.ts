import { fetchJson } from "./client.js";
import { API, clientPath } from "@rivonclaw/core/api-contract";

export interface ChatSessionMeta {
  key: string;
  customTitle: string | null;
  panelTitle: string | null;
  pinned: boolean;
  archivedAt: number | null;
  createdAt: number;
}

export async function fetchChatSessions(opts?: {
  archived?: boolean;
}): Promise<ChatSessionMeta[]> {
  const params = new URLSearchParams();
  if (opts?.archived != null) params.set("archived", String(opts.archived));
  const qs = params.toString();
  const { sessions } = await fetchJson<{ sessions: ChatSessionMeta[] }>(
    clientPath(API["chatSessions.list"]) + (qs ? `?${qs}` : ""),
  );
  return sessions;
}

export async function updateChatSession(
  key: string,
  fields: Partial<Pick<ChatSessionMeta, "customTitle" | "panelTitle" | "pinned" | "archivedAt">>,
): Promise<ChatSessionMeta> {
  const { session } = await fetchJson<{ session: ChatSessionMeta }>(
    clientPath(API["chatSessions.update"], { key }),
    { method: "PUT", body: JSON.stringify(fields) },
  );
  return session;
}

export async function deleteChatSession(key: string): Promise<void> {
  await fetchJson(clientPath(API["chatSessions.delete"], { key }), {
    method: "DELETE",
  });
}
