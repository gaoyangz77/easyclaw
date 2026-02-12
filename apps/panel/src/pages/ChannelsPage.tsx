import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchChannelStatus, deleteChannelAccount, type ChannelsStatusSnapshot, type ChannelAccountSnapshot } from "../api.js";
import { AddChannelAccountModal } from "../components/AddChannelAccountModal.js";
import { ManageAllowlistModal } from "../components/ManageAllowlistModal.js";
import { Select } from "../components/Select.js";

// OpenClaw built-in channels
const KNOWN_CHANNELS = [
  { id: "telegram", labelKey: "channels.channelTelegram", tutorialUrl: "https://docs.openclaw.ai/channels/telegram", tooltip: "channels.tooltipTelegram" },
  { id: "whatsapp", labelKey: "channels.channelWhatsApp", tutorialUrl: "https://docs.openclaw.ai/channels/whatsapp", tooltip: "channels.tooltipWhatsApp" },
  { id: "discord", labelKey: "channels.channelDiscord", tutorialUrl: "https://docs.openclaw.ai/channels/discord", tooltip: "channels.tooltipDiscord" },
  { id: "slack", labelKey: "channels.channelSlack", tutorialUrl: "https://docs.openclaw.ai/channels/slack", tooltip: "channels.tooltipSlack" },
  { id: "googlechat", labelKey: "channels.channelGoogleChat", tutorialUrl: "https://docs.openclaw.ai/channels/googlechat", tooltip: "channels.tooltipGoogleChat" },
  { id: "signal", labelKey: "channels.channelSignal", tutorialUrl: "https://docs.openclaw.ai/channels/signal", tooltip: "channels.tooltipSignal" },
  { id: "imessage", labelKey: "channels.channelIMessage", tutorialUrl: "https://docs.openclaw.ai/channels/imessage", tooltip: "channels.tooltipIMessage" },
  { id: "feishu", labelKey: "channels.channelFeishu", tutorialUrl: "https://docs.openclaw.ai/channels/feishu", tooltip: "channels.tooltipFeishu" },
  { id: "line", labelKey: "channels.channelLine", tutorialUrl: "https://docs.openclaw.ai/channels/line", tooltip: "channels.tooltipLine" },
  { id: "matrix", labelKey: "channels.channelMatrix", tutorialUrl: "https://docs.openclaw.ai/channels/matrix", tooltip: "channels.tooltipMatrix" },
  { id: "mattermost", labelKey: "channels.channelMattermost", tutorialUrl: "https://docs.openclaw.ai/channels/mattermost", tooltip: "channels.tooltipMattermost" },
  { id: "msteams", labelKey: "channels.channelMsteams", tutorialUrl: "https://docs.openclaw.ai/channels/msteams", tooltip: "channels.tooltipMsteams" },
] as const;

// Channels that require services blocked in mainland China (GFW)
const CHINA_BLOCKED_CHANNELS = new Set([
  "telegram", "whatsapp", "discord", "signal", "line", "googlechat", "slack",
]);

function StatusBadge({ status }: { status: boolean | null | undefined }) {
  const variant = status === true ? "badge-success" : status === false ? "badge-danger" : "badge-warning";
  const text = status === true ? "Yes" : status === false ? "No" : "Unknown";

  return (
    <span className={`badge ${variant}`}>
      {text}
    </span>
  );
}

export function ChannelsPage() {
  const { t, i18n } = useTranslation();
  const [snapshot, setSnapshot] = useState<ChannelsStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [selectedChannelLabel, setSelectedChannelLabel] = useState<string>("");
  const [editingAccount, setEditingAccount] = useState<{ accountId: string; name?: string; config: Record<string, unknown> } | undefined>(undefined);

  // Allowlist modal state
  const [allowlistModalOpen, setAllowlistModalOpen] = useState(false);
  const [allowlistChannelId, setAllowlistChannelId] = useState<string>("");
  const [allowlistChannelLabel, setAllowlistChannelLabel] = useState<string>("");

  // Dropdown selection state for add account
  const [selectedDropdownChannel, setSelectedDropdownChannel] = useState<string>("");

  const visibleChannels = i18n.language === "zh"
    ? KNOWN_CHANNELS.filter(ch => !CHINA_BLOCKED_CHANNELS.has(ch.id) || ch.id === selectedDropdownChannel)
    : KNOWN_CHANNELS;

  async function loadChannelStatus(showLoading = true) {
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const data = await fetchChannelStatus(true);
      setSnapshot(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadChannelStatus();

    // Quick re-fetch after 3s so probe results are picked up promptly
    const quick = setTimeout(() => loadChannelStatus(false), 3000);

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      setRefreshing(true);
      loadChannelStatus(false);
    }, 30000);

    return () => { clearTimeout(quick); clearInterval(interval); };
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    loadChannelStatus(false);
  }

  function handleAddAccountFromDropdown() {
    if (!selectedDropdownChannel) return;

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

  async function handleDeleteAccount(channelId: string, accountId: string) {
    const knownChannel = KNOWN_CHANNELS.find(c => c.id === channelId);
    const label = knownChannel ? t(knownChannel.labelKey) : channelId;

    const confirmed = window.confirm(
      `${t("common.delete")} ${label} account "${accountId}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await deleteChannelAccount(channelId, accountId);
      // Delay re-fetch to give the gateway time to reload config after deletion
      setTimeout(() => loadChannelStatus(false), 1500);
    } catch (err) {
      alert(`Failed to delete: ${String(err)}`);
    }
  }

  function handleModalClose() {
    setModalOpen(false);
    setEditingAccount(undefined);
  }

  function handleModalSuccess() {
    // Delay re-fetch to give the gateway time to reload config after changes
    setTimeout(() => loadChannelStatus(false), 1500);
  }

  function handleManageAllowlist(channelId: string) {
    const knownChannel = KNOWN_CHANNELS.find(c => c.id === channelId);
    const label = knownChannel ? t(knownChannel.labelKey) : snapshot?.channelLabels[channelId] || channelId;

    setAllowlistChannelId(channelId);
    setAllowlistChannelLabel(label);
    setAllowlistModalOpen(true);
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
          <strong>Error loading channels:</strong> {error}
          <div style={{ marginTop: 8 }}>
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
          Gateway not connected
        </div>
      </div>
    );
  }

  // Collect all accounts from all channels, filtering out synthetic "default" placeholders
  const allAccounts: Array<{ channelId: string; channelLabel: string; account: ChannelAccountSnapshot }> = [];

  for (const [channelId, accounts] of Object.entries(snapshot.channelAccounts)) {
    const knownChannel = KNOWN_CHANNELS.find(c => c.id === channelId);
    const channelLabel = knownChannel ? t(knownChannel.labelKey) : snapshot.channelLabels[channelId] || channelId;

    for (const account of accounts) {
      // Skip synthetic "default" placeholder accounts (auto-generated by gateway when no config exists)
      // Identify by: accountId="default" + not configured + no name + no token source
      const isSyntheticDefault =
        account.accountId === "default" &&
        account.configured === false &&
        !account.name &&
        (account as any).tokenSource === "none";

      if (isSyntheticDefault) {
        continue;
      }
      allAccounts.push({ channelId, channelLabel, account });
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="channel-header">
        <div className="channel-title-row">
          <h1 style={{ margin: 0 }}>{t("channels.title")}</h1>
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : `↻ ${t("channels.refreshButton")}`}
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
              options={visibleChannels.map(ch => ({
                value: ch.id,
                label: t(ch.labelKey),
              }))}
              style={{ minWidth: 200 }}
            />
            <button
              className="btn btn-primary"
              onClick={handleAddAccountFromDropdown}
              disabled={!selectedDropdownChannel}
            >
              {t("channels.addAccount")}
            </button>
          </div>

          {/* Tooltip and tutorial link for selected channel */}
          {selectedDropdownChannel && (() => {
            const selected = KNOWN_CHANNELS.find(ch => ch.id === selectedDropdownChannel);
            if (!selected) return null;

            return (
              <div className="channel-info-box">
                <div className="channel-info-title">
                  ℹ️ {t(selected.tooltip)}
                </div>
                <div>
                  <a
                    href={selected.tutorialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium"
                  >
                    📖 {t("channels.viewTutorial")} →
                  </a>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Accounts Table */}
      <div className="section-card">
        <h3>{t("channels.allAccounts")}</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: "11%" }}>{t("channels.colChannel")}</th>
              <th style={{ width: "13%" }}>{t("channels.colAccountId")}</th>
              <th style={{ width: "12%" }}>{t("channels.colName")}</th>
              <th style={{ width: "8%" }}>{t("channels.statusConfigured")}</th>
              <th style={{ width: "8%" }}>{t("channels.statusRunning")}</th>
              <th style={{ width: "8%" }}>{t("channels.statusConnected")}</th>
              <th style={{ width: "10%" }}>{t("channels.fieldDmPolicy")}</th>
              <th style={{ width: "10%" }}>{t("channels.colMode")}</th>
              <th style={{ width: "15%" }}>{t("channels.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {allAccounts.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-cell">
                  {t("channels.noAccountsConfigured")}
                </td>
              </tr>
            ) : (
              allAccounts.map(({ channelId, channelLabel, account }) => (
                <tr key={`${channelId}-${account.accountId}`} className="table-hover-row">
                  <td className="font-medium">{channelLabel}</td>
                  <td>
                    <code className="td-meta">{account.accountId}</code>
                  </td>
                  <td>{account.name || "—"}</td>
                  <td><StatusBadge status={account.configured} /></td>
                  <td><StatusBadge status={account.running} /></td>
                  <td><StatusBadge status={account.connected} /></td>
                  <td className="td-meta">
                    {account.dmPolicy || "—"}
                  </td>
                  <td className="td-meta">
                    {account.mode || "—"}
                    {account.lastError && (
                      <div className="text-xs text-danger" style={{ marginTop: 2 }}>
                        ⚠️ {account.lastError}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="td-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleEditAccount(channelId, account)}
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleManageAllowlist(channelId)}
                        title={t("pairing.manageAllowlist")}
                      >
                        {t("pairing.allowlist")}
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteAccount(channelId, account.accountId)}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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

      {/* Manage Allowlist Modal */}
      <ManageAllowlistModal
        isOpen={allowlistModalOpen}
        onClose={() => setAllowlistModalOpen(false)}
        channelId={allowlistChannelId}
        channelLabel={allowlistChannelLabel}
      />
    </div>
  );
}
