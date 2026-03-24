import { useState, useEffect, useRef, useCallback } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../components/modals/Modal.js";
import { Select } from "../components/inputs/Select.js";
import { useAuth, usePanelStore } from "../stores/index.js";
import type { Shop, ServiceCreditInfo } from "../stores/index.js";

/** OAuth authorization timeout in milliseconds (5 minutes). */
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Balance threshold below which we show a "low balance" warning. */
const LOW_BALANCE_THRESHOLD = 50;

/** Days before expiry to show a "balance expiring" warning. */
const EXPIRY_WARNING_DAYS = 2;

function isBalanceLow(balance: number): boolean {
  return balance > 0 && balance < LOW_BALANCE_THRESHOLD;
}

function isBalanceExpiringSoon(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return diff > 0 && diff < EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
}

function isBalanceExpired(expiresAt?: string): boolean {
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
  balance: number | undefined,
  tier: string | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (balance === undefined || balance === null) return "—";
  if (tier) return t("tiktokShops.balance.of", { balance, tier });
  return t("tiktokShops.balance.remaining", { balance });
}

type ModalTab = "overview" | "billing" | "sessions";

export function TikTokShopsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const shops = usePanelStore((s) => s.shops);
  const shopsLoading = usePanelStore((s) => s.shopsLoading);
  const platformApps = usePanelStore((s) => s.platformApps);
  const credits = usePanelStore((s) => s.credits);
  const creditsLoading = usePanelStore((s) => s.creditsLoading);
  const sessionStats = usePanelStore((s) => s.sessionStats);
  const sessionStatsLoading = usePanelStore((s) => s.sessionStatsLoading);
  const selectedShopId = usePanelStore((s) => s.selectedShopId);
  const storeFetchShops = usePanelStore((s) => s.fetchShops);
  const storeFetchPlatformApps = usePanelStore((s) => s.fetchPlatformApps);
  const storeUpdateShop = usePanelStore((s) => s.updateShop);
  const storeDeleteShop = usePanelStore((s) => s.deleteShop);
  const storeInitiateOAuth = usePanelStore((s) => s.initiateTikTokOAuth);
  const storeFetchCredits = usePanelStore((s) => s.fetchCredits);
  const storeFetchSessionStats = usePanelStore((s) => s.fetchSessionStats);
  const storeRedeemCredit = usePanelStore((s) => s.redeemCredit);
  const storeSetSelectedShopId = usePanelStore((s) => s.setSelectedShopId);

  const [error, setError] = useState<string | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);

  // Connect Shop modal state
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [selectedPlatformAppId, setSelectedPlatformAppId] = useState<string>("");

  // Detail modal state
  const [activeTab, setActiveTab] = useState<ModalTab>("overview");
  const [editBusinessPrompt, setEditBusinessPrompt] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [redeemingCreditId, setRedeemingCreditId] = useState<string | null>(null);
  const [togglingServiceId, setTogglingServiceId] = useState<string | null>(null);

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
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (oauthTimeoutRef.current) clearTimeout(oauthTimeoutRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  // Fetch shops and platform apps on mount
  useEffect(() => {
    if (user) {
      storeFetchShops();
      storeFetchPlatformApps();
    }
  }, [user]);

  // Auto-select first platform app when list loads
  useEffect(() => {
    if (platformApps.length > 0 && !selectedPlatformAppId) {
      setSelectedPlatformAppId(platformApps[0].id);
    }
  }, [platformApps, selectedPlatformAppId]);

  // Load detail data when a shop is selected
  useEffect(() => {
    if (selectedShopId) {
      storeFetchCredits();
      storeFetchSessionStats(selectedShopId);
    }
  }, [selectedShopId]);

  // Set business prompt when shop selection changes
  useEffect(() => {
    if (selectedShop) {
      setEditBusinessPrompt(selectedShop.services.customerService.businessPrompt ?? "");
    }
  }, [selectedShop?.id]);

  function handleError(err: unknown, fallbackKey: string) {
    if (hasUpgradeRequired(err)) {
      setUpgradePrompt(true);
      setError(null);
    } else {
      setUpgradePrompt(false);
      setError(err instanceof Error ? err.message : t(fallbackKey));
    }
  }

  function startOAuthSSEListener() {
    const sse = new EventSource("/api/chat/events");
    sseRef.current = sse;

    sse.addEventListener("oauth-complete", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { shopId: string; shopName: string; platform: string };
        cleanupOAuthWait();
        setSuccessMsg(t("tiktokShops.oauthSuccess"));
        storeFetchShops();
        void data;
      } catch {
        // Ignore malformed data
      }
    });

    sse.addEventListener("error", () => {
      if (sse.readyState === EventSource.CLOSED) {
        console.warn("[TikTokShopsPage] OAuth SSE connection closed");
      }
    });

    oauthTimeoutRef.current = setTimeout(() => {
      cleanupOAuthWait();
      setError(t("tiktokShops.oauthTimeout"));
    }, OAUTH_TIMEOUT_MS);
  }

  async function handleConnectShop() {
    if (!selectedPlatformAppId) return;
    setOauthLoading(true);
    setError(null);
    setSuccessMsg(null);
    setUpgradePrompt(false);
    try {
      const { authUrl } = await storeInitiateOAuth(selectedPlatformAppId);
      setConnectModalOpen(false);
      startOAuthSSEListener();
      setOauthWaiting(true);
      window.open(authUrl, "_blank");
    } catch (err) {
      handleError(err, "tiktokShops.oauthFailed");
    } finally {
      setOauthLoading(false);
    }
  }

  async function handleReauthorize(shopId: string) {
    const shop = shops.find((s) => s.id === shopId);
    const appId = shop?.platformAppId || (platformApps.length > 0 ? platformApps[0].id : "");
    if (!appId) {
      setError(t("tiktokShops.oauthFailed"));
      return;
    }

    setOauthLoading(true);
    setError(null);
    setSuccessMsg(null);
    setUpgradePrompt(false);
    try {
      const { authUrl } = await storeInitiateOAuth(appId);
      startOAuthSSEListener();
      setOauthWaiting(true);
      window.open(authUrl, "_blank");
    } catch (err) {
      handleError(err, "tiktokShops.oauthFailed");
    } finally {
      setOauthLoading(false);
    }
  }

  async function handleDeleteShop(shopId: string) {
    if (!window.confirm(t("tiktokShops.confirmDisconnect"))) return;
    setError(null);
    setUpgradePrompt(false);
    try {
      await storeDeleteShop(shopId);
      if (selectedShopId === shopId) {
        storeSetSelectedShopId(null);
      }
    } catch (err) {
      handleError(err, "tiktokShops.deleteFailed");
    }
  }

  async function handleToggleCustomerService(shopId: string, currentValue: boolean) {
    setTogglingServiceId(shopId);
    setError(null);
    setUpgradePrompt(false);
    try {
      await storeUpdateShop(shopId, {
        services: { customerService: { enabled: !currentValue } },
      });
    } catch (err) {
      handleError(err, "tiktokShops.updateFailed");
    } finally {
      setTogglingServiceId(null);
    }
  }

  async function handleSaveBusinessPrompt() {
    if (!selectedShopId) return;
    setSavingSettings(true);
    setError(null);
    setUpgradePrompt(false);
    try {
      await storeUpdateShop(selectedShopId, {
        services: { customerService: { businessPrompt: editBusinessPrompt } },
      });
      setSuccessMsg(t("common.saved"));
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err) {
      handleError(err, "tiktokShops.updateFailed");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleRedeemCredit(credit: ServiceCreditInfo) {
    if (!selectedShopId) return;
    setRedeemingCreditId(credit.id);
    setError(null);
    setUpgradePrompt(false);
    try {
      await storeRedeemCredit(credit.id, selectedShopId);
      setSuccessMsg(t("tiktokShops.modal.billing.redeemSuccess"));
      setTimeout(() => setSuccessMsg(null), 2000);
      // Refresh session stats
      storeFetchSessionStats(selectedShopId);
    } catch (err) {
      handleError(err, "tiktokShops.updateFailed");
    } finally {
      setRedeemingCreditId(null);
    }
  }

  function openDetailModal(shopId: string) {
    storeSetSelectedShopId(shopId);
    setActiveTab("overview");
    setError(null);
    setUpgradePrompt(false);
    setSuccessMsg(null);
  }

  function closeDetailModal() {
    storeSetSelectedShopId(null);
    setError(null);
    setUpgradePrompt(false);
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
      default:
        return "badge badge-muted";
    }
  }

  function getBalanceBadge(shop: Shop): JSX.Element | null {
    const billing = shop.services.customerServiceBilling;
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

  function getCsStatusBadge(shop: Shop): JSX.Element {
    if (shop.services.customerService.enabled) {
      return <span className="badge badge-active">{t("common.enabled")}</span>;
    }
    return <span className="badge badge-muted">{t("common.disabled")}</span>;
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
      <h1>{t("tiktokShops.title")}</h1>
      <p>{t("tiktokShops.description")}</p>

      {upgradePrompt && (
        <div className="info-box info-box-blue">
          {t("tiktokShops.upgradeRequired")}
        </div>
      )}
      {error && (
        <div className="error-alert">{error}</div>
      )}
      {successMsg && (
        <div className="info-box info-box-green">
          {successMsg}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setSuccessMsg(null)}
          >
            {t("common.close")}
          </button>
        </div>
      )}

      {/* OAuth Waiting State */}
      {oauthWaiting && (
        <div className="info-box">
          <span>{t("tiktokShops.oauthWaiting")}</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              cleanupOAuthWait();
              setError(null);
            }}
          >
            {t("common.cancel")}
          </button>
        </div>
      )}

      {/* Connected Shops — Table */}
      <div className="section-card">
        <div className="acct-section-header">
          <div>
            <h3>{t("tiktokShops.connectedShops")}</h3>
          </div>
          <div className="td-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setConnectModalOpen(true); }}
              disabled={oauthLoading || oauthWaiting}
            >
              {t("tiktokShops.connectShop")}
            </button>
          </div>
        </div>

        {shopsLoading && shops.length === 0 ? (
          <div className="empty-cell">{t("common.loading")}</div>
        ) : shops.length === 0 ? (
          <div className="empty-cell">{t("tiktokShops.noShops")}</div>
        ) : (
          <table className="shop-table">
            <thead>
              <tr>
                <th>{t("tiktokShops.tableHeaders.name")}</th>
                <th>{t("tiktokShops.tableHeaders.region")}</th>
                <th>{t("tiktokShops.tableHeaders.authStatus")}</th>
                <th>{t("tiktokShops.tableHeaders.csStatus")}</th>
                <th>{t("tiktokShops.tableHeaders.balance")}</th>
                <th className="text-right">{t("tiktokShops.tableHeaders.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => {
                const billing = shop.services.customerServiceBilling;
                return (
                  <tr key={shop.id}>
                    <td>
                      <span className="shop-table-name">{shop.shopName}</span>
                    </td>
                    <td>{shop.region}</td>
                    <td>
                      <span className={getAuthStatusBadgeClass(shop.authStatus)}>
                        {t(`tiktokShops.authStatus_${shop.authStatus}`)}
                      </span>
                    </td>
                    <td>{getCsStatusBadge(shop)}</td>
                    <td>
                      <span className="shop-balance-cell">
                        {billing
                          ? formatBalanceDisplay(billing.balance, billing.tier, t)
                          : "—"}
                        {getBalanceBadge(shop)}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="td-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openDetailModal(shop.id)}
                        >
                          {t("tiktokShops.view")}
                        </button>
                        {shop.authStatus === "TOKEN_EXPIRED" && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleReauthorize(shop.id)}
                            disabled={oauthLoading || oauthWaiting}
                          >
                            {t("tiktokShops.reauthorize")}
                          </button>
                        )}
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteShop(shop.id)}
                        >
                          {t("tiktokShops.disconnect")}
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

      {/* Connect Shop Modal */}
      <Modal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        title={t("tiktokShops.connectShopTitle")}
      >
        <div className="modal-form-col">
          <p>{t("tiktokShops.connectShopDesc")}</p>
          <div>
            <label className="form-label-block">
              {t("tiktokShops.platformAppLabel")}
            </label>
            {platformApps.length === 0 ? (
              <div className="form-hint">{t("tiktokShops.noPlatformApps")}</div>
            ) : platformApps.length === 1 ? (
              <div className="form-hint">{platformApps[0].label}</div>
            ) : (
              <Select
                value={selectedPlatformAppId}
                onChange={(v) => setSelectedPlatformAppId(v)}
                className="input-full"
                options={platformApps.map((app) => ({
                  value: app.id,
                  label: app.label,
                }))}
              />
            )}
            <div className="form-hint">{t("tiktokShops.platformAppHint")}</div>
          </div>
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
              {oauthLoading ? t("common.loading") : t("tiktokShops.authorizeButton")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Shop Detail Modal */}
      <Modal
        isOpen={!!selectedShopId}
        onClose={closeDetailModal}
        title={selectedShop?.shopName ?? ""}
        maxWidth={680}
      >
        {selectedShop && (
          <div className="modal-form-col">
            {upgradePrompt && (
              <div className="info-box info-box-blue">
                {t("tiktokShops.upgradeRequired")}
              </div>
            )}
            {error && <div className="error-alert">{error}</div>}
            {successMsg && (
              <div className="info-box info-box-green">{successMsg}</div>
            )}

            {/* Tab Bar */}
            <div className="tab-bar tab-bar--spread">
              <button
                className={`tab-btn ${activeTab === "overview" ? "tab-btn-active" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                {t("tiktokShops.modal.tabs.overview")}
              </button>
              <button
                className={`tab-btn ${activeTab === "billing" ? "tab-btn-active" : ""}`}
                onClick={() => setActiveTab("billing")}
              >
                {t("tiktokShops.modal.tabs.billing")}
              </button>
              <button
                className={`tab-btn ${activeTab === "sessions" ? "tab-btn-active" : ""}`}
                onClick={() => setActiveTab("sessions")}
              >
                {t("tiktokShops.modal.tabs.sessions")}
              </button>
            </div>

            {/* Tab: Overview */}
            {activeTab === "overview" && (
              <div className="shop-detail-section">
                {/* Shop Info */}
                <div className="shop-detail-grid">
                  <div className="shop-detail-field">
                    <span className="form-label-block">{t("tiktokShops.tableHeaders.name")}</span>
                    <span>{selectedShop.shopName}</span>
                  </div>
                  <div className="shop-detail-field">
                    <span className="form-label-block">{t("tiktokShops.tableHeaders.region")}</span>
                    <span>{selectedShop.region}</span>
                  </div>
                  <div className="shop-detail-field">
                    <span className="form-label-block">{t("tiktokShops.detail.platform")}</span>
                    <span>{selectedShop.platform === "TIKTOK_SHOP" ? "TikTok Shop" : selectedShop.platform}</span>
                  </div>
                  <div className="shop-detail-field">
                    <span className="form-label-block">{t("tiktokShops.tableHeaders.authStatus")}</span>
                    <span className={getAuthStatusBadgeClass(selectedShop.authStatus)}>
                      {t(`tiktokShops.authStatus_${selectedShop.authStatus}`)}
                    </span>
                  </div>
                </div>

                {/* Token Info */}
                <div className="shop-detail-grid">
                  <div className="shop-detail-field">
                    <span className="form-label-block">{t("tiktokShops.detail.accessTokenExpiry")}</span>
                    <span>
                      {selectedShop.accessTokenExpiresAt
                        ? new Date(selectedShop.accessTokenExpiresAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                  <div className="shop-detail-field">
                    <span className="form-label-block">{t("tiktokShops.detail.refreshTokenExpiry")}</span>
                    <span>
                      {selectedShop.refreshTokenExpiresAt
                        ? new Date(selectedShop.refreshTokenExpiresAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                </div>

                {/* Service Toggle */}
                <div className="shop-services-row">
                  <div className="shop-service-toggle">
                    <span className="shop-service-label">
                      {t("tiktokShops.customerServiceLabel")}
                    </span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={selectedShop.services.customerService.enabled}
                        onChange={() =>
                          handleToggleCustomerService(
                            selectedShop.id,
                            selectedShop.services.customerService.enabled,
                          )
                        }
                        disabled={togglingServiceId === selectedShop.id}
                      />
                      <span
                        className={`toggle-track ${selectedShop.services.customerService.enabled ? "toggle-track-on" : "toggle-track-off"} ${togglingServiceId === selectedShop.id ? "toggle-track-disabled" : ""}`}
                      >
                        <span
                          className={`toggle-thumb ${selectedShop.services.customerService.enabled ? "toggle-thumb-on" : "toggle-thumb-off"}`}
                        />
                      </span>
                    </label>
                    <span className={selectedShop.services.customerService.enabled ? "badge badge-active" : "badge badge-muted"}>
                      {selectedShop.services.customerService.enabled
                        ? t("common.enabled")
                        : t("common.disabled")}
                    </span>
                  </div>
                </div>

                {/* Business Prompt */}
                {selectedShop.services.customerService.enabled && (
                  <div>
                    <label className="form-label-block">
                      {t("tiktokShops.detail.businessPrompt")}
                    </label>
                    <div className="form-hint">{t("tiktokShops.detail.businessPromptHint")}</div>
                    <textarea
                      className="input-full textarea-resize-vertical shop-prompt-textarea"
                      value={editBusinessPrompt}
                      onChange={(e) => setEditBusinessPrompt(e.target.value)}
                      rows={4}
                    />
                    <div className="modal-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSaveBusinessPrompt}
                        disabled={savingSettings}
                      >
                        {savingSettings ? t("common.loading") : t("common.save")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Billing */}
            {activeTab === "billing" && (
              <div className="shop-detail-section">
                {/* Current Plan */}
                <div className="shop-detail-field">
                  <span className="form-label-block">{t("tiktokShops.modal.billing.currentTier")}</span>
                  <span>
                    {selectedShop.services.customerServiceBilling?.tier
                      ? selectedShop.services.customerServiceBilling.tier
                      : t("tiktokShops.modal.billing.noTier")}
                  </span>
                </div>

                {/* Balance */}
                <div className="shop-detail-field">
                  <span className="form-label-block">{t("tiktokShops.tableHeaders.balance")}</span>
                  <span className="shop-balance-cell">
                    {selectedShop.services.customerServiceBilling
                      ? formatBalanceDisplay(
                          selectedShop.services.customerServiceBilling.balance,
                          selectedShop.services.customerServiceBilling.tier,
                          t,
                        )
                      : "—"}
                    {getBalanceBadge(selectedShop)}
                  </span>
                </div>

                {/* Balance Expiry */}
                {selectedShop.services.customerServiceBilling?.balanceExpiresAt && (
                  <div className="shop-detail-field">
                    <span className="form-label-block">{t("tiktokShops.detail.balanceExpiry")}</span>
                    <span>
                      {new Date(selectedShop.services.customerServiceBilling.balanceExpiresAt).toLocaleDateString()}
                      {isBalanceExpiringSoon(selectedShop.services.customerServiceBilling.balanceExpiresAt) && (
                        <span className="badge badge-warning shop-badge-inline">
                          {t("tiktokShops.balance.expiring", {
                            date: new Date(selectedShop.services.customerServiceBilling.balanceExpiresAt).toLocaleDateString(),
                          })}
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {/* Available Credits */}
                <div>
                  <span className="form-label-block">{t("tiktokShops.modal.billing.credits")}</span>
                  {creditsLoading ? (
                    <div className="empty-cell">{t("common.loading")}</div>
                  ) : csCredits.length === 0 ? (
                    <div className="form-hint">{t("tiktokShops.credits.noCredits")}</div>
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
                                  : t("tiktokShops.credits.redeem")}
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
                </div>
              </div>
            )}

            {/* Tab: Sessions */}
            {activeTab === "sessions" && (
              <div className="shop-detail-section">
                {sessionStatsLoading ? (
                  <div className="empty-cell">{t("common.loading")}</div>
                ) : sessionStats ? (
                  <div className="shop-detail-grid">
                    <div className="shop-detail-field">
                      <span className="form-label-block">{t("tiktokShops.modal.sessions.active")}</span>
                      <span className="shop-stat-value">{sessionStats.activeSessions}</span>
                    </div>
                    <div className="shop-detail-field">
                      <span className="form-label-block">{t("tiktokShops.modal.sessions.total")}</span>
                      <span className="shop-stat-value">{sessionStats.totalSessions}</span>
                    </div>
                    <div className="shop-detail-field">
                      <span className="form-label-block">{t("tiktokShops.modal.sessions.balance")}</span>
                      <span className="shop-balance-cell">
                        {sessionStats.balance}
                        {sessionStats.balance === 0 && (
                          <span className="badge badge-danger">{t("tiktokShops.balance.none")}</span>
                        )}
                        {isBalanceLow(sessionStats.balance) && (
                          <span className="badge badge-warning">{t("tiktokShops.balance.low")}</span>
                        )}
                      </span>
                    </div>
                    {sessionStats.balanceExpiresAt && (
                      <div className="shop-detail-field">
                        <span className="form-label-block">{t("tiktokShops.detail.balanceExpiry")}</span>
                        <span>
                          {new Date(sessionStats.balanceExpiresAt).toLocaleDateString()}
                          {isBalanceExpiringSoon(sessionStats.balanceExpiresAt) && (
                            <span className="badge badge-warning shop-badge-inline">
                              {t("tiktokShops.balance.expiring", {
                                date: new Date(sessionStats.balanceExpiresAt).toLocaleDateString(),
                              })}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty-cell">{t("tiktokShops.modal.sessions.noData")}</div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
