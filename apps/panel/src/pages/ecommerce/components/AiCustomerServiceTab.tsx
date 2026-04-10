import { useTranslation } from "react-i18next";
import { observer } from "mobx-react-lite";
import type { Shop, ServiceCredit } from "@rivonclaw/core/models";
import { Select } from "../../../components/inputs/Select.js";
import { KeyModelSelector } from "../../../components/inputs/KeyModelSelector.js";
import { useEntityStore } from "../../../store/EntityStoreProvider.js";
import { isBalanceExpiringSoon } from "../ecommerce-utils.js";
import { BalanceBadge } from "./BalanceBadge.js";

interface AiCustomerServiceTabProps {
  shop: Shop;
  // Business prompt
  editBusinessPrompt: string;
  onEditBusinessPrompt: (value: string) => void;
  savingSettings: boolean;
  onSaveBusinessPrompt: () => void;
  // Run profile
  selectedRunProfileId: string;
  runProfileOptions: Array<{ value: string; label: string }>;
  selectedRunProfile: { selectedToolIds: string[] } | null;
  savingRunProfile: boolean;
  onRunProfileChange: (profileId: string) => void;
  // CS model override
  selectedCSProvider: string;
  selectedCSModel: string;
  savingModel: boolean;
  onCSModelChange: (provider: string, model: string) => void;
  // Escalation
  savingEscalation: boolean;
  draftEscalationChannel: string;
  draftEscalationRecipient: string;
  escalationChannelSelectOptions: Array<{ value: string; label: string }>;
  escalationRecipientOptions: Array<{ value: string; label: string }>;
  onDraftEscalationChannelChange: (value: string) => void;
  onEscalationRecipientChange: (value: string) => void;
  // Device binding
  myDeviceId: string | null;
  togglingBindShopId: string | null;
  onBindDevice: (shopId: string) => void;
  onUnbindDevice: (shopId: string) => void;
  // Credits
  csCredits: ServiceCredit[];
  creditsLoading: boolean;
  redeemingCreditId: string | null;
  onRedeemCredit: (credit: ServiceCredit) => void;
  // Session stats
  sessionStatsLoading: boolean;
  sessionStats: { activeSessions: number; totalSessions: number } | null;
}

export const AiCustomerServiceTab = observer(function AiCustomerServiceTab({
  shop,
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
  sessionStatsLoading,
  sessionStats,
}: AiCustomerServiceTabProps) {
  const { t } = useTranslation();
  const entityStore = useEntityStore();
  const allTools = entityStore.availableTools;

  function toolDisplayName(toolId: string): string {
    const tool = allTools.find((t) => t.id === toolId);
    const catLabel = tool?.category ? t(`tools.selector.category.${tool.category}`, { defaultValue: "" }) : "";
    const nameLabel = t(`tools.selector.name.${toolId}`, { defaultValue: tool?.displayName ?? toolId });
    return catLabel ? `${catLabel} — ${nameLabel}` : nameLabel;
  }

  return (
    <div className="shop-detail-section">
      {/* Service Status */}
      <div className="drawer-section-label">{t("ecommerce.shopDrawer.aiCS.serviceStatus")}</div>
      <div className="shop-info-card">
        <div className="shop-info-row">
          <span className="shop-info-label">{t("ecommerce.shopDrawer.billing.balance")}</span>
          <span className="shop-info-value">
            {shop.services?.customerServiceBilling
              ? (shop.services?.customerServiceBilling?.balance ?? 0)
              : 0}
            <BalanceBadge shop={shop} />
          </span>
        </div>
        <div className="shop-info-row">
          <span className="shop-info-label">{t("ecommerce.shopDrawer.billing.currentTier")}</span>
          <span className="shop-info-value">
            {shop.services?.customerServiceBilling?.tier ? (
              <span className="badge badge-active">{t(`tiktokShops.tier.${shop.services?.customerServiceBilling?.tier}`, { defaultValue: shop.services?.customerServiceBilling?.tier })}</span>
            ) : (
              t("ecommerce.shopDrawer.billing.noTier")
            )}
          </span>
        </div>
        {shop.services?.customerServiceBilling?.balanceExpiresAt && (
          <div className="shop-info-row">
            <span className="shop-info-label">{t("ecommerce.shopDrawer.billing.expiry")}</span>
            <span className="shop-info-value">
              {new Date(shop.services!.customerServiceBilling!.balanceExpiresAt!).toLocaleDateString()}
              {isBalanceExpiringSoon(shop.services?.customerServiceBilling?.balanceExpiresAt) && (
                <span className="badge badge-warning shop-badge-inline">
                  {t("tiktokShops.balance.expiring", {
                    date: new Date(shop.services!.customerServiceBilling!.balanceExpiresAt!).toLocaleDateString(),
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
          {shop.services?.customerService?.csDeviceId && shop.services?.customerService?.csDeviceId !== myDeviceId && (
            <span className="badge badge-warning shop-badge-inline">
              {t("ecommerce.shopDrawer.aiCS.csOtherDevice")}
            </span>
          )}
          {shop.services?.customerService?.csDeviceId && shop.services?.customerService?.csDeviceId === myDeviceId && (
            <span className="badge badge-success shop-badge-inline">
              {t("ecommerce.shopDrawer.aiCS.csThisDevice")}
            </span>
          )}
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={shop.services?.customerService?.csDeviceId === myDeviceId}
            onChange={() => {
              if (shop.services?.customerService?.csDeviceId === myDeviceId) {
                onUnbindDevice(shop.id);
              } else {
                onBindDevice(shop.id);
              }
            }}
            disabled={togglingBindShopId === shop.id || !myDeviceId}
          />
          <span
            className={`toggle-track ${shop.services?.customerService?.csDeviceId === myDeviceId ? "toggle-track-on" : "toggle-track-off"} ${togglingBindShopId === shop.id ? "toggle-track-disabled" : ""}`}
          >
            <span
              className={`toggle-thumb ${shop.services?.customerService?.csDeviceId === myDeviceId ? "toggle-thumb-on" : "toggle-thumb-off"}`}
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
            onChange={onRunProfileChange}
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
          <div className="shop-info-card-hint">{t("ecommerce.shopDrawer.aiCS.runProfileHint")}</div>
        )}
      </div>

      {/* CS Model Override */}
      <div className="drawer-section-label">{t("ecommerce.shopDrawer.aiCS.csModelOverride")}</div>
      <div className="shop-info-card">
        <div className="shop-runprofile-row">
          <label className="form-label-block">{t("ecommerce.shopDrawer.aiCS.csModelOverride")}</label>
          <KeyModelSelector
            keys={entityStore.providerKeys.map((k) => ({
              id: k.id,
              provider: k.provider,
              label: k.label,
              model: k.model,
              isDefault: k.isDefault,
            }))}
            catalog={entityStore.llmManager.catalog}
            selectedProvider={selectedCSProvider}
            selectedModel={selectedCSModel}
            onChange={onCSModelChange}
            disabled={savingModel}
            variant="form"
            allowDefault
          />
        </div>
        <div className="shop-info-card-hint">{t("ecommerce.shopDrawer.aiCS.csModelOverrideHint")}</div>
      </div>

      {/* Escalation Routing (side-by-side channel -> recipient selector) */}
      <div className="drawer-section-label">{t("tiktokShops.detail.escalationRouting")}</div>
      <div className="shop-info-card">
        <div className="escalation-cascade-row">
          <div className="escalation-cascade-col">
            <label className="form-label-block">{t("tiktokShops.detail.escalationChannel")}</label>
            <Select
              value={draftEscalationChannel}
              onChange={onDraftEscalationChannelChange}
              options={escalationChannelSelectOptions}
              disabled={savingEscalation}
              className="input-full"
            />
          </div>
          <div className={`escalation-cascade-col${!draftEscalationChannel ? " escalation-cascade-col-disabled" : ""}`}>
            <label className="form-label-block">{t("tiktokShops.detail.escalationRecipient")}</label>
            <Select
              value={draftEscalationRecipient}
              onChange={onEscalationRecipientChange}
              options={escalationRecipientOptions}
              disabled={savingEscalation || !draftEscalationChannel}
              className="input-full"
            />
          </div>
        </div>
        <div className="shop-info-card-hint">{t("tiktokShops.detail.escalationChannelHint")}</div>
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
            onChange={(e) => onEditBusinessPrompt(e.target.value)}
            rows={15}
            maxLength={2000}
          />
          <span className="shop-prompt-charcount">
            {editBusinessPrompt.length} / 2000
          </span>
        </div>
        <div className="modal-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={onSaveBusinessPrompt}
            disabled={savingSettings || editBusinessPrompt === (shop.services?.customerService?.businessPrompt ?? "")}
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
                    onClick={() => onRedeemCredit(credit)}
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
  );
});
