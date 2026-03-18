import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import type { ChannelAccountSnapshot } from "../../api/index.js";
import { ChevronRightIcon } from "../../components/icons.js";
import {
  fetchAllowlist,
  fetchPairingRequests,
  approvePairing,
  removeFromAllowlist,
  setRecipientLabel,
  setRecipientOwner,
  type PairingRequest,
} from "../../api/channels.js";
import { fetchMobileDeviceStatus, disconnectMobilePairing, getMobilePairingStatus, type MobileDeviceStatusResponse, type MobilePairingInfo } from "../../api/mobile-chat.js";
import { ConfirmDialog } from "../../components/modals/ConfirmDialog.js";
import { StatusBadge, type AccountEntry } from "./channel-defs.jsx";

/** Show last 3 chars of an ID with a copy-to-clipboard button. */
function TruncatedId({ value, t }: { value: string; t: (key: string) => string }) {
  const [copied, setCopied] = useState(false);
  const suffix = value.length > 3 ? `...${value.slice(-3)}` : value;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { });
  }, [value]);

  return (
    <span className="id-truncated">
      <code>{suffix}</code>
      <button className={`id-copy-btn${copied ? " copied" : ""}`} onClick={handleCopy} title={value}>
        {copied ? t("pairing.copied") : "⧉"}
      </button>
    </span>
  );
}

interface RecipientData {
  loading: boolean;
  error: string | null;
  allowlist: string[];
  labels: Record<string, string>;
  owners: Record<string, boolean>;
  pairingRequests: PairingRequest[];
}

export function ChannelAccountsTable({
  allAccounts,
  deletingKey,
  t,
  i18nLang,
  onEdit,
  onDelete,
}: {
  allAccounts: AccountEntry[];
  deletingKey: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
  i18nLang: string;
  onEdit: (channelId: string, account: ChannelAccountSnapshot) => void;
  onDelete: (channelId: string, accountId: string) => void;
}) {
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());
  const [recipientData, setRecipientData] = useState<Record<string, RecipientData>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ channelId: string; entry: string } | null>(null);
  const [mobileDeviceStatus, setMobileDeviceStatus] = useState<MobileDeviceStatusResponse["devices"]>({});
  const [mobilePairings, setMobilePairings] = useState<MobilePairingInfo[]>([]);

  // Track in-flight label saves to show subtle feedback
  const savingLabelsRef = useRef<Set<string>>(new Set());

  // Poll mobile device status and fetch pairings while the mobile channel is expanded
  useEffect(() => {
    if (!expandedChannels.has("mobile")) return;

    let cancelled = false;
    async function poll() {
      try {
        const [statusResult, pairingResult] = await Promise.all([
          fetchMobileDeviceStatus(),
          getMobilePairingStatus(),
        ]);
        if (!cancelled) {
          setMobileDeviceStatus(statusResult.devices);
          if (pairingResult.pairings) setMobilePairings(pairingResult.pairings);
        }
      } catch { /* ignore */ }
    }
    poll();
    const timer = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [expandedChannels.has("mobile")]);

  // Background refresh: update recipient data without resetting to loading state
  async function refreshRecipientData(channelId: string) {
    try {
      const [result, requests] = await Promise.all([
        fetchAllowlist(channelId),
        fetchPairingRequests(channelId),
      ]);
      setRecipientData(prev => ({
        ...prev,
        [channelId]: {
          loading: false,
          error: null,
          allowlist: result.allowlist,
          labels: result.labels,
          owners: result.owners ?? {},
          pairingRequests: requests,
        },
      }));
    } catch {
      // Silently ignore background refresh errors to avoid disrupting the UI
    }
  }

  // Listen for SSE pairing-update events to refresh expanded channels in real-time
  useEffect(() => {
    const nonMobileExpanded = Array.from(expandedChannels).filter(ch => ch !== "mobile");
    if (nonMobileExpanded.length === 0) return;

    const sse = new EventSource("/api/chat/events");

    sse.addEventListener("pairing-update", (e: MessageEvent) => {
      try {
        const { channelId } = JSON.parse(e.data) as { channelId: string };
        if (nonMobileExpanded.includes(channelId)) {
          refreshRecipientData(channelId);
        }
      } catch { /* ignore malformed events */ }
    });

    return () => sse.close();
  }, [expandedChannels]);

  async function loadRecipientData(channelId: string) {
    setRecipientData(prev => ({
      ...prev,
      [channelId]: { loading: true, error: null, allowlist: [], labels: {}, owners: {}, pairingRequests: [] },
    }));

    try {
      const [result, requests] = await Promise.all([
        fetchAllowlist(channelId),
        fetchPairingRequests(channelId),
      ]);
      setRecipientData(prev => ({
        ...prev,
        [channelId]: {
          loading: false,
          error: null,
          allowlist: result.allowlist,
          labels: result.labels,
          owners: result.owners ?? {},
          pairingRequests: requests,
        },
      }));
    } catch (err) {
      setRecipientData(prev => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          loading: false,
          error: String(err),
        },
      }));
    }
  }

  function toggleExpand(channelId: string) {
    setExpandedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
        // Lazy load data on first expand
        if (!recipientData[channelId]) {
          loadRecipientData(channelId);
        }
      }
      return next;
    });
  }

  async function handleApprove(channelId: string, code: string) {
    setProcessing(code);
    try {
      const result = await approvePairing(channelId, code, i18nLang);
      setRecipientData(prev => {
        const data = prev[channelId];
        if (!data) return prev;
        return {
          ...prev,
          [channelId]: {
            ...data,
            pairingRequests: data.pairingRequests.filter(r => r.code !== code),
            allowlist: [...data.allowlist, result.id],
          },
        };
      });
    } catch (err) {
      setRecipientData(prev => {
        const data = prev[channelId];
        if (!data) return prev;
        return { ...prev, [channelId]: { ...data, error: `${t("pairing.failedToApprove")} ${String(err)}` } };
      });
    } finally {
      setProcessing(null);
    }
  }

  function requestRemove(channelId: string, entry: string) {
    setRemoveConfirm({ channelId, entry });
  }

  async function confirmRemove() {
    if (!removeConfirm) return;
    const { channelId, entry } = removeConfirm;
    setRemoveConfirm(null);
    setProcessing(entry);

    try {
      if (channelId === "mobile") {
        // Mobile channel: use full disconnect (DB + allowlist + engine cleanup)
        // Find the pairing DB id by mobileDeviceId
        const statusResp = await getMobilePairingStatus();
        const pairing = statusResp.pairings?.find(p => p.pairingId === entry || p.id === entry);
        await disconnectMobilePairing(pairing?.id);
      } else {
        await removeFromAllowlist(channelId, entry);
      }
      setRecipientData(prev => {
        const data = prev[channelId];
        if (!data) return prev;
        return {
          ...prev,
          [channelId]: {
            ...data,
            allowlist: data.allowlist.filter(e => e !== entry),
          },
        };
      });
      // Clear stale status from local state
      if (channelId === "mobile") {
        setMobileDeviceStatus(prev => {
          const next = { ...prev };
          delete next[entry];
          return next;
        });
      }
    } catch (err) {
      setRecipientData(prev => {
        const data = prev[channelId];
        if (!data) return prev;
        return { ...prev, [channelId]: { ...data, error: `${t("pairing.failedToRemove")} ${String(err)}` } };
      });
    } finally {
      setProcessing(null);
    }
  }

  async function handleOwnerToggle(channelId: string, recipientId: string, newValue: boolean) {
    const data = recipientData[channelId];
    if (!data) return;

    const oldValue = data.owners[recipientId] ?? false;

    // Optimistic update
    setRecipientData(prev => ({
      ...prev,
      [channelId]: {
        ...prev[channelId],
        owners: { ...prev[channelId].owners, [recipientId]: newValue },
      },
    }));

    try {
      await setRecipientOwner(channelId, recipientId, newValue);
    } catch {
      // Revert on failure
      setRecipientData(prev => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          owners: { ...prev[channelId].owners, [recipientId]: oldValue },
        },
      }));
    }
  }

  async function handleLabelBlur(channelId: string, recipientId: string, newLabel: string) {
    const data = recipientData[channelId];
    if (!data) return;

    const oldLabel = data.labels[recipientId] || "";
    if (newLabel === oldLabel) return;

    const saveKey = `${channelId}:${recipientId}`;
    savingLabelsRef.current.add(saveKey);

    // Optimistic update
    setRecipientData(prev => ({
      ...prev,
      [channelId]: {
        ...prev[channelId],
        labels: { ...prev[channelId].labels, [recipientId]: newLabel },
      },
    }));

    try {
      await setRecipientLabel(channelId, recipientId, newLabel);
    } catch {
      // Revert on failure
      setRecipientData(prev => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          labels: { ...prev[channelId].labels, [recipientId]: oldLabel },
        },
      }));
    } finally {
      savingLabelsRef.current.delete(saveKey);
    }
  }

  function formatTimeAgo(timestamp: string): string {
    const now = Date.now();
    const then = Date.parse(timestamp);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t("pairing.timeJustNow");
    if (diffMins < 60) return t("pairing.timeMinutesAgo", { count: diffMins });

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t("pairing.timeHoursAgo", { count: diffHours });

    const diffDays = Math.floor(diffHours / 24);
    return t("pairing.timeDaysAgo", { count: diffDays });
  }

  function renderExpandedRow(channelId: string) {
    const data = recipientData[channelId];
    if (!data) return null;

    if (data.loading) {
      return (
        <tr className="channel-recipients-row">
          <td className="channel-expand-col"></td>
          <td colSpan={6}>
            <div className="recipients-loading">{t("common.loading")}...</div>
          </td>
        </tr>
      );
    }

    if (data.error) {
      return (
        <tr className="channel-recipients-row">
          <td className="channel-expand-col"></td>
          <td colSpan={6}>
            <div className="modal-error-box">
              <strong>{t("channels.errorLabel")}</strong> {data.error}
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr className="channel-recipients-row">
        <td className="channel-expand-col"></td>
        <td colSpan={6}>
          <div className="recipients-section">
            {/* Pending Pairing Requests */}
            {data.pairingRequests.length > 0 && (
              <div>
                <h4>{t("pairing.pendingRequests")} ({data.pairingRequests.length})</h4>
                <table className="recipients-table">
                  <thead>
                    <tr>
                      <th>{t("pairing.code")}</th>
                      <th>{t("pairing.userId")}</th>
                      <th>{t("pairing.requestedAt")}</th>
                      <th className="text-right">{t("pairing.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pairingRequests.map(request => (
                      <tr key={request.code}>
                        <td><code className="td-code">{request.code}</code></td>
                        <td>{request.id}</td>
                        <td className="td-muted">{formatTimeAgo(request.createdAt)}</td>
                        <td className="text-right">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleApprove(channelId, request.code)}
                            disabled={processing === request.code}
                          >
                            {processing === request.code ? t("pairing.approving") : t("pairing.approve")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Allowlist */}
            <div>
              <h4>{t("pairing.currentAllowlist")} ({data.allowlist.length})</h4>
              {data.allowlist.length === 0 ? (
                <div className="recipients-empty">{t("pairing.noRecipients")}</div>
              ) : (
                <table className="recipients-table">
                  <thead>
                    <tr>
                      {channelId === "mobile" && <th className="presence-col"></th>}
                      <th>{t("pairing.userId")}</th>
                      {channelId === "mobile" && <th>{t("pairing.pairingIdColumn")}</th>}
                      <th>{t("pairing.aliasColumn")}</th>
                      <th>{t("pairing.roleColumn")}</th>
                      <th className="text-right">{t("pairing.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.allowlist.map(entry => {
                      const isOwner = data.owners[entry] ?? false;
                      const deviceStatus = channelId === "mobile" ? mobileDeviceStatus[entry] : undefined;
                      const pairingInfo = channelId === "mobile"
                        ? mobilePairings.find(p => p.pairingId === entry || p.id === entry)
                        : undefined;
                      return (
                        <tr key={entry}>
                          {channelId === "mobile" && (
                            <td className="presence-col">
                              <span
                                className={`presence-dot ${deviceStatus?.stale ? "presence-stale" : deviceStatus?.mobileOnline ? "presence-online" : "presence-offline"}`}
                                title={deviceStatus?.stale ? t("pairing.staleTooltip") : deviceStatus?.mobileOnline ? "Online" : "Offline"}
                              />
                            </td>
                          )}
                          <td>
                            <TruncatedId value={channelId === "mobile" ? (pairingInfo?.mobileDeviceId || entry) : entry} t={t} />
                            {deviceStatus?.stale && (
                              <span className="stale-hint">{t("pairing.staleHint")}</span>
                            )}
                          </td>
                          {channelId === "mobile" && (
                            <td><TruncatedId value={entry} t={t} /></td>
                          )}
                          <td>
                            <input
                              className="recipient-label-input"
                              defaultValue={data.labels[entry] || ""}
                              placeholder={t("pairing.labelPlaceholder")}
                              onBlur={e => handleLabelBlur(channelId, entry, e.target.value.trim())}
                            />
                          </td>
                          <td>
                            <div className="perm-switcher">
                              <button
                                className={`perm-switcher-btn perm-switcher-btn-left ${isOwner ? "perm-switcher-btn-active" : "perm-switcher-btn-inactive"}`}
                                onClick={() => !isOwner && handleOwnerToggle(channelId, entry, true)}
                              >
                                {t("pairing.ownerBadge")}
                              </button>
                              <button
                                className={`perm-switcher-btn perm-switcher-btn-right ${!isOwner ? "perm-switcher-btn-active" : "perm-switcher-btn-inactive"}`}
                                onClick={() => isOwner && handleOwnerToggle(channelId, entry, false)}
                              >
                                {t("pairing.nonOwnerBadge")}
                              </button>
                            </div>
                          </td>
                          <td className="text-right">
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => requestRemove(channelId, entry)}
                              disabled={processing === entry}
                            >
                              {processing === entry ? t("pairing.removing") : t("common.remove")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="section-card">
      <h3>{t("channels.allAccounts")}</h3>
      <div className="table-scroll-wrap">
        <table className="channel-table">
          <thead>
            <tr>
              <th className="channel-expand-col"></th>
              <th>{t("channels.colChannel")}</th>
              <th>{t("channels.colName")}</th>
              <th>{t("channels.statusConfigured")}</th>
              <th>{t("channels.statusRunning")}</th>
              <th>{t("channels.colDmPolicy")}</th>
              <th>{t("channels.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {allAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">
                  {t("channels.noAccountsConfigured")}
                </td>
              </tr>
            ) : (
              allAccounts.map(({ channelId, channelLabel, account }) => {
                const rowKey = `${channelId}-${account.accountId}`;
                const isDeleting = deletingKey === rowKey;
                const isExpanded = expandedChannels.has(channelId);
                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={`table-hover-row${isDeleting ? " row-deleting" : ""} row-expandable`}
                      onClick={(e) => {
                        if (isDeleting) return;
                        // Don't toggle when clicking buttons or inputs
                        const target = e.target as HTMLElement;
                        if (target.closest("button, a, input, select")) return;
                        toggleExpand(channelId);
                      }}
                    >
                      <td className="channel-expand-col">
                        <span className={`advanced-chevron${isExpanded ? " advanced-chevron-open" : ""}`}><ChevronRightIcon /></span>
                      </td>
                      <td className="font-medium">{channelLabel}</td>
                      <td>{account.name || "\u2014"}</td>
                      <td><StatusBadge status={account.configured} t={t} /></td>
                      <td><StatusBadge status={account.running} t={t} /></td>
                      <td>{account.dmPolicy ? t(`channels.dmPolicyLabel_${account.dmPolicy}`, { defaultValue: account.dmPolicy }) : "\u2014"}</td>
                      <td>
                        <div className="td-actions">
                          {channelId === "mobile" ? (
                            <button className="btn btn-secondary btn-invisible" disabled aria-hidden="true">{t("common.edit")}</button>
                          ) : (
                            <button
                              className="btn btn-secondary"
                              onClick={() => onEdit(channelId, account)}
                              disabled={isDeleting}
                            >
                              {t("common.edit")}
                            </button>
                          )}
                          <button
                            className="btn btn-danger"
                            onClick={() => onDelete(channelId, account.accountId)}
                            disabled={isDeleting}
                          >
                            {isDeleting ? t("channels.deleting") : t("common.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && renderExpandedRow(channelId)}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Remove Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!removeConfirm}
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={confirmRemove}
        title={removeConfirm ? t("pairing.removeConfirmTitle", { entry: removeConfirm.entry }) : ""}
        message={t("pairing.removeConfirmMessage")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
      />
    </div>
  );
}
