import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../../components/modals/ConfirmDialog.js";
import { RefreshIcon } from "../../components/icons.js";
import { observer } from "mobx-react-lite";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
import type { ServiceCredit } from "@rivonclaw/core/models";
import { useToast } from "../../components/Toast.js";
import { hasUpgradeRequired } from "./ecommerce-utils.js";
import type { DrawerTab } from "./ecommerce-types.js";
import { useOAuthFlow } from "./hooks/useOAuthFlow.js";
import { useEscalation } from "./hooks/useEscalation.js";
import { useDeviceBinding } from "./hooks/useDeviceBinding.js";
import { ShopTable } from "./components/ShopTable.js";
import { ConnectShopModal } from "./components/ConnectShopModal.js";
import { ShopDrawer } from "./components/ShopDrawer.js";

export const EcommercePage = observer(function EcommercePage() {
  const { t } = useTranslation();
  const entityStore = useEntityStore();
  const user = entityStore.currentUser;
  const shops = entityStore.shops;
  const runProfiles = entityStore.allRunProfiles;
  const platformApps = entityStore.platformApps;
  const credits = entityStore.credits;

  const { showToast } = useToast();

  // Loading flags
  const [_platformAppsLoading, setPlatformAppsLoading] = useState(false);
  const [creditsLoading, setCreditsLoading] = useState(false);

  // Top-level UI state
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("overview");
  const [editBusinessPrompt, setEditBusinessPrompt] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [redeemingCreditId, setRedeemingCreditId] = useState<string | null>(null);
  const [togglingServiceId, setTogglingServiceId] = useState<string | null>(null);
  const [savingRunProfile, setSavingRunProfile] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [confirmDeleteShopId, setConfirmDeleteShopId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const selectedShop = shops.find((s) => s.id === selectedShopId) ?? null;

  // Hooks
  const oauthFlow = useOAuthFlow();
  const escalation = useEscalation(selectedShop, shops, setUpgradePrompt);
  const deviceBinding = useDeviceBinding(shops);

  // ── Error handler ──
  function handleError(err: unknown, fallbackKey: string) {
    if (hasUpgradeRequired(err)) {
      setUpgradePrompt(true);
    } else {
      setUpgradePrompt(false);
      showToast(err instanceof Error ? err.message : t(fallbackKey), "error");
    }
  }

  // ── Fetch helpers ──
  async function handleFetchPlatformApps() {
    setPlatformAppsLoading(true);
    try { await entityStore.fetchPlatformApps(); } catch { /* ignore */ } finally { setPlatformAppsLoading(false); }
  }
  async function handleFetchCredits() {
    setCreditsLoading(true);
    try { await entityStore.fetchCredits(); } catch { /* ignore */ } finally { setCreditsLoading(false); }
  }

  // ── Effects ──

  // Fetch platform apps on mount (shops arrive via MST/SSE)
  useEffect(() => {
    if (user) {
      handleFetchPlatformApps();
    }
  }, [user]);

  // Model catalog is read from entityStore.llmManager.catalog (shared, auto-refreshed).
  // Trigger initial catalog load if not yet populated.
  useEffect(() => {
    if (!entityStore.llmManager.catalogReady) {
      entityStore.llmManager.refreshCatalog();
    }
  }, []);

  // Fetch credits on mount (user-level, not shop-specific)
  useEffect(() => {
    if (user) {
      handleFetchCredits();
    }
  }, [user]);

  // Sync business prompt from shop data (re-runs when shop changes or after mutations refresh the shop)
  useEffect(() => {
    if (selectedShop) {
      setEditBusinessPrompt(selectedShop.services?.customerService?.businessPrompt ?? "");
    }
  }, [selectedShop?.id, selectedShop?.services?.customerService?.businessPrompt]);

  // ── Handlers ──

  async function handleRefreshShops() {
    setRefreshing(true);
    try {
      await Promise.all([
        entityStore.fetchShops(),
        handleFetchPlatformApps(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  function handleConnectShop(platformAppId: string) {
    if (!platformAppId) return;
    setUpgradePrompt(false);
    oauthFlow.initiateOAuth(
      platformAppId,
      () => setConnectModalOpen(false),
      (err) => handleError(err, "ecommerce.oauthFailed"),
    ).catch(() => {}); // Error already handled by onError callback
  }

  async function handleReauthorize(shopId: string) {
    const shop = shops.find((s) => s.id === shopId);
    const appId = shop?.platformAppId || (platformApps.length > 0 ? platformApps[0].id : "");
    if (!appId) {
      showToast(t("ecommerce.oauthFailed"), "error");
      return;
    }
    setUpgradePrompt(false);
    try {
      await oauthFlow.initiateOAuth(
        appId,
        () => setConnectModalOpen(false),
        (err) => handleError(err, "ecommerce.oauthFailed"),
      );
      // Open modal after OAuth URL is set (initiateOAuth sets oauthWaiting on success)
      setConnectModalOpen(true);
    } catch {
      // Error already handled by the onError callback
    }
  }

  async function handleDeleteShop(shopId: string) {
    setConfirmDeleteShopId(null);
    setUpgradePrompt(false);
    try {
      const shop = shops.find((s) => s.id === shopId);
      if (!shop) throw new Error(`Shop ${shopId} not found`);
      await shop.delete();
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
      const shop = shops.find((s) => s.id === shopId);
      if (!shop) throw new Error(`Shop ${shopId} not found`);
      await shop.update({
        services: { customerService: { enabled: !currentValue } },
      });
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
      const shop = shops.find((s) => s.id === selectedShopId);
      if (!shop) throw new Error(`Shop ${selectedShopId} not found`);
      await shop.update({
        services: { customerService: { businessPrompt: editBusinessPrompt } },
      });
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
      const shop = shops.find((s) => s.id === selectedShopId);
      if (!shop) throw new Error(`Shop ${selectedShopId} not found`);
      await shop.update({
        services: { customerService: { runProfileId: profileId } },
      });
    } catch (err) {
      handleError(err, "ecommerce.updateFailed");
    } finally {
      setSavingRunProfile(false);
    }
  }

  async function handleCSModelChange(provider: string, model: string) {
    if (!selectedShopId) return;
    setSavingModel(true);
    setUpgradePrompt(false);
    try {
      const shop = shops.find((s) => s.id === selectedShopId);
      if (!shop) throw new Error(`Shop ${selectedShopId} not found`);
      // Empty provider+model means "use global default"
      await shop.update({
        services: { customerService: {
          csProviderOverride: provider || null,
          csModelOverride: model || null,
        } },
      });
    } catch (err) {
      handleError(err, "ecommerce.updateFailed");
    } finally {
      setSavingModel(false);
    }
  }

  async function handleRedeemCredit(credit: ServiceCredit) {
    if (!selectedShopId) return;
    setRedeemingCreditId(credit.id);
    setUpgradePrompt(false);
    try {
      const creditInstance = entityStore.credits.find((c) => c.id === credit.id);
      if (!creditInstance) throw new Error(`Credit ${credit.id} not found`);
      await creditInstance.redeem(selectedShopId);
      showToast(t("ecommerce.shopDrawer.billing.redeemSuccess"), "success");
      // Credits list is refreshed inside redeem() action.
      // Shop billing data auto-syncs via mutation response -> Desktop proxy -> SSE patch.
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

  // ── Computed ──

  const selectedRunProfileId = selectedShop?.services?.customerService?.runProfileId ?? "";
  const selectedRunProfile = runProfiles.find((p) => p.id === selectedRunProfileId) ?? null;

  const runProfileOptions = useMemo(
    () => runProfiles.map((p) => ({
      value: p.id,
      label: !p.userId ? (t(`surfaces.systemNames.${p.name}`, { defaultValue: p.name }) as string) : p.name,
    })),
    [runProfiles],
  );

  const selectedCSProvider = selectedShop?.services?.customerService?.csProviderOverride ?? "";
  const selectedCSModel = selectedShop?.services?.customerService?.csModelOverride ?? "";

  const csCredits = credits.filter((c) => c.service === "CUSTOMER_SERVICE" && c.status === "AVAILABLE");

  // ── Render ──

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
              oauthFlow.resetOAuthUI();
              setConnectModalOpen(true);
            }}
            disabled={oauthFlow.oauthLoading}
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
      <ShopTable
        shops={shops}
        oauthLoading={oauthFlow.oauthLoading}
        oauthWaiting={oauthFlow.oauthWaiting}
        onOpenDrawer={openDrawer}
        onReauthorize={handleReauthorize}
        onRequestDelete={setConfirmDeleteShopId}
      />

      {/* Add Shop Modal */}
      <ConnectShopModal
        isOpen={connectModalOpen}
        onClose={() => {
          if (oauthFlow.oauthWaiting) {
            oauthFlow.cleanupOAuthWait();
          }
          setConnectModalOpen(false);
        }}
        platformApps={platformApps}
        oauthLoading={oauthFlow.oauthLoading}
        oauthWaiting={oauthFlow.oauthWaiting}
        oauthAuthUrl={oauthFlow.oauthAuthUrl}
        linkCopied={oauthFlow.linkCopied}
        onConnectShop={handleConnectShop}
        onCopyAuthUrl={oauthFlow.handleCopyAuthUrl}
        onCancelOAuth={() => {
          oauthFlow.cleanupOAuthWait();
          setConnectModalOpen(false);
        }}
      />

      {/* Shop Detail Drawer */}
      <ShopDrawer
        shop={selectedShop}
        isOpen={drawerOpen}
        onClose={closeDrawer}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        upgradePrompt={upgradePrompt}
        togglingServiceId={togglingServiceId}
        onToggleCustomerService={handleToggleCustomerService}
        editBusinessPrompt={editBusinessPrompt}
        onEditBusinessPrompt={setEditBusinessPrompt}
        savingSettings={savingSettings}
        onSaveBusinessPrompt={handleSaveBusinessPrompt}
        selectedRunProfileId={selectedRunProfileId}
        runProfileOptions={runProfileOptions}
        selectedRunProfile={selectedRunProfile}
        savingRunProfile={savingRunProfile}
        onRunProfileChange={handleRunProfileChange}
        selectedCSProvider={selectedCSProvider}
        selectedCSModel={selectedCSModel}
        savingModel={savingModel}
        onCSModelChange={handleCSModelChange}
        savingEscalation={escalation.savingEscalation}
        draftEscalationChannel={escalation.draftEscalationChannel}
        draftEscalationRecipient={escalation.draftEscalationRecipient}
        escalationChannelSelectOptions={escalation.escalationChannelSelectOptions}
        escalationRecipientOptions={escalation.escalationRecipientOptions}
        onDraftEscalationChannelChange={escalation.handleDraftEscalationChannelChange}
        onEscalationRecipientChange={escalation.handleEscalationRecipientChange}
        myDeviceId={deviceBinding.myDeviceId}
        togglingBindShopId={deviceBinding.togglingBindShopId}
        onBindDevice={deviceBinding.handleBindDevice}
        onUnbindDevice={deviceBinding.handleUnbindDevice}
        csCredits={csCredits}
        creditsLoading={creditsLoading}
        redeemingCreditId={redeemingCreditId}
        onRedeemCredit={handleRedeemCredit}
      />

      {/* Delete Shop Confirm */}
      <ConfirmDialog
        isOpen={confirmDeleteShopId !== null}
        title={t("ecommerce.disconnect")}
        message={t("ecommerce.confirmDisconnect")}
        confirmLabel={t("ecommerce.disconnect")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => confirmDeleteShopId && handleDeleteShop(confirmDeleteShopId)}
        onCancel={() => setConfirmDeleteShopId(null)}
      />

      {/* Device Bind Conflict Confirm */}
      <ConfirmDialog
        isOpen={deviceBinding.bindConflictShopId !== null}
        title={t("ecommerce.shopDrawer.aiCS.csBindConflictTitle")}
        message={t("ecommerce.shopDrawer.aiCS.csBindConflict")}
        confirmLabel={t("common.done")}
        cancelLabel={t("common.cancel")}
        onConfirm={deviceBinding.handleForceBindConfirmed}
        onCancel={() => deviceBinding.setBindConflictShopId(null)}
      />
    </div>
  );
});
