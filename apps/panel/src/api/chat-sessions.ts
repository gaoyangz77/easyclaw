import { fetchJson } from "./client.js";

export interface ChatSessionMeta {
  key: string;
  customTitle: string | null;
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
    `/chat-sessions${qs ? `?${qs}` : ""}`,
  );
  return sessions;
}

export async function updateChatSession(
  key: string,
  fields: Partial<Pick<ChatSessionMeta, "customTitle" | "pinned" | "archivedAt">>,
): Promise<ChatSessionMeta> {
  const { session } = await fetchJson<{ session: ChatSessionMeta }>(
    `/chat-sessions/${encodeURIComponent(key)}`,
    { method: "PUT", body: JSON.stringify(fields) },
  );
  return session;
}

export async function deleteChatSession(key: string): Promise<void> {
  await fetchJson(`/chat-sessions/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}
