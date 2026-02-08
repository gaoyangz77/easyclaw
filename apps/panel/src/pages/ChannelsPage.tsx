import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchChannelStatus, deleteChannelAccount, type ChannelsStatusSnapshot, type ChannelAccountSnapshot } from "../api.js";
import { AddChannelAccountModal } from "../components/AddChannelAccountModal.js";
import { ManageAllowlistModal } from "../components/ManageAllowlistModal.js";

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

function StatusBadge({ status }: { status: boolean | null | undefined }) {
  const color = status === true ? "#4caf50" : status === false ? "#f44336" : "#9e9e9e";
  const text = status === true ? "Yes" : status === false ? "No" : "Unknown";

  return (
    <span style={{
      fontSize: 12,
      color,
      fontWeight: 600,
      backgroundColor: `${color}15`,
      padding: "3px 8px",
      borderRadius: 3,
    }}>
      {text}
    </span>
  );
}

export function ChannelsPage() {
  const { t } = useTranslation();
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
      await loadChannelStatus(false);
    } catch (err) {
      alert(`Failed to delete: ${String(err)}`);
    }
  }

  function handleModalClose() {
    setModalOpen(false);
    setEditingAccount(undefined);
  }

  function handleModalSuccess() {
    loadChannelStatus(false);
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
        <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>
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
        <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>
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
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
          <h1 style={{ margin: 0 }}>{t("channels.title")}</h1>
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : `↻ ${t("channels.refreshButton")}`}
          </button>
        </div>
        <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: 14 }}>
          {t("channels.statusSubtitle")}
        </p>
      </div>

      {/* Add Account Section */}
      <div className="section-card" style={{ marginBottom: 20 }}>
        <h3>{t("channels.addAccount")}</h3>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
          <label htmlFor="channel-select" style={{ fontSize: 13, fontWeight: 500, color: "#666" }}>
            {t("channels.selectChannelType")}
          </label>
          <select
            id="channel-select"
            value={selectedDropdownChannel}
            onChange={(e) => setSelectedDropdownChannel(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 4,
              border: "1px solid #e0e0e0",
              fontSize: 14,
              minWidth: 200,
            }}
          >
            <option value="" disabled>{t("channels.selectChannel")}</option>
            {KNOWN_CHANNELS.map(ch => (
              <option key={ch.id} value={ch.id}>
                {t(ch.labelKey)}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            onClick={handleAddAccountFromDropdown}
            disabled={!selectedDropdownChannel}
          >
            {t("channels.addAccount")}
          </button>
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
                <td colSpan={9} style={{ textAlign: "center", color: "#888", padding: "24px 14px" }}>
                  {t("channels.noAccountsConfigured")}
                </td>
              </tr>
            ) : (
              allAccounts.map(({ channelId, channelLabel, account }) => (
                <tr key={`${channelId}-${account.accountId}`} className="table-hover-row">
                  <td style={{ fontWeight: 500 }}>{channelLabel}</td>
                  <td>
                    <code style={{ fontSize: 12, color: "#666" }}>{account.accountId}</code>
                  </td>
                  <td>{account.name || "—"}</td>
                  <td><StatusBadge status={account.configured} /></td>
                  <td><StatusBadge status={account.running} /></td>
                  <td><StatusBadge status={account.connected} /></td>
                  <td style={{ fontSize: 12, color: "#666" }}>
                    {account.dmPolicy || "—"}
                  </td>
                  <td style={{ fontSize: 12, color: "#666" }}>
                    {account.mode || "—"}
                    {account.lastError && (
                      <div style={{ fontSize: 11, color: "#c62828", marginTop: 2 }}>
                        ⚠️ {account.lastError}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
      <div style={{ marginTop: 16, textAlign: "right", fontSize: 12, color: "#999" }}>
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
