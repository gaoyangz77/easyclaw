import { useState, useEffect, useCallback } from "react";
import { fetchChannelStatus, fetchWeComBindingStatus, type ChannelsStatusSnapshot, type WeComBindingStatusResponse } from "../../api/index.js";

export function useChannelsData() {
  const [snapshot, setSnapshot] = useState<ChannelsStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wecomStatus, setWecomStatus] = useState<WeComBindingStatusResponse | null>(null);

  const loadWeComStatus = useCallback(async () => {
    try {
      const data = await fetchWeComBindingStatus();
      setWecomStatus(data);
    } catch {
      // API not implemented (501) or gateway not ready — show "not connected" state
      setWecomStatus(null);
    }
  }, []);

  async function loadChannelStatus(showLoading = true) {
    if (showLoading) setLoading(true);
    if (showLoading) setError(null);

    try {
      const data = await fetchChannelStatus(true);
      setError(null);
      setSnapshot(data);
    } catch (err) {
      // Only show error on initial load; background refreshes keep existing data
      if (showLoading || !snapshot) {
        setError(String(err));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  /** Retry loading until gateway is back (after config changes trigger a restart). */
  function retryUntilReady(attempt = 0) {
    const delays = [1500, 3000, 5000];
    const delay = delays[attempt] ?? delays[delays.length - 1];
    setTimeout(async () => {
      try {
        const data = await fetchChannelStatus(true);
        setError(null);
        setSnapshot(data);
      } catch {
        if (attempt < delays.length - 1) {
          retryUntilReady(attempt + 1);
        }
      }
    }, delay);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      setRefreshing(true);
      try {
        const data = await fetchChannelStatus(true);
        setError(null);
        setSnapshot(data);
        setLoading(false);
        setRefreshing(false);
        // Also fetch WeCom status
        loadWeComStatus();
        // Healthy — next poll in 30s
        timer = setTimeout(poll, 30000);
      } catch (err) {
        setLoading(false);
        setRefreshing(false);
        if (!snapshot) setError(String(err));
        // Gateway not ready — retry in 2s
        timer = setTimeout(poll, 2000);
      }
    }

    poll();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [loadWeComStatus]);

  function handleRefresh() {
    setRefreshing(true);
    loadChannelStatus(false);
  }

  return {
    snapshot, loading, error, refreshing, wecomStatus,
    setWecomStatus,
    loadChannelStatus, retryUntilReady, loadWeComStatus,
    handleRefresh,
  };
}
