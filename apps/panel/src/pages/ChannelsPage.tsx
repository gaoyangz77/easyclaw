import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { deleteChannelAccount, unbindWeComAccount, type ChannelAccountSnapshot } from "../api/index.js";
import { pollGatewayReady } from "../lib/poll-gateway.js";
import { AddChannelAccountModal } from "../components/AddChannelAccountModal.js";
import { WeComBindingModal } from "../components/WeComBindingModal.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Select } from "../components/Select.js";
import { KNOWN_CHANNELS, getVisibleChannels, buildAccountsList } from "./channels/channel-defs.jsx";
import { useChannelsData } from "./channels/use-channels-data.js";
import { ChannelAccountsTable } from "./channels/ChannelAccountsTable.js";

export function ChannelsPage() {
  const { t, i18n } = useTranslation();
  const {
    snapshot, loading, error, refreshing, wecomStatus,
    setWecomStatus,
    loadChannelStatus, loadWeComStatus,
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

  // WeCom binding modal
  const [wecomModalOpen, setWecomModalOpen] = useState(false);

  // Dropdown selection state for add account
  const [selectedDropdownChannel, setSelectedDropdownChannel] = useState<string>("");

  const visibleChannels = getVisibleChannels(i18n.language, selectedDropdownChannel);

  const allAccounts = useMemo(
    () => snapshot ? buildAccountsList(snapshot, wecomStatus, t) : [],
    [snapshot, wecomStatus, t],
  );

  function handleAddAccountFromDropdown() {
    if (!selectedDropdownChannel) return;

    // WeCom uses its own binding modal (QR code flow)
    if (selectedDropdownChannel === "wecom") {
      setWecomModalOpen(true);
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

  function handleEditAccount(channelId: string, account: ChannelAccountSnapshot) {
    const knownChannel = KNOWN_CHANNELS.find(c => c.id === channelId);
    const label = knownChannel ? t(knownChannel.labelKey) : snapshot?.channelLabels[channelId] || channelId;

    setSelectedChannelId(channelId);
    setSelectedChannelLabel(label);

    // Build config from account snapshot
    const config: Record<string, unknown> = {
      enabled: account.enabled ?? true,
    };

    // Add channel-specific fields if they exist
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
    setModalOpen(true);
  }

  function handleDeleteAccount(channelId: string, accountId: string) {
    const label = channelId === "wecom"
      ? t("channels.channelWecom")
      : (KNOWN_CHANNELS.find(c => c.id === channelId) ? t(KNOWN_CHANNELS.find(c => c.id === channelId)!.labelKey) : channelId);
    setDeleteConfirm({ channelId, accountId, label });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const { channelId, accountId } = deleteConfirm;
    const key = `${channelId}-${accountId}`;
    setDeleteConfirm(null);
    setDeletingKey(key);

    try {
      setDeleteError(null);

      if (channelId === "wecom") {
        // WeCom uses its own unbind flow
        await unbindWeComAccount();
        setWecomStatus(null);
      } else {
        await deleteChannelAccount(channelId, accountId);
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
        <div className="channel-selector-col">
          <div className="channel-selector-row">
            <label className="channel-selector-label">
              {t("channels.selectChannelType")}
            </label>
            <Select
              value={selectedDropdownChannel}
              onChange={setSelectedDropdownChannel}
              placeholder={t("channels.selectChannel")}
              options={(() => {
                const wecomOption = { value: "wecom", label: t("channels.channelWecom") };
                const channelOptions = visibleChannels.map(ch => ({
                  value: ch.id,
                  label: t(ch.labelKey),
                }));
                return i18n.language === "zh"
                  ? [wecomOption, ...channelOptions]
                  : [...channelOptions, wecomOption];
              })()}
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

          {/* Tooltip and tutorial link for selected channel */}
          {selectedDropdownChannel && (() => {
            if (selectedDropdownChannel === "wecom") {
              return (
                <div className="channel-info-box">
                  <div className="channel-info-title">
                    {t("channels.wecomDropdownHint")}
                  </div>
                </div>
              );
            }

            const selected = KNOWN_CHANNELS.find(ch => ch.id === selectedDropdownChannel);
            if (!selected) return null;

            return (
              <div className="channel-info-box">
                <div className="channel-info-title">
                  {t(selected.tooltip)}
                </div>
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
              </div>
            );
          })()}
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

      {/* WeCom Binding Modal */}
      <WeComBindingModal
        isOpen={wecomModalOpen}
        onClose={() => setWecomModalOpen(false)}
        onBindingSuccess={() => {
          loadWeComStatus();
        }}
      />

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
}
