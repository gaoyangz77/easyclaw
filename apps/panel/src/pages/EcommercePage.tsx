import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../components/modals/Modal.js";
import { ConfirmDialog } from "../components/modals/ConfirmDialog.js";
import { Select } from "../components/inputs/Select.js";
import { CloseIcon, CopyIcon, CheckIcon, InfoIcon, ShopIcon, RefreshIcon } from "../components/icons.js";
import { observer } from "mobx-react-lite";
import { useEntityStore } from "../store/EntityStoreProvider.js";
import type { Shop, ServiceCredit } from "@rivonclaw/core/models";
import { configManager } from "../lib/config-manager.js";
import { fetchJson } from "../api/client.js";
import { useToast } from "../components/Toast.js";
import { fetchInstalledSkills, writeSkillTemplate } from "../api/skills.js";
import { fetchCsSkillTemplate } from "../api/shops.js";

/** OAuth authorization timeout in milliseconds (5 minutes). */
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Balance threshold below which we show a "low balance" warning. */
const LOW_BALANCE_THRESHOLD = 50;

/** Days before expiry to show a "balance expiring" warning. */
const EXPIRY_WARNING_DAYS = 2;

function isBalanceLow(balance: number): boolean {
  return balance > 0 && balance < LOW_BALANCE_THRESHOLD;
}

function isBalanceExpiringSoon(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return diff > 0 && diff < EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
}

function isBalanceExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function hasUpgradeRequired(err: unknown): boolean {
  if (err && typeof err === "object" && "graphQLErrors" in err) {
    const gqlErrors = (err as { graphQLErrors: Array<{ extensions?: { upgradeRequired?: boolean } }> }).graphQLErrors;
    return gqlErrors?.some((e) => e.extensions?.upgradeRequired === true) ?? false;
  }
  return false;
}

function formatBalanceDisplay(
  balance: number | undefined | null,
  tier: string | undefined | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (balance === undefined || balance === null) return "\u2014";
  if (tier) return t("tiktokShops.balance.of", { balance, tier: t(`tiktokShops.tier.${tier}`, { defaultValue: tier }) });
  return t("tiktokShops.balance.remaining", { balance });
}

type DrawerTab = "overview" | "aiCustomerService";

export const EcommercePage = observer(function EcommercePage() {
  const { t } = useTranslation();
  const entityStore = useEntityStore();
  const user = entityStore.currentUser;
  const allTools = entityStore.availableTools;
  const shops = entityStore.shops;
  const runProfiles = entityStore.allRunProfiles;

  const platformApps = entityStore.platformApps;
  const credits = entityStore.credits;
  const sessionStats = entityStore.sessionStats;

  // Loading flags and selectedShopId are pure UI state
  const [platformAppsLoading, setPlatformAppsLoading] = useState(false);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [sessionStatsLoading, setSessionStatsLoading] = useState(false);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);

  const [upgradePrompt, setUpgradePrompt] = useState(false);
  const { showToast } = useToast();
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Connect Shop modal state
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("overview");
  const [editBusinessPrompt, setEditBusinessPrompt] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [redeemingCreditId, setRedeemingCreditId] = useState<string | null>(null);
  const [togglingServiceId, setTogglingServiceId] = useState<string | null>(null);
  const [savingRunProfile, setSavingRunProfile] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [confirmDeleteShopId, setConfirmDeleteShopId] = useState<string | null>(null);

  // Manual refresh state
  const [refreshing, setRefreshing] = useState(false);

  // Device CS binding state
  const [myDeviceId, setMyDeviceId] = useState<string | null>(null);
  const [bindConflictShopId, setBindConflictShopId] = useState<string | null>(null);
  const [togglingBindShopId, setTogglingBindShopId] = useState<string | null>(null);

  // Model options from the active LLM key's provider (same pattern as ChatPage)
  const [csModelOptions, setCsModelOptions] = useState<Array<{ value: string; label: string }>>([]);

  // Fallback polling ref for OAuth waiting (if SSE fails to deliver)

  // SSE listener for oauth_complete
  const oauthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const selectedShop = shops.find((s) => s.id === selectedShopId) ?? null;

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

  // Wrapper functions for fetching with loading state
  async function handleFetchPlatformApps() {
    setPlatformAppsLoading(true);
    try { await entityStore.fetchPlatformApps(); } catch { /* ignore */ } finally { setPlatformAppsLoading(false); }
  }
  async function handleFetchCredits() {
    setCreditsLoading(true);
    try { await entityStore.fetchCredits(); } catch { /* ignore */ } finally { setCreditsLoading(false); }
  }
  async function handleFetchSessionStats(shopId: string) {
    setSessionStatsLoading(true);
    try { await entityStore.fetchSessionStats(shopId); } catch { /* ignore */ } finally { setSessionStatsLoading(false); }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (oauthTimeoutRef.current) clearTimeout(oauthTimeoutRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  // Fetch deviceId from desktop on mount
  useEffect(() => {
    fetchJson<{ deviceId?: string }>("/status")
      .then((status) => setMyDeviceId(status.deviceId || null))
      .catch(() => setMyDeviceId(null));
  }, []);

  // Fetch platform apps on mount (shops arrive via MST/SSE)
  useEffect(() => {
    if (user) {
      handleFetchPlatformApps();
    }
  }, [user]);

  // Load model options from the active LLM key's provider (same pattern as ChatPage)
  useEffect(() => {
    function refreshModels() {
      configManager.getActiveKey().then(async (info) => {
        if (!info) { setCsModelOptions([]); return; }
        const models = await configManager.getModelsForProvider(info.provider);
        setCsModelOptions(models.map((m) => ({ value: m.id, label: m.name })));
      }).catch(() => setCsModelOptions([]));
    }
    refreshModels();
    return configManager.onChange(refreshModels);
  }, []);

  // Market containment mapping — for future-proofing
  const MARKET_CONTAINS: Record<string, string[]> = useMemo(() => ({
    US: ["US"],
    ROW: ["ROW"],
  }), []);

  const availableMarkets = useMemo(
    () => [...new Set(platformApps.map((app) => app.market))],
    [platformApps],
  );

  const matchingAppsForMarket = useMemo(() => {
    if (!selectedMarket) return [];
    const contained = MARKET_CONTAINS[selectedMarket] ?? [selectedMarket];
    return platformApps.filter((app) => contained.includes(app.market));
  }, [platformApps, selectedMarket, MARKET_CONTAINS]);

  const availablePlatforms = useMemo(
    () => [...new Set(matchingAppsForMarket.map((app) => app.platform))],
    [matchingAppsForMarket],
  );

  const matchedApps = useMemo(() => {
    if (!selectedMarket || !selectedPlatform) return [];
    const contained = MARKET_CONTAINS[selectedMarket] ?? [selectedMarket];
    return platformApps.filter(
      (app) => contained.includes(app.market) && app.platform === selectedPlatform,
    );
  }, [platformApps, selectedMarket, selectedPlatform, MARKET_CONTAINS]);

  const selectedPlatformAppId = matchedApps.length === 1 ? matchedApps[0].id : "";

  const matchError = useMemo(() => {
    if (!selectedMarket || !selectedPlatform) return null;
    if (matchedApps.length === 0) return t("ecommerce.addShopModal.noMatch");
    if (matchedApps.length > 1) return t("ecommerce.addShopModal.multipleMatch");
    return null;
  }, [selectedMarket, selectedPlatform, matchedApps, t]);

  // Fetch credits on mount (user-level, not shop-specific)
  useEffect(() => {
    if (user) {
      handleFetchCredits();
    }
  }, [user]);

  // Load session stats when a shop is selected
  useEffect(() => {
    if (selectedShopId) {
      handleFetchSessionStats(selectedShopId);
    }
  }, [selectedShopId]);

  // Sync business prompt from shop data (re-runs when shop changes or after mutations refresh the shop)
  useEffect(() => {
    if (selectedShop) {
      setEditBusinessPrompt(selectedShop.services?.customerService?.businessPrompt ?? "");
    }
  }, [selectedShop?.id, selectedShop?.services?.customerService?.businessPrompt]);

  function handleError(err: unknown, fallbackKey: string) {
    if (hasUpgradeRequired(err)) {
      setUpgradePrompt(true);
    } else {
      setUpgradePrompt(false);
      showToast(err instanceof Error ? err.message : t(fallbackKey), "error");
    }
  }

  function startOAuthSSEListener() {
    const sse = new EventSource("/api/chat/events");
    sseRef.current = sse;

    sse.addEventListener("oauth-complete", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { shopId: string; shopName: string; platform: string };
        cleanupOAuthWait();
        setConnectModalOpen(false);
        showToast(t("ecommerce.oauthSuccess"), "success");
        // Shops auto-update via MST/SSE — no manual fetch needed
        void data;
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

  async function handleRefreshShops() {
    setRefreshing(true);
    try {
      await handleFetchPlatformApps();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleConnectShop() {
    if (!selectedPlatformAppId) return;
    setOauthLoading(true);
    setUpgradePrompt(false);
    try {
      const { authUrl } = await entityStore.initiateTikTokOAuth(selectedPlatformAppId);
      setOauthAuthUrl(authUrl);
      startOAuthSSEListener();
      setOauthWaiting(true);
    } catch (err) {
      handleError(err, "ecommerce.oauthFailed");
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

  function handleCancelOAuth() {
    cleanupOAuthWait();

    setConnectModalOpen(false);
  }

  async function handleReauthorize(shopId: string) {
    const shop = shops.find((s) => s.id === shopId);
    const appId = shop?.platformAppId || (platformApps.length > 0 ? platformApps[0].id : "");
    if (!appId) {
      showToast(t("ecommerce.oauthFailed"), "error");
      return;
    }

    setOauthLoading(true);


    setUpgradePrompt(false);
    try {
      const { authUrl } = await entityStore.initiateTikTokOAuth(appId);
      setOauthAuthUrl(authUrl);
      setConnectModalOpen(true);
      startOAuthSSEListener();
      setOauthWaiting(true);
    } catch (err) {
      handleError(err, "ecommerce.oauthFailed");
    } finally {
      setOauthLoading(false);
    }
  }

  async function handleDeleteShop(shopId: string) {
    setConfirmDeleteShopId(null);

    setUpgradePrompt(false);
    try {
      await entityStore.deleteShop(shopId);
      // MST store auto-updates via SSE patch
      if (selectedShopId === shopId) {
        closeDrawer();
      }
      showToast(t("ecommerce.disconnectSuccess"), "success");
    } catch (err) {
      handleError(err, "ecommerce.deleteFailed");
    }
  }

  async function handleToggleCustomerService(shopId: string, currentValue: boolean) {
    setTogglingServiceId(shopId);

    setUpgradePrompt(false);
    try {
      await entityStore.updateShop(shopId, {
        services: { customerService: { enabled: !currentValue } },
      });
      showToast(t(!currentValue ? "ecommerce.csEnabled" : "ecommerce.csDisabled"), "success");
      // If enabling CS, auto-download skill template if not already installed (fire-and-forget)
      if (!currentValue) {
        fetchInstalledSkills()
          .then(async (installed) => {
            if (installed.some((s) => s.slug === "customer-service")) return;
            const content = await fetchCsSkillTemplate();
            if (content) await writeSkillTemplate("customer-service", content);
          })
          .catch(() => {}); // Silent — skill template is optional
      }
      // If disabling CS while on the AI CS tab, switch back to overview
      if (currentValue && activeTab === "aiCustomerService") {
        setActiveTab("overview");
      }
    } catch (err) {
      handleError(err, "ecommerce.updateFailed");
    } finally {
      setTogglingServiceId(null);
    }
  }

  async function handleSaveBusinessPrompt() {
    if (!selectedShopId) return;
    setSavingSettings(true);

    setUpgradePrompt(false);
    try {
      await entityStore.updateShop(selectedShopId, {
        services: { customerService: { businessPrompt: editBusinessPrompt } },
      });
      showToast(t("common.saved"), "success");
    } catch (err) {
      handleError(err, "ecommerce.updateFailed");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleRunProfileChange(profileId: string) {
    if (!selectedShopId) return;
    setSavingRunProfile(true);

    setUpgradePrompt(false);
    try {
      await entityStore.updateShop(selectedShopId, {
        services: { customerService: { runProfileId: profileId } },
      });
      showToast(t("common.saved"), "success");
    } catch (err) {
      handleError(err, "ecommerce.updateFailed");
    } finally {
      setSavingRunProfile(false);
    }
  }

  async function handleCSModelChange(modelRef: string) {
    if (!selectedShopId) return;
    setSavingModel(true);

    setUpgradePrompt(false);
    try {
      await entityStore.updateShop(selectedShopId, {
        services: { customerService: { csModelOverride: modelRef || null } },
      });
      showToast(t("common.saved"), "success");
    } catch (err) {
      handleError(err, "ecommerce.updateFailed");
    } finally {
      setSavingModel(false);
    }
  }

  async function handleBindDevice(shopId: string) {
    if (!myDeviceId) return;
    const shop = shops.find((s) => s.id === shopId);
    if (!shop) return;
    const existingDeviceId = shop.services?.customerService?.csDeviceId;
    if (existingDeviceId && existingDeviceId !== myDeviceId) {
      // Another device is handling this shop — ask for confirmation
      setBindConflictShopId(shopId);
      return;
    }
    setTogglingBindShopId(shopId);
    try {
      await entityStore.updateShop(shopId, {
        services: { customerService: { csDeviceId: myDeviceId } },
      });
      showToast(t("ecommerce.deviceBound"), "success");
    } catch {
      showToast(t("ecommerce.updateFailed"), "error");
    } finally {
      setTogglingBindShopId(null);
    }
  }

  async function handleForceBindConfirmed() {
    const shopId = bindConflictShopId;
    setBindConflictShopId(null);
    if (!shopId || !myDeviceId) return;
    setTogglingBindShopId(shopId);
    try {
      await entityStore.updateShop(shopId, {
        services: { customerService: { csDeviceId: myDeviceId } },
      });
      showToast(t("ecommerce.deviceBound"), "success");
    } catch {
      showToast(t("ecommerce.updateFailed"), "error");
    } finally {
      setTogglingBindShopId(null);
    }
  }

  async function handleUnbindDevice(shopId: string) {
    setTogglingBindShopId(shopId);
    try {
      await entityStore.updateShop(shopId, {
        services: { customerService: { csDeviceId: null } },
      });
      showToast(t("ecommerce.deviceUnbound"), "success");
    } catch {
      showToast(t("ecommerce.updateFailed"), "error");
    } finally {
      setTogglingBindShopId(null);
    }
  }

  async function handleRedeemCredit(credit: ServiceCredit) {
    if (!selectedShopId) return;
    setRedeemingCreditId(credit.id);

    setUpgradePrompt(false);
    try {
      await entityStore.redeemCredit(credit.id, selectedShopId);
      showToast(t("ecommerce.shopDrawer.billing.redeemSuccess"), "success");
      handleFetchSessionStats(selectedShopId);
    } catch (err) {
      handleError(err, "ecommerce.updateFailed");
    } finally {
      setRedeemingCreditId(null);
    }
  }

  function openDrawer(shopId: string) {
    setSelectedShopId(shopId);
    setActiveTab("overview");

    setUpgradePrompt(false);

    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    // Delay clearing selection so close animation plays
    setTimeout(() => {
      setSelectedShopId(null);
  
      setUpgradePrompt(false);
    }, 300);
  }

  function getAuthStatusBadgeClass(status: string): string {
    switch (status) {
      case "AUTHORIZED":
        return "badge badge-active";
      case "TOKEN_EXPIRED":
        return "badge badge-warning";
      case "REVOKED":
      case "PENDING_AUTH":
        return "badge badge-danger";
      case "DISCONNECTED":
        return "badge badge-muted";
      default:
        return "badge badge-muted";
    }
  }

  function getBalanceBadge(shop: Shop): JSX.Element | null {
    const billing = shop.services?.customerServiceBilling;
    if (!billing) return null;

    if (billing.balance === 0) {
      return <span className="badge badge-danger">{t("tiktokShops.balance.none")}</span>;
    }
    if (isBalanceExpired(billing.balanceExpiresAt)) {
      return <span className="badge badge-danger">{t("tiktokShops.balance.expired")}</span>;
    }
    if (isBalanceLow(billing.balance)) {
      return <span className="badge badge-warning">{t("tiktokShops.balance.low")}</span>;
    }
    if (isBalanceExpiringSoon(billing.balanceExpiresAt)) {
      return (
        <span className="badge badge-warning">
          {t("tiktokShops.balance.expiring", {
            date: new Date(billing.balanceExpiresAt!).toLocaleDateString(),
          })}
        </span>
      );
    }
    return null;
  }

  const selectedRunProfileId = selectedShop?.services?.customerService?.runProfileId ?? "";
  const selectedRunProfile = runProfiles.find((p) => p.id === selectedRunProfileId) ?? null;

  const runProfileOptions = useMemo(
    () => runProfiles.map((p) => ({
      value: p.id,
      label: !p.userId ? (t(`surfaces.systemNames.${p.name}`, { defaultValue: p.name }) as string) : p.name,
    })),
    [runProfiles],
  );

  const selectedCSModel = selectedShop?.services?.customerService?.csModelOverride ?? "";
  const csModelUnavailable = !!selectedCSModel && !csModelOptions.some((o) => o.value === selectedCSModel);

  // Prepend "Default" option; append unavailable marker if current override is not in the list
  const csModelSelectOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [
      { value: "", label: t("ecommerce.shopDrawer.aiCS.csModelDefault") },
      ...csModelOptions,
    ];
    if (selectedCSModel && !opts.some((o) => o.value === selectedCSModel)) {
      opts.push({ value: selectedCSModel, label: selectedCSModel });
    }
    return opts;
  }, [csModelOptions, selectedCSModel, t]);

  function toolDisplayName(toolId: string): string {
    const tool = allTools.find((t) => t.id === toolId);
    const catLabel = tool?.category ? t(`tools.selector.category.${tool.category}`, { defaultValue: "" }) : "";
    const nameLabel = t(`tools.selector.name.${toolId}`, { defaultValue: tool?.displayName ?? toolId });
    return catLabel ? `${catLabel} — ${nameLabel}` : nameLabel;
  }

  const csCredits = credits.filter((c) => c.service === "CUSTOMER_SERVICE" && c.status === "AVAILABLE");

  if (!user) {
    return (
      <div className="page-enter">
        <div className="section-card">
          <h2>{t("auth.loginRequired")}</h2>
          <p>{t("auth.loginFromSidebar")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <div className="ecommerce-page-header">
        <div>
          <h1>
            {t("ecommerce.title")}
            <button
              className="btn-icon-inline"
              onClick={handleRefreshShops}
              disabled={refreshing}
              aria-label={t("ecommerce.refreshShops")}
              title={t("ecommerce.refreshShops")}
            >
              <RefreshIcon className={refreshing ? "spin" : ""} />
            </button>
          </h1>
          <p className="ecommerce-page-subtitle">{t("ecommerce.subtitle")}</p>
        </div>
        <div className="ecommerce-header-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setOauthAuthUrl(null);
              setOauthWaiting(false);
              setLinkCopied(false);
              // Auto-select first available market and platform
              const firstMarket = availableMarkets.length > 0 ? availableMarkets[0] : "";
              setSelectedMarket(firstMarket);
              if (firstMarket) {
                const contained = MARKET_CONTAINS[firstMarket] ?? [firstMarket];
                const appsForMarket = platformApps.filter((app) => contained.includes(app.market));
                const platforms = [...new Set(appsForMarket.map((app) => app.platform))];
                setSelectedPlatform(platforms.length > 0 ? platforms[0] : "");
              } else {
                setSelectedPlatform("");
              }
              setConnectModalOpen(true);
            }}
            disabled={oauthLoading}
          >
            {t("ecommerce.addShop")}
          </button>
        </div>
      </div>

      {upgradePrompt && (
        <div className="info-box info-box-blue">
          {t("ecommerce.upgradeRequired")}
        </div>
      )}

      {/* Shop Table */}
      <div className="section-card">
        {shops.length === 0 ? (
          <div className="empty-cell">{t("ecommerce.noShops")}</div>
        ) : (
          <table className="shop-table">
            <thead>
              <tr>
                <th>{t("ecommerce.table.headers.name")}</th>
                <th>{t("ecommerce.table.headers.platform")}</th>
                <th>{t("ecommerce.table.headers.region")}</th>
                <th>{t("ecommerce.table.headers.authStatus")}</th>
                <th>{t("ecommerce.table.headers.csBalance")}</th>
                <th className="text-right">{t("ecommerce.table.headers.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => {
                const billing = shop.services?.customerServiceBilling;
                return (
                  <tr key={shop.id}>
                    <td>
                      <span className="shop-table-name">{shop.shopName}</span>
                    </td>
                    <td>{shop.platform === "TIKTOK_SHOP" ? "TikTok" : shop.platform}</td>
                    <td>{shop.region}</td>
                    <td>
                      <span className={getAuthStatusBadgeClass(shop.authStatus)}>
                        {t(`tiktokShops.authStatus_${shop.authStatus}`)}
                      </span>
                    </td>
                    <td>
                      <span className="shop-balance-cell">
                        {billing
                          ? formatBalanceDisplay(billing.balance, billing.tier, t)
                          : "\u2014"}
                        {getBalanceBadge(shop)}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="td-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openDrawer(shop.id)}
                        >
                          {t("ecommerce.view")}
                        </button>
                        {shop.authStatus === "TOKEN_EXPIRED" && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleReauthorize(shop.id)}
                            disabled={oauthLoading || oauthWaiting}
                          >
                            {t("ecommerce.reauthorize")}
                          </button>
                        )}
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => setConfirmDeleteShopId(shop.id)}
                        >
                          {t("ecommerce.disconnect")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Shop Modal */}
      <Modal
        isOpen={connectModalOpen}
        onClose={() => {
          if (oauthWaiting) {
            cleanupOAuthWait();
          }
          setConnectModalOpen(false);
        }}
        title={t("ecommerce.addShopModal.title")}
        preventBackdropClose={oauthWaiting}
      >
        <div className="modal-form-col">
          {!oauthWaiting ? (
            <>
              <div>
                <label className="form-label-block">
                  {t("ecommerce.addShopModal.marketLabel")}
                </label>
                {platformApps.length === 0 ? (
                  <div className="form-hint">{t("tiktokShops.noPlatformApps")}</div>
                ) : (
                  <Select
                    value={selectedMarket}
                    onChange={(v) => {
                      setSelectedMarket(v);
                      setSelectedPlatform("");
                    }}
                    className="input-full"
                    placeholder={t("ecommerce.addShopModal.marketPlaceholder")}
                    options={availableMarkets.map((market) => ({
                      value: market,
                      label: t(`ecommerce.market.${market}`, { defaultValue: market }),
                    }))}
                  />
                )}
              </div>
              <div>
                <label className="form-label-block">
                  {t("ecommerce.addShopModal.platformLabel")}
                </label>
                <Select
                  value={selectedPlatform}
                  onChange={(v) => setSelectedPlatform(v)}
                  className="input-full"
                  placeholder={t("ecommerce.addShopModal.platformPlaceholder")}
                  disabled={!selectedMarket}
                  options={availablePlatforms.map((platform) => ({
                    value: platform,
                    label: t(`ecommerce.platform.${platform}`, { defaultValue: platform }),
                  }))}
                />
              </div>
              {matchError && (
                <div className="form-hint form-hint-error">{matchError}</div>
              )}
              <div className="modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setConnectModalOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleConnectShop}
                  disabled={oauthLoading || !selectedPlatformAppId}
                >
                  {oauthLoading ? t("common.loading") : t("ecommerce.addShopModal.addButton")}
                </button>
              </div>
            </>
          ) : (
            <div className="oauth-flow">
              <div className="oauth-flow-step">
                <span className="oauth-flow-step-num">1</span>
                <span className="oauth-flow-step-text">{t("ecommerce.addShopModal.authLink")}</span>
              </div>
              <div className="auth-link-box">
                <div className="auth-link-url-row">
                  <div className="auth-link-url">{oauthAuthUrl}</div>
                  <button
                    className={`auth-link-copy-btn${linkCopied ? " auth-link-copy-btn-success" : ""}`}
                    onClick={handleCopyAuthUrl}
                  >
                    {linkCopied ? <CheckIcon /> : <CopyIcon />}
                    {linkCopied
                      ? t("ecommerce.addShopModal.copySuccess")
                      : t("ecommerce.addShopModal.copyButton")}
                  </button>
                </div>
              </div>
              <div className="auth-link-hint">
                <InfoIcon />
                <span>{t("ecommerce.addShopModal.tooltip")}</span>
              </div>

              <div className="oauth-flow-step">
                <span className="oauth-flow-step-num">2</span>
                <span className="oauth-flow-step-text">{t("ecommerce.addShopModal.waitingAuth")}</span>
              </div>
              <div className="oauth-waiting-indicator">
                <span className="oauth-waiting-spinner" />
                <span className="oauth-waiting-text">{t("ecommerce.addShopModal.waitingAuth")}</span>
              </div>

              <div className="oauth-flow-actions">
                <button
                  className="btn btn-secondary"
                  onClick={handleCancelOAuth}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Shop Detail Drawer */}
      <div
        className={`drawer-overlay${drawerOpen ? " drawer-overlay-visible" : ""}`}
        onClick={closeDrawer}
      />
      <div className={`drawer-panel${drawerOpen ? " drawer-panel-open" : ""}`}>
        <div className="drawer-header">
          <div className="drawer-header-left">
            <span className="drawer-header-icon">
              <ShopIcon size={20} />
            </span>
            <div className="drawer-header-info">
              <h3 className="drawer-header-title">{selectedShop?.shopName ?? ""}</h3>
              {selectedShop && (
                <span className={getAuthStatusBadgeClass(selectedShop.authStatus)}>
                  {t(`tiktokShops.authStatus_${selectedShop.authStatus}`)}
                </span>
              )}
            </div>
          </div>
          <button className="drawer-close-btn" onClick={closeDrawer}>
            <CloseIcon size={18} />
          </button>
        </div>

        {selectedShop && (
          <div className="drawer-body">
            {upgradePrompt && (
              <div className="info-box info-box-blue">
                {t("ecommerce.upgradeRequired")}
              </div>
            )}

            {/* Tab Bar */}
            <div className="drawer-tab-bar">
              <button
                className={`drawer-tab-btn ${activeTab === "overview" ? "drawer-tab-btn-active" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                {t("ecommerce.shopDrawer.tabs.overview")}
              </button>
              {selectedShop.services?.customerService?.enabled && (
                <button
                  className={`drawer-tab-btn ${activeTab === "aiCustomerService" ? "drawer-tab-btn-active" : ""}`}
                  onClick={() => setActiveTab("aiCustomerService")}
                >
                  {t("ecommerce.shopDrawer.tabs.aiCustomerService")}
                </button>
              )}
            </div>

            {/* Tab: Overview */}
            {activeTab === "overview" && (
              <div className="shop-detail-section">
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.overview.shopInfo")}</div>
                <div className="shop-info-card">
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.table.headers.name")}</span>
                    <span className="shop-info-value">{selectedShop.shopName}</span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.table.headers.region")}</span>
                    <span className="shop-info-value">{selectedShop.region}</span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.table.headers.platform")}</span>
                    <span className="shop-info-value">{selectedShop.platform === "TIKTOK_SHOP" ? "TikTok Shop" : selectedShop.platform}</span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.table.headers.authStatus")}</span>
                    <span className={getAuthStatusBadgeClass(selectedShop.authStatus)}>
                      {t(`tiktokShops.authStatus_${selectedShop.authStatus}`)}
                    </span>
                  </div>
                </div>

                {/* Token Info */}
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.overview.tokenExpiry")}</div>
                <div className="shop-info-card">
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("tiktokShops.detail.accessTokenExpiry")}</span>
                    <span className={`shop-info-value${selectedShop.accessTokenExpiresAt && new Date(selectedShop.accessTokenExpiresAt).getTime() < Date.now() ? " shop-info-value-danger" : ""}`}>
                      {selectedShop.accessTokenExpiresAt
                        ? new Date(selectedShop.accessTokenExpiresAt).toLocaleString()
                        : "\u2014"}
                    </span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("tiktokShops.detail.refreshTokenExpiry")}</span>
                    <span className={`shop-info-value${selectedShop.refreshTokenExpiresAt && new Date(selectedShop.refreshTokenExpiresAt).getTime() < Date.now() ? " shop-info-value-danger" : ""}`}>
                      {selectedShop.refreshTokenExpiresAt
                        ? new Date(selectedShop.refreshTokenExpiresAt).toLocaleString()
                        : "\u2014"}
                    </span>
                  </div>
                </div>

                {/* Service Toggle */}
                <div className="shop-toggle-card">
                  <div className="shop-toggle-card-left">
                    <span className="shop-toggle-card-label">
                      {t("ecommerce.shopDrawer.overview.csToggle")}
                    </span>
                    <span className={selectedShop.services?.customerService?.enabled ? "badge badge-active" : "badge badge-muted"}>
                      {selectedShop.services?.customerService?.enabled
                        ? t("common.enabled")
                        : t("common.disabled")}
                    </span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={selectedShop.services?.customerService?.enabled}
                      onChange={() =>
                        handleToggleCustomerService(
                          selectedShop.id,
                          selectedShop.services?.customerService?.enabled ?? false,
                        )
                      }
                      disabled={togglingServiceId === selectedShop.id}
                    />
                    <span
                      className={`toggle-track ${selectedShop.services?.customerService?.enabled ? "toggle-track-on" : "toggle-track-off"} ${togglingServiceId === selectedShop.id ? "toggle-track-disabled" : ""}`}
                    >
                      <span
                        className={`toggle-thumb ${selectedShop.services?.customerService?.enabled ? "toggle-thumb-on" : "toggle-thumb-off"}`}
                      />
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Tab: AI Customer Service */}
            {activeTab === "aiCustomerService" && selectedShop.services?.customerService?.enabled && (
              <div className="shop-detail-section">
                {/* Service Status */}
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.aiCS.serviceStatus")}</div>
                <div className="shop-info-card">
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.shopDrawer.billing.balance")}</span>
                    <span className="shop-info-value">
                      {selectedShop.services?.customerServiceBilling
                        ? (selectedShop.services?.customerServiceBilling?.balance ?? 0)
                        : 0}
                      {getBalanceBadge(selectedShop)}
                    </span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.shopDrawer.billing.currentTier")}</span>
                    <span className="shop-info-value">
                      {selectedShop.services?.customerServiceBilling?.tier ? (
                        <span className="badge badge-active">{t(`tiktokShops.tier.${selectedShop.services?.customerServiceBilling?.tier}`, { defaultValue: selectedShop.services?.customerServiceBilling?.tier })}</span>
                      ) : (
                        t("ecommerce.shopDrawer.billing.noTier")
                      )}
                    </span>
                  </div>
                  {selectedShop.services?.customerServiceBilling?.balanceExpiresAt && (
                    <div className="shop-info-row">
                      <span className="shop-info-label">{t("ecommerce.shopDrawer.billing.expiry")}</span>
                      <span className="shop-info-value">
                        {new Date(selectedShop.services!.customerServiceBilling!.balanceExpiresAt!).toLocaleDateString()}
                        {isBalanceExpiringSoon(selectedShop.services?.customerServiceBilling?.balanceExpiresAt) && (
                          <span className="badge badge-warning shop-badge-inline">
                            {t("tiktokShops.balance.expiring", {
                              date: new Date(selectedShop.services!.customerServiceBilling!.balanceExpiresAt!).toLocaleDateString(),
                            })}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* Device CS Binding Toggle */}
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.aiCS.csBindDevice")}</div>
                <div className="shop-toggle-card">
                  <div className="shop-toggle-card-left">
                    <span className="shop-toggle-card-label">
                      {t("ecommerce.shopDrawer.aiCS.csBindDevice")}
                    </span>
                    <span className="form-hint">{t("ecommerce.shopDrawer.aiCS.csBindDeviceHint")}</span>
                    {selectedShop.services?.customerService?.csDeviceId && selectedShop.services?.customerService?.csDeviceId !== myDeviceId && (
                      <span className="badge badge-warning shop-badge-inline">
                        {t("ecommerce.shopDrawer.aiCS.csOtherDevice")}
                      </span>
                    )}
                    {selectedShop.services?.customerService?.csDeviceId && selectedShop.services?.customerService?.csDeviceId === myDeviceId && (
                      <span className="badge badge-success shop-badge-inline">
                        {t("ecommerce.shopDrawer.aiCS.csThisDevice")}
                      </span>
                    )}
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={selectedShop.services?.customerService?.csDeviceId === myDeviceId}
                      onChange={() => {
                        if (selectedShop.services?.customerService?.csDeviceId === myDeviceId) {
                          handleUnbindDevice(selectedShop.id);
                        } else {
                          handleBindDevice(selectedShop.id);
                        }
                      }}
                      disabled={togglingBindShopId === selectedShop.id || !myDeviceId}
                    />
                    <span
                      className={`toggle-track ${selectedShop.services?.customerService?.csDeviceId === myDeviceId ? "toggle-track-on" : "toggle-track-off"} ${togglingBindShopId === selectedShop.id ? "toggle-track-disabled" : ""}`}
                    >
                      <span
                        className={`toggle-thumb ${selectedShop.services?.customerService?.csDeviceId === myDeviceId ? "toggle-thumb-on" : "toggle-thumb-off"}`}
                      />
                    </span>
                  </label>
                </div>

                {/* RunProfile Selector */}
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.aiCS.runProfile")}</div>
                <div className="shop-info-card">
                  <div className="shop-runprofile-row">
                    <label className="form-label-block">{t("ecommerce.shopDrawer.aiCS.runProfileLabel")}</label>
                    <Select
                      value={selectedRunProfileId}
                      onChange={handleRunProfileChange}
                      options={runProfileOptions}
                      placeholder={t("ecommerce.shopDrawer.aiCS.runProfileNone")}
                      disabled={savingRunProfile}
                      className="input-full"
                    />
                  </div>
                  {selectedRunProfile ? (
                    <div className="shop-runprofile-tools">
                      <div className="form-label-block">{t("ecommerce.shopDrawer.aiCS.availableTools")}</div>
                      <ul className="shop-tool-list">
                        {selectedRunProfile.selectedToolIds.map((toolId) => (
                          <li key={toolId} className="shop-tool-list-item">{toolDisplayName(toolId)}</li>
                        ))}
                      </ul>
                      <div className="shop-tool-count">
                        {t("ecommerce.shopDrawer.aiCS.toolCount", { count: selectedRunProfile.selectedToolIds.length })}
                      </div>
                    </div>
                  ) : (
                    <div className="form-hint">{t("ecommerce.shopDrawer.aiCS.runProfileHint")}</div>
                  )}
                </div>

                {/* CS Model Override */}
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.aiCS.csModelOverride")}</div>
                <div className={`shop-info-card${csModelUnavailable ? " shop-info-card-warning" : ""}`}>
                  <div className="shop-runprofile-row">
                    <label className="form-label-block">{t("ecommerce.shopDrawer.aiCS.csModelOverride")}</label>
                    <Select
                      value={selectedCSModel}
                      onChange={handleCSModelChange}
                      options={csModelSelectOptions}
                      disabled={savingModel}
                      className={`input-full${csModelUnavailable ? " select-strikethrough" : ""}`}
                    />
                  </div>
                  {csModelUnavailable ? (
                    <div className="form-hint form-hint-warning">{t("ecommerce.shopDrawer.aiCS.csModelUnavailable")}</div>
                  ) : (
                    <div className="form-hint">{t("ecommerce.shopDrawer.aiCS.csModelOverrideHint")}</div>
                  )}
                </div>

                {/* Business Prompt */}
                <div className="shop-prompt-section">
                  <label className="drawer-section-label">
                    {t("ecommerce.shopDrawer.aiCS.businessPrompt")}
                  </label>
                  <div className="form-hint">{t("ecommerce.shopDrawer.overview.businessPromptHint")}</div>
                  <div className="shop-prompt-wrapper">
                    <textarea
                      className="input-full textarea-resize-vertical shop-prompt-textarea"
                      value={editBusinessPrompt}
                      onChange={(e) => setEditBusinessPrompt(e.target.value)}
                      rows={4}
                      maxLength={2000}
                    />
                    <span className="shop-prompt-charcount">
                      {editBusinessPrompt.length} / 2000
                    </span>
                  </div>
                  <div className="modal-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleSaveBusinessPrompt}
                      disabled={savingSettings || editBusinessPrompt === (selectedShop?.services?.customerService?.businessPrompt ?? "")}
                    >
                      {savingSettings ? t("common.loading") : t("ecommerce.shopDrawer.overview.save")}
                    </button>
                  </div>
                </div>

                {/* Service Credits */}
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.aiCS.credits")}</div>
                {creditsLoading ? (
                  <div className="empty-cell">{t("common.loading")}</div>
                ) : csCredits.length === 0 ? (
                  <div className="form-hint">{t("ecommerce.shopDrawer.aiCS.noCredits")}</div>
                ) : (
                  <div className="acct-item-list">
                    {csCredits.map((credit) => (
                      <div key={credit.id} className="acct-item">
                        <div className="acct-item-title-row">
                          <span className="acct-item-name">
                            {t("tiktokShops.credits.quota", { quota: credit.quota })}
                          </span>
                          <span className="badge badge-muted">{credit.source}</span>
                          <div className="acct-item-actions">
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleRedeemCredit(credit)}
                              disabled={redeemingCreditId === credit.id}
                            >
                              {redeemingCreditId === credit.id
                                ? t("common.loading")
                                : t("ecommerce.shopDrawer.billing.redeem")}
                            </button>
                          </div>
                        </div>
                        <div className="acct-item-meta">
                          <span>
                            {t("tiktokShops.credits.expires", {
                              date: new Date(credit.expiresAt).toLocaleDateString(),
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Session Stats */}
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.aiCS.sessions")}</div>
                {sessionStatsLoading ? (
                  <div className="empty-cell">{t("common.loading")}</div>
                ) : sessionStats ? (
                  <div className="session-stats-grid session-stats-grid-2col">
                    <div className="session-stat-card">
                      <span className="session-stat-label">{t("ecommerce.shopDrawer.sessions.active")}</span>
                      <span className="session-stat-value">{sessionStats.activeSessions}</span>
                    </div>
                    <div className="session-stat-card">
                      <span className="session-stat-label">{t("ecommerce.shopDrawer.sessions.total")}</span>
                      <span className="session-stat-value">{sessionStats.totalSessions}</span>
                    </div>
                  </div>
                ) : (
                  <div className="empty-cell">{t("ecommerce.shopDrawer.sessions.noData")}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {/* ── Delete Shop Confirm ── */}
      <ConfirmDialog
        isOpen={confirmDeleteShopId !== null}
        title={t("ecommerce.disconnect")}
        message={t("ecommerce.confirmDisconnect")}
        confirmLabel={t("ecommerce.disconnect")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => confirmDeleteShopId && handleDeleteShop(confirmDeleteShopId)}
        onCancel={() => setConfirmDeleteShopId(null)}
      />
      {/* ── Device Bind Conflict Confirm ── */}
      <ConfirmDialog
        isOpen={bindConflictShopId !== null}
        title={t("ecommerce.shopDrawer.aiCS.csBindConflictTitle")}
        message={t("ecommerce.shopDrawer.aiCS.csBindConflict")}
        confirmLabel={t("common.done")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleForceBindConfirmed}
        onCancel={() => setBindConflictShopId(null)}
      />
    </div>
  );
});
