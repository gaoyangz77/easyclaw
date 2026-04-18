import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import type { Shop, ServiceCredit } from "@rivonclaw/core/models";
import { CloseIcon, ShopIcon } from "../../../components/icons.js";
import { getAuthStatusBadgeClass } from "../ecommerce-utils.js";
import { AiCustomerServiceTab } from "./AiCustomerServiceTab.js";
import type { DrawerTab } from "../ecommerce-types.js";

interface ShopDrawerProps {
  shop: Shop | null;
  isOpen: boolean;
  onClose: () => void;
  activeTab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  upgradePrompt: boolean;
  // Overview tab: service toggle
  togglingServiceId: string | null;
  onToggleCustomerService: (shopId: string, currentValue: boolean) => void;
  // AI CS tab props
  editBusinessPrompt: string;
  onEditBusinessPrompt: (value: string) => void;
  savingSettings: boolean;
  onSaveBusinessPrompt: () => void;
  selectedRunProfileId: string;
  runProfileOptions: Array<{ value: string; label: string }>;
  selectedRunProfile: { selectedToolIds: string[] } | null;
  savingRunProfile: boolean;
  onRunProfileChange: (profileId: string) => void;
  selectedCSProvider: string;
  selectedCSModel: string;
  savingModel: boolean;
  onCSModelChange: (provider: string, model: string) => void;
  savingEscalation: boolean;
  draftEscalationChannel: string;
  draftEscalationRecipient: string;
  escalationChannelSelectOptions: Array<{ value: string; label: string }>;
  escalationRecipientOptions: Array<{ value: string; label: string }>;
  onDraftEscalationChannelChange: (value: string) => void;
  onEscalationRecipientChange: (value: string) => void;
  myDeviceId: string | null;
  togglingBindShopId: string | null;
  onBindDevice: (shopId: string) => void;
  onUnbindDevice: (shopId: string) => void;
  csCredits: ServiceCredit[];
  creditsLoading: boolean;
  redeemingCreditId: string | null;
  onRedeemCredit: (credit: ServiceCredit) => void;
}

export const ShopDrawer = observer(function ShopDrawer({
  shop,
  isOpen,
  onClose,
  activeTab,
  onTabChange,
  upgradePrompt,
  togglingServiceId,
  onToggleCustomerService,
  editBusinessPrompt,
  onEditBusinessPrompt,
  savingSettings,
  onSaveBusinessPrompt,
  selectedRunProfileId,
  runProfileOptions,
  selectedRunProfile,
  savingRunProfile,
  onRunProfileChange,
  selectedCSProvider,
  selectedCSModel,
  savingModel,
  onCSModelChange,
  savingEscalation,
  draftEscalationChannel,
  draftEscalationRecipient,
  escalationChannelSelectOptions,
  escalationRecipientOptions,
  onDraftEscalationChannelChange,
  onEscalationRecipientChange,
  myDeviceId,
  togglingBindShopId,
  onBindDevice,
  onUnbindDevice,
  csCredits,
  creditsLoading,
  redeemingCreditId,
  onRedeemCredit,
}: ShopDrawerProps) {
  const { t } = useTranslation();

  return (
    <>
      <div
        className={`drawer-overlay${isOpen ? " drawer-overlay-visible" : ""}`}
        onClick={onClose}
      />
      <div className={`drawer-panel${isOpen ? " drawer-panel-open" : ""}`}>
        <div className="drawer-header">
          <div className="drawer-header-left">
            <span className="drawer-header-icon">
              <ShopIcon size={20} />
            </span>
            <div className="drawer-header-info">
              <h3 className="drawer-header-title">{shop?.shopName ?? ""}</h3>
              {shop && (
                <span className={getAuthStatusBadgeClass(shop.authStatus)}>
                  {t(`tiktokShops.authStatus_${shop.authStatus}`)}
                </span>
              )}
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>

        {shop && (
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
                onClick={() => onTabChange("overview")}
              >
                {t("ecommerce.shopDrawer.tabs.overview")}
              </button>
              {shop.services?.customerService?.enabled && (
                <button
                  className={`drawer-tab-btn ${activeTab === "aiCustomerService" ? "drawer-tab-btn-active" : ""}`}
                  onClick={() => onTabChange("aiCustomerService")}
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
                    <span className="shop-info-value">{shop.shopName}</span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.table.headers.region")}</span>
                    <span className="shop-info-value">{shop.region}</span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.table.headers.platform")}</span>
                    <span className="shop-info-value">{shop.platform === "TIKTOK_SHOP" ? "TikTok Shop" : shop.platform}</span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("ecommerce.table.headers.authStatus")}</span>
                    <span className={getAuthStatusBadgeClass(shop.authStatus)}>
                      {t(`tiktokShops.authStatus_${shop.authStatus}`)}
                    </span>
                  </div>
                </div>

                {/* Token Info */}
                <div className="drawer-section-label">{t("ecommerce.shopDrawer.overview.tokenExpiry")}</div>
                <div className="shop-info-card">
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("tiktokShops.detail.accessTokenExpiry")}</span>
                    <span className={`shop-info-value${shop.accessTokenExpiresAt && new Date(shop.accessTokenExpiresAt).getTime() < Date.now() ? " shop-info-value-danger" : ""}`}>
                      {shop.accessTokenExpiresAt
                        ? new Date(shop.accessTokenExpiresAt).toLocaleString()
                        : "\u2014"}
                    </span>
                  </div>
                  <div className="shop-info-row">
                    <span className="shop-info-label">{t("tiktokShops.detail.refreshTokenExpiry")}</span>
                    <span className={`shop-info-value${shop.refreshTokenExpiresAt && new Date(shop.refreshTokenExpiresAt).getTime() < Date.now() ? " shop-info-value-danger" : ""}`}>
                      {shop.refreshTokenExpiresAt
                        ? new Date(shop.refreshTokenExpiresAt).toLocaleString()
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
                    <span className={shop.services?.customerService?.enabled ? "badge badge-active" : "badge badge-muted"}>
                      {shop.services?.customerService?.enabled
                        ? t("common.enabled")
                        : t("common.disabled")}
                    </span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={shop.services?.customerService?.enabled}
                      onChange={() =>
                        onToggleCustomerService(
                          shop.id,
                          shop.services?.customerService?.enabled ?? false,
                        )
                      }
                      disabled={togglingServiceId === shop.id}
                    />
                    <span
                      className={`toggle-track ${shop.services?.customerService?.enabled ? "toggle-track-on" : "toggle-track-off"} ${togglingServiceId === shop.id ? "toggle-track-disabled" : ""}`}
                    >
                      <span
                        className={`toggle-thumb ${shop.services?.customerService?.enabled ? "toggle-thumb-on" : "toggle-thumb-off"}`}
                      />
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Tab: AI Customer Service */}
            {activeTab === "aiCustomerService" && shop.services?.customerService?.enabled && (
              <AiCustomerServiceTab
                shop={shop}
                editBusinessPrompt={editBusinessPrompt}
                onEditBusinessPrompt={onEditBusinessPrompt}
                savingSettings={savingSettings}
                onSaveBusinessPrompt={onSaveBusinessPrompt}
                selectedRunProfileId={selectedRunProfileId}
                runProfileOptions={runProfileOptions}
                selectedRunProfile={selectedRunProfile}
                savingRunProfile={savingRunProfile}
                onRunProfileChange={onRunProfileChange}
                selectedCSProvider={selectedCSProvider}
                selectedCSModel={selectedCSModel}
                savingModel={savingModel}
                onCSModelChange={onCSModelChange}
                savingEscalation={savingEscalation}
                draftEscalationChannel={draftEscalationChannel}
                draftEscalationRecipient={draftEscalationRecipient}
                escalationChannelSelectOptions={escalationChannelSelectOptions}
                escalationRecipientOptions={escalationRecipientOptions}
                onDraftEscalationChannelChange={onDraftEscalationChannelChange}
                onEscalationRecipientChange={onEscalationRecipientChange}
                myDeviceId={myDeviceId}
                togglingBindShopId={togglingBindShopId}
                onBindDevice={onBindDevice}
                onUnbindDevice={onUnbindDevice}
                csCredits={csCredits}
                creditsLoading={creditsLoading}
                redeemingCreditId={redeemingCreditId}
                onRedeemCredit={onRedeemCredit}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
});
