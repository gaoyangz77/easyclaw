import { useState, useRef, useCallback, useEffect } from "react";
import { SSE } from "@rivonclaw/core/api-contract";
import { useToast } from "../../../components/Toast.js";
import { useTranslation } from "react-i18next";
import { useEntityStore } from "../../../store/EntityStoreProvider.js";
import { OAUTH_TIMEOUT_MS } from "../ecommerce-utils.js";

export function useOAuthFlow() {
  const { t } = useTranslation();
  const entityStore = useEntityStore();
  const { showToast } = useToast();

  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const oauthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const cleanupOAuthWait = useCallback(() => {
    if (oauthTimeoutRef.current) {
      clearTimeout(oauthTimeoutRef.current);
      oauthTimeoutRef.current = null;
    }
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setOauthWaiting(false);
    setOauthAuthUrl(null);
    setLinkCopied(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (oauthTimeoutRef.current) clearTimeout(oauthTimeoutRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  function startOAuthSSEListener(onOAuthComplete: () => void) {
    const sse = new EventSource(SSE["chat.events"].path);
    sseRef.current = sse;

    sse.addEventListener("oauth-complete", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { shopId: string; shopName: string; platform: string };
        cleanupOAuthWait();
        onOAuthComplete();
        showToast(t("ecommerce.oauthSuccess"), "success");
        // OAuth callback created the shop on backend; fetch it so Desktop
        // proxy ingests via ingestGraphQLResponse -> SSE patch -> table updates.
        entityStore.fetchShop(data.shopId).catch(() => {});
      } catch {
        // Ignore malformed data
      }
    });

    sse.addEventListener("error", () => {
      if (sse.readyState === EventSource.CLOSED) {
        console.warn("[EcommercePage] OAuth SSE connection closed");
      }
    });

    oauthTimeoutRef.current = setTimeout(() => {
      cleanupOAuthWait();
      showToast(t("ecommerce.oauthTimeout"), "error");
    }, OAUTH_TIMEOUT_MS);
  }

  async function initiateOAuth(
    platformAppId: string,
    onOAuthComplete: () => void,
    onError: (err: unknown) => void,
  ) {
    setOauthLoading(true);
    try {
      const { authUrl } = await entityStore.initiateTikTokOAuth(platformAppId);
      setOauthAuthUrl(authUrl);
      startOAuthSSEListener(onOAuthComplete);
      setOauthWaiting(true);
    } catch (err) {
      onError(err);
      throw err;
    } finally {
      setOauthLoading(false);
    }
  }

  async function handleCopyAuthUrl() {
    if (!oauthAuthUrl) return;
    try {
      await navigator.clipboard.writeText(oauthAuthUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback: select the text for manual copy
    }
  }

  function resetOAuthUI() {
    setOauthAuthUrl(null);
    setOauthWaiting(false);
    setLinkCopied(false);
  }

  return {
    oauthLoading,
    oauthWaiting,
    oauthAuthUrl,
    linkCopied,
    cleanupOAuthWait,
    initiateOAuth,
    handleCopyAuthUrl,
    resetOAuthUI,
  };
}
