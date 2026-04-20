import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { observer } from "mobx-react-lite";
import { getChannelAccountConfig, trackEvent, type ChannelAccountSnapshot } from "../../api/index.js";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
import { pollGatewayReady } from "./poll-gateway.js";
import { AddChannelAccountModal } from "../../components/modals/AddChannelAccountModal.js";
import { MobileBindingModal } from "../../components/modals/MobileBindingModal.js";
import { MobileQrInlineFlow } from "../../components/MobileQrInlineFlow.js";
import { ConfirmDialog } from "../../components/modals/ConfirmDialog.js";
import { Select } from "../../components/inputs/Select.js";
import { KNOWN_CHANNELS, QR_LOGIN_CHANNELS } from "../../lib/channel-defs.js";
import { getVisibleChannels, buildAccountsList } from "./channel-defs.jsx";
import { useChannelsData } from "./use-channels-data.js";
import { ChannelAccountsTable } from "./ChannelAccountsTable.js";
import { QrLoginModal } from "../../components/modals/QrLoginModal.js";

export const ChannelsPage = observer(function ChannelsPage() {
  const { t, i18n } = useTranslation();
  const entityStore = useEntityStore();
  const {
    snapshot, loading, error, refreshing,
    loadChannelStatus,
    handleRefresh,
  } = useChannelsData();

  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [selectedChannelLabel, setSelectedChannelLabel] = useState<string>("");
  const [editingAccount, setEditingAccount] = useState<{ accountId: string; name?: string; config: Record<string, unknown> } | undefined>(undefined);

  // Delete confirm dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{ channelId: string; accountId: string; label: string } | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  // Mobile binding modal
  const [mobileModalOpen, setMobileModalOpen] = useState(false);

  // QR login modal (WeChat)
  const [qrLoginChannelId, setQrLoginChannelId] = useState<string | null>(null);

  // Dropdown selection state for add account
  const [selectedDropdownChannel, setSelectedDropdownChannel] = useState<string>("");

  const visibleChannels = getVisibleChannels(i18n.language, selectedDropdownChannel);

  // MST is the authoritative source for channel accounts. The gateway snapshot
  // is only used as an overlay for runtime status fields.
  //
  // We deliberately do NOT wrap this in `useMemo`: `entityStore.channelAccounts`
  // is a MobX observable array whose reference is stable across mutations, so a
  // `useMemo` keyed on it would return stale results when individual accounts
  // change. `observer()` already re-runs this function on any tracked MobX read,
  // and rebuilding the list is O(accounts) — cheap enough to do every render.
  const allAccounts = buildAccountsList(entityStore.channelAccounts, snapshot, t);

  const handleMobileModalClose = useCallback(() => setMobileModalOpen(false), []);
  const handleMobileBindingSuccess = useCallback(() => {
    loadChannelStatus();
    setMobileModalOpen(false);
    setSelectedDropdownChannel("");
  }, []);

  function handleAddAccountFromDropdown() {
    if (!selectedDropdownChannel) return;

    // Mobile Chat uses its own binding modal (QR code flow)
    if (selectedDropdownChannel === "mobile") {
      setMobileModalOpen(true);
      return;
    }

    // QR login channels (e.g., WeChat) use QR code login modal
    if (QR_LOGIN_CHANNELS.has(selectedDropdownChannel)) {
      setQrLoginChannelId(selectedDropdownChannel);
      setSelectedDropdownChannel("");
      return;
    }

    const knownChannel = KNOWN_CHANNELS.find(c => c.id === selectedDropdownChannel);
    const label = knownChannel ? t(knownChannel.labelKey) : selectedDropdownChannel;

    setSelectedChannelId(selectedDropdownChannel);
    setSelectedChannelLabel(label);
    setEditingAccount(undefined);
    setModalOpen(true);

    // Reset dropdown
    setSelectedDropdownChannel("");
  }

  async function handleEditAccount(channelId: string, account: ChannelAccountSnapshot) {
    const knownChannel = KNOWN_CHANNELS.find(c => c.id === channelId);
    const label = knownChannel ? t(knownChannel.labelKey) : snapshot?.channelLabels[channelId] || channelId;

    setSelectedChannelId(channelId);
    setSelectedChannelLabel(label);

    // Fetch full config from SQLite instead of using limited snapshot fields
    try {
      const data = await getChannelAccountConfig(channelId, account.accountId);
      const config = data.config || {};
      config.enabled = account.enabled ?? true; // enabled comes from runtime snapshot

      setEditingAccount({
        accountId: account.accountId,
        name: data.name || account.name || undefined,
        config,
      });
    } catch {
      // Fallback to snapshot-based config if SQLite record doesn't exist yet
      const config: Record<string, unknown> = {
        enabled: account.enabled ?? true,
      };
      if (account.dmPolicy) config.dmPolicy = account.dmPolicy;
      if (account.groupPolicy) config.groupPolicy = account.groupPolicy;
      if (account.streamMode) config.streamMode = account.streamMode;
      if (account.webhookUrl) config.webhookUrl = account.webhookUrl;
      if (account.mode) config.mode = account.mode;

      setEditingAccount({
        accountId: account.accountId,
        name: account.name || undefined,
        config,
      });
    }

    setModalOpen(true);
  }

  function handleDeleteAccount(channelId: string, accountId: string) {
    let label = channelId;
    if (channelId === "mobile") {
      label = t("nav.mobile");
    } else {
      const known = KNOWN_CHANNELS.find(c => c.id === channelId);
      if (known) label = t(known.labelKey);
    }
    setDeleteConfirm({ channelId, accountId, label });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const { channelId, accountId } = deleteConfirm;
    trackEvent("channel.account_deleted", { channelType: channelId });
    const key = `${channelId}-${accountId}`;
    setDeleteConfirm(null);
    setDeletingKey(key);

    try {
      setDeleteError(null);

      if (channelId === "mobile") {
        // Disconnect all mobile pairings
        await entityStore.mobileManager.disconnectAll();
        await pollGatewayReady(() => loadChannelStatus());
      } else {
        await entityStore.channelManager.deleteAccount(channelId, accountId);
        await pollGatewayReady(() => loadChannelStatus());
      }
    } catch (err) {
      setDeleteError(`${t("channels.failedToDelete")} ${String(err)}`);
    } finally {
      setDeletingKey(null);
    }
  }

  function handleModalClose() {
    setModalOpen(false);
    setEditingAccount(undefined);
  }

  async function handleModalSuccess(): Promise<void> {
    await pollGatewayReady(() => loadChannelStatus());
  }

  if (loading) {
    return (
      <div>
        <h1>{t("channels.title")}</h1>
        <div className="centered-muted">
          {t("channels.loading")}
        </div>
      </div>
    );
  }

  if (error) {
    // Gateway never connected yet — show a gentle "connecting" indicator
    // instead of a red error banner. The hook retries every 2s automatically.
    if (!snapshot) {
      return (
        <div>
          <h1>{t("channels.title")}</h1>
          <div className="centered-muted">
            {t("channels.connectingToGateway")}
          </div>
        </div>
      );
    }

    // Lost connection after being connected — show the real error
    return (
      <div>
        <h1>{t("channels.title")}</h1>
        <div className="error-alert">
          <strong>{t("channels.errorLoadingChannels")}</strong> {error}
          <div className="error-alert-actions">
            <button className="btn btn-danger" onClick={() => loadChannelStatus()}>
              {t("channels.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div>
        <h1>{t("channels.title")}</h1>
        <div className="centered-muted">
          {t("channels.gatewayNotConnected")}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Delete error banner */}
      {deleteError && (
        <div className="error-alert">
          {deleteError}
          <button className="btn btn-secondary btn-sm" onClick={() => setDeleteError(null)}>
            {t("common.close")}
          </button>
        </div>
      )}

      {/* Header */}
      <div className="channel-header">
        <div className="channel-title-row">
          <h1 className="channel-title">{t("channels.title")}</h1>
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? t("channels.refreshing") : `\u21bb ${t("channels.refreshButton")}`}
          </button>
        </div>
        <p className="channel-subtitle">
          {t("channels.statusSubtitle")}
        </p>
      </div>

      {/* Add Account Section */}
      <div className="section-card channel-add-section">
        <h3>{t("channels.addAccount")}</h3>
        <div className={`channel-selector-col${selectedDropdownChannel === "mobile" ? " channel-selector-col--mobile" : ""}`}>
          {/* Left column: selector row + tooltip */}
          <div className="channel-selector-right">
            <div className="channel-selector-row">
              <label className="channel-selector-label">
                {t("channels.selectChannelType")}
              </label>
              <Select
                value={selectedDropdownChannel}
                onChange={setSelectedDropdownChannel}
                placeholder={t("channels.selectChannel")}
                options={visibleChannels.map(ch => ({
                  value: ch.id,
                  label: t(ch.labelKey),
                }))}
                className="select-min-w-200"
              />
              <button
                className="btn btn-primary"
                onClick={handleAddAccountFromDropdown}
                disabled={!selectedDropdownChannel}
              >
                {t("channels.connectBtn")}
              </button>
            </div>

            {/* Tooltip for mobile or other channels */}
            {selectedDropdownChannel === "mobile" && (
              <div className="channel-info-box">
                <div className="channel-info-title">
                  {t("mobile.installHint")}
                </div>
              </div>
            )}
            {selectedDropdownChannel && selectedDropdownChannel !== "mobile" && (() => {
              const selected = KNOWN_CHANNELS.find(ch => ch.id === selectedDropdownChannel);
              if (!selected) return null;

              return (
                <div className="channel-info-box">
                  <div className="channel-info-title">
                    {t(selected.tooltip)}
                  </div>
                  {selected.tutorialUrl && (
                    <div>
                      <a
                        href={selected.tutorialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium"
                      >
                        {t("channels.viewTutorial")} &rarr;
                      </a>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* QR code (right side, only when mobile is selected) */}
          {selectedDropdownChannel === "mobile" && (
            <MobileQrInlineFlow />
          )}
        </div>
      </div>

      {/* Accounts Table */}
      <ChannelAccountsTable
        allAccounts={allAccounts}
        deletingKey={deletingKey}
        t={t}
        i18nLang={i18n.language}
        onEdit={handleEditAccount}
        onDelete={handleDeleteAccount}
      />

      {/* Last Updated */}
      <div className="channel-last-updated">
        {t("channels.lastUpdated")} {new Date(snapshot.ts).toLocaleString()}
      </div>

      {/* Add/Edit Account Modal */}
      <AddChannelAccountModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        channelId={selectedChannelId}
        channelLabel={selectedChannelLabel}
        existingAccount={editingAccount}
        onSuccess={handleModalSuccess}
      />

      {/* Mobile Binding Modal */}
      <MobileBindingModal
        isOpen={mobileModalOpen}
        onClose={handleMobileModalClose}
        onBindingSuccess={handleMobileBindingSuccess}
      />

      {/* QR Login Modal (WeChat) */}
      {qrLoginChannelId && (
        <QrLoginModal
          channelId={qrLoginChannelId}
          onClose={() => setQrLoginChannelId(null)}
          onSuccess={() => loadChannelStatus()}
        />
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title={deleteConfirm ? t("channels.deleteConfirmTitle", { channel: deleteConfirm.label }) : ""}
        message={t("channels.deleteConfirmMessage")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
      />
    </div>
  );
});
