import { useState, useEffect } from "react";
import { useEntityStore } from "../../../store/EntityStoreProvider.js";

export function useTikTokShopData() {
  const entityStore = useEntityStore();
  const [creditsLoading, setCreditsLoading] = useState(false);

  async function fetchPlatformApps() {
    try { await entityStore.fetchPlatformApps(); } catch { /* ignore */ }
  }

  async function fetchCredits() {
    setCreditsLoading(true);
    try { await entityStore.fetchCredits(); } catch { /* ignore */ } finally { setCreditsLoading(false); }
  }

  // Fetch platform apps on mount when user exists
  const user = entityStore.currentUser;
  useEffect(() => {
    if (user) {
      fetchPlatformApps();
    }
  }, [user]);

  return {
    creditsLoading,
    fetchPlatformApps,
    fetchCredits,
  };
}
