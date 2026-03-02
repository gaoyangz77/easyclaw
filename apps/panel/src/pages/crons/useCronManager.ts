import { useState, useEffect, useRef, useCallback } from "react";
import { fetchGatewayInfo } from "../../api/index.js";
import { GatewayChatClient } from "../../lib/gateway-client.js";
import type { GatewayEvent } from "../../lib/gateway-client.js";
import type {
  CronJob,
  CronListResult,
  CronListParams,
  CronRunsResult,
  CronStatus,
} from "./cron-utils.js";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface CronManager {
  connectionState: ConnectionState;
  jobs: CronJob[];
  total: number;
  loading: boolean;
  error: string | null;

  fetchJobs: (params?: CronListParams) => Promise<void>;
  addJob: (params: Record<string, unknown>) => Promise<CronJob>;
  updateJob: (id: string, patch: Record<string, unknown>) => Promise<CronJob>;
  removeJob: (id: string) => Promise<void>;
  runJob: (id: string, mode?: "due" | "force") => Promise<unknown>;
  toggleEnabled: (id: string, enabled: boolean) => Promise<CronJob>;
  fetchRuns: (params: { id?: string; scope?: "job" | "all"; limit?: number; offset?: number; sortDir?: "asc" | "desc" }) => Promise<CronRunsResult>;
  fetchStatus: () => Promise<CronStatus>;
}

export function useCronManager(): CronManager {
  const clientRef = useRef<GatewayChatClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listParamsRef = useRef<CronListParams>({ limit: 100, offset: 0, enabled: "all", sortBy: "nextRunAtMs", sortDir: "asc" });

  const refreshJobs = useCallback(async (client: GatewayChatClient) => {
    try {
      setLoading(true);
      const result = await client.request<CronListResult>("cron.list", listParamsRef.current);
      setJobs(result.jobs);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const info = await fetchGatewayInfo();
        if (cancelled) return;

        const client = new GatewayChatClient({
          url: info.wsUrl,
          token: info.token,
          onConnected: () => {
            if (cancelled) return;
            setConnectionState("connected");
            refreshJobs(client);
          },
          onDisconnected: () => {
            if (cancelled) return;
            setConnectionState("connecting");
          },
          onEvent: (evt: GatewayEvent) => {
            if (cancelled) return;
            // Re-fetch on any cron event for real-time sync
            if (evt.event === "cron" && clientRef.current) {
              refreshJobs(clientRef.current);
            }
          },
        });

        clientRef.current = client;
        client.start();
      } catch (err) {
        if (cancelled) return;
        setConnectionState("disconnected");
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
      clientRef.current?.stop();
      clientRef.current = null;
    };
  }, [refreshJobs]);

  const fetchJobs = useCallback(async (params?: CronListParams) => {
    if (params) listParamsRef.current = { ...listParamsRef.current, ...params };
    if (!clientRef.current) return;
    await refreshJobs(clientRef.current);
  }, [refreshJobs]);

  const addJob = useCallback(async (params: Record<string, unknown>): Promise<CronJob> => {
    if (!clientRef.current) throw new Error("Not connected");
    const job = await clientRef.current.request<CronJob>("cron.add", params);
    return job;
  }, []);

  const updateJob = useCallback(async (id: string, patch: Record<string, unknown>): Promise<CronJob> => {
    if (!clientRef.current) throw new Error("Not connected");
    const job = await clientRef.current.request<CronJob>("cron.update", { id, patch });
    return job;
  }, []);

  const removeJob = useCallback(async (id: string): Promise<void> => {
    if (!clientRef.current) throw new Error("Not connected");
    await clientRef.current.request("cron.remove", { id });
  }, []);

  const runJob = useCallback(async (id: string, mode: "due" | "force" = "force"): Promise<unknown> => {
    if (!clientRef.current) throw new Error("Not connected");
    return clientRef.current.request("cron.run", { id, mode });
  }, []);

  const toggleEnabled = useCallback(async (id: string, enabled: boolean): Promise<CronJob> => {
    if (!clientRef.current) throw new Error("Not connected");
    return clientRef.current.request<CronJob>("cron.update", { id, patch: { enabled } });
  }, []);

  const fetchRuns = useCallback(async (params: { id?: string; scope?: "job" | "all"; limit?: number; offset?: number; sortDir?: "asc" | "desc" }): Promise<CronRunsResult> => {
    if (!clientRef.current) throw new Error("Not connected");
    return clientRef.current.request<CronRunsResult>("cron.runs", params);
  }, []);

  const fetchStatus = useCallback(async (): Promise<CronStatus> => {
    if (!clientRef.current) throw new Error("Not connected");
    return clientRef.current.request<CronStatus>("cron.status", {});
  }, []);

  return {
    connectionState,
    jobs,
    total,
    loading,
    error,
    fetchJobs,
    addJob,
    updateJob,
    removeJob,
    runJob,
    toggleEnabled,
    fetchRuns,
    fetchStatus,
  };
}
