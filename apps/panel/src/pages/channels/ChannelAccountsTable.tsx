import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { panelEventBus } from "../../lib/event-bus.js";
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
import type { MobileDeviceStatusResponse, MobilePairingInfo } from "../../api/mobile-chat.js";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
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

function WechatActivationWarning({ tooltip }: { tooltip: string }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [bubble, setBubble] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(null);

  const show = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const tooltipMaxWidth = Math.min(320, window.innerWidth - 32);
    const halfWidth = tooltipMaxWidth / 2;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, halfWidth + 16),
      window.innerWidth - halfWidth - 16,
    );
    const placement = rect.top > 72 ? "top" : "bottom";
    setBubble({
      top: placement === "top" ? rect.top : rect.bottom,
      left,
      placement,
    });
  }, []);

  const hide = useCallback(() => setBubble(null), []);

  return (
    <>
      <span
        ref={triggerRef}
        className="wechat-activation-warning"
        aria-label={tooltip}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        !
      </span>
      {bubble && createPortal(
        <div
          className={`wechat-activation-tooltip wechat-activation-tooltip-${bubble.placement}`}
          style={{ top: bubble.top, left: bubble.left }}
          role="tooltip"
        >
          {tooltip}
        </div>,
        document.body,
      )}
    </>
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
  const entityStore = useEntityStore();
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [recipientData, setRecipientData] = useState<Record<string, RecipientData>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ compositeKey: string; channelId: string; accountId?: string; entry: string } | null>(null);
  const [mobileDeviceStatus, setMobileDeviceStatus] = useState<MobileDeviceStatusResponse["devices"]>({});
  const [mobilePairings, setMobilePairings] = useState<MobilePairingInfo[]>([]);

  // Track in-flight label saves to show subtle feedback
  const savingLabelsRef = useRef<Set<string>>(new Set());

  // Poll mobile device status and fetch pairings while any mobile account is expanded
  const hasMobileExpanded = Array.from(expandedAccounts).some(key => key.startsWith("mobile:"));
  useEffect(() => {
    if (!hasMobileExpanded) return;

    let cancelled = false;
    async function poll() {
      try {
        const [statusResult, pairingResult] = await Promise.all([
          entityStore.mobileManager.getDeviceStatus(),
          entityStore.mobileManager.getStatus(),
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
  }, [hasMobileExpanded]);

  // Background refresh: update recipient data without resetting to loading state
  async function refreshRecipientData(channelId: string, accountId: string) {
    const compositeKey = `${channelId}:${accountId}`;
    try {
      const [result, requests] = await Promise.all([
        fetchAllowlist(channelId, accountId),
        fetchPairingRequests(channelId, accountId),
      ]);
      setRecipientData(prev => ({
        ...prev,
        [compositeKey]: {
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

  // Listen for SSE recipient-added events to refresh expanded accounts in real-time.
  // The event is emitted by two desktop paths:
  //   1. pairing-notifier (Telegram/Feishu pairing file watcher)
  //   2. gateway event-dispatcher (rivonclaw.recipient-seen — WeChat etc.)
  useEffect(() => {
    const nonMobileExpanded = Array.from(expandedAccounts).filter(key => !key.startsWith("mobile:"));
    if (nonMobileExpanded.length === 0) return;

    const unsubscribe = panelEventBus.subscribe("recipient-added", (raw) => {
      const { channelId, accountId } = raw as { channelId: string; accountId?: string };
      // Find expanded composite keys matching this channelId/accountId and refresh each.
      // Older events do not carry accountId, so fall back to channel-wide refresh.
      for (const key of nonMobileExpanded) {
        const [keyChannelId, keyAccountId] = key.split(":", 2);
        if (keyChannelId === channelId && (!accountId || keyAccountId === accountId)) {
          refreshRecipientData(channelId, keyAccountId);
        }
      }
    });

    return () => unsubscribe();
  }, [expandedAccounts]);

  async function loadRecipientData(channelId: string, accountId: string) {
    const compositeKey = `${channelId}:${accountId}`;
    setRecipientData(prev => ({
      ...prev,
      [compositeKey]: { loading: true, error: null, allowlist: [], labels: {}, owners: {}, pairingRequests: [] },
    }));

    try {
      const [result, requests] = await Promise.all([
        fetchAllowlist(channelId, accountId),
        fetchPairingRequests(channelId, accountId),
      ]);
      setRecipientData(prev => ({
        ...prev,
        [compositeKey]: {
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
        [compositeKey]: {
          ...prev[compositeKey],
          loading: false,
          error: String(err),
        },
      }));
    }
  }

  function toggleExpand(channelId: string, accountId: string) {
    const compositeKey = `${channelId}:${accountId}`;
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(compositeKey)) {
        next.delete(compositeKey);
                      } else {
                        next.add(compositeKey);
                        // Lazy load data on first expand
                        if (!recipientData[compositeKey]) {
                          loadRecipientData(channelId, accountId);
        }
      }
      return next;
    });
  }

  async function handleApprove(compositeKey: string, channelId: string, accountId: string, code: string) {
    setProcessing(code);
    try {
      const result = await approvePairing(channelId, code, i18nLang, accountId);
      setRecipientData(prev => {
        const data = prev[compositeKey];
        if (!data) return prev;
        return {
          ...prev,
          [compositeKey]: {
            ...data,
            pairingRequests: data.pairingRequests.filter(r => r.code !== code),
            allowlist: data.allowlist.includes(result.id) ? data.allowlist : [...data.allowlist, result.id],
            owners: { ...data.owners, [result.id]: true },
          },
        };
      });
    } catch (err) {
      setRecipientData(prev => {
        const data = prev[compositeKey];
        if (!data) return prev;
        return { ...prev, [compositeKey]: { ...data, error: `${t("pairing.failedToApprove")} ${String(err)}` } };
      });
    } finally {
      setProcessing(null);
    }
  }

  function requestRemove(compositeKey: string, channelId: string, accountId: string, entry: string) {
    setRemoveConfirm({ compositeKey, channelId, accountId, entry });
  }

  async function confirmRemove() {
    if (!removeConfirm) return;
    const { compositeKey, channelId, accountId, entry } = removeConfirm;
    setRemoveConfirm(null);
    setProcessing(entry);

    try {
      if (channelId === "mobile") {
        // Mobile channel: use full disconnect (DB + allowlist + engine cleanup)
        // Find the pairing DB id by mobileDeviceId
        const statusResp = await entityStore.mobileManager.getStatus();
        const pairing = statusResp.pairings?.find(p => p.pairingId === entry || p.id === entry);
        if (pairing?.id) {
          await entityStore.mobileManager.disconnectOne(pairing.id);
        }
      } else {
        await removeFromAllowlist(channelId, entry, accountId);
      }
      setRecipientData(prev => {
        const data = prev[compositeKey];
        if (!data) return prev;
        return {
          ...prev,
          [compositeKey]: {
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
        const data = prev[compositeKey];
        if (!data) return prev;
        return { ...prev, [compositeKey]: { ...data, error: `${t("pairing.failedToRemove")} ${String(err)}` } };
      });
    } finally {
      setProcessing(null);
    }
  }

  async function handleOwnerToggle(compositeKey: string, channelId: string, accountId: string, recipientId: string, newValue: boolean) {
    const data = recipientData[compositeKey];
    if (!data) return;

    const oldValue = data.owners[recipientId] ?? false;

    // Optimistic update
    setRecipientData(prev => ({
      ...prev,
      [compositeKey]: {
        ...prev[compositeKey],
        owners: { ...prev[compositeKey].owners, [recipientId]: newValue },
      },
    }));

    try {
      await setRecipientOwner(channelId, recipientId, newValue, accountId);
    } catch {
      // Revert on failure
      setRecipientData(prev => ({
        ...prev,
        [compositeKey]: {
          ...prev[compositeKey],
          owners: { ...prev[compositeKey].owners, [recipientId]: oldValue },
        },
      }));
    }
  }

  async function handleLabelBlur(compositeKey: string, channelId: string, accountId: string, recipientId: string, newLabel: string) {
    const data = recipientData[compositeKey];
    if (!data) return;

    const oldLabel = data.labels[recipientId] || "";
    if (newLabel === oldLabel) return;

    const saveKey = `${compositeKey}:${recipientId}`;
    savingLabelsRef.current.add(saveKey);

    // Optimistic update
    setRecipientData(prev => ({
      ...prev,
      [compositeKey]: {
        ...prev[compositeKey],
        labels: { ...prev[compositeKey].labels, [recipientId]: newLabel },
      },
    }));

    try {
      await setRecipientLabel(channelId, recipientId, newLabel, accountId);
    } catch {
      // Revert on failure
      setRecipientData(prev => ({
        ...prev,
        [compositeKey]: {
          ...prev[compositeKey],
          labels: { ...prev[compositeKey].labels, [recipientId]: oldLabel },
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

  function renderExpandedRow(compositeKey: string, channelId: string, accountId: string) {
    const data = recipientData[compositeKey];
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
                            onClick={() => handleApprove(compositeKey, channelId, accountId, request.code)}
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
                              onBlur={e => handleLabelBlur(compositeKey, channelId, accountId, entry, e.target.value.trim())}
                            />
                          </td>
                          <td>
                            <div className="perm-switcher">
                              <button
                                className={`perm-switcher-btn perm-switcher-btn-left ${isOwner ? "perm-switcher-btn-active" : "perm-switcher-btn-inactive"}`}
                                onClick={() => !isOwner && handleOwnerToggle(compositeKey, channelId, accountId, entry, true)}
                              >
                                {t("pairing.ownerBadge")}
                              </button>
                              <button
                                className={`perm-switcher-btn perm-switcher-btn-right ${!isOwner ? "perm-switcher-btn-active" : "perm-switcher-btn-inactive"}`}
                                onClick={() => isOwner && handleOwnerToggle(compositeKey, channelId, accountId, entry, false)}
                              >
                                {t("pairing.nonOwnerBadge")}
                              </button>
                            </div>
                          </td>
                          <td className="text-right">
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => requestRemove(compositeKey, channelId, accountId, entry)}
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
                const compositeKey = `${channelId}:${account.accountId}`;
                const isDeleting = deletingKey === rowKey;
                const isExpanded = expandedAccounts.has(compositeKey);
                const canExpand = true;
                const canEdit = channelId !== "mobile";
                const needsWeixinActivation =
                  channelId === "openclaw-weixin" && account.contextTokenReady === false;
                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={`table-hover-row${isDeleting ? " row-deleting" : ""}${canExpand ? " row-expandable" : ""}`}
                      onClick={(e) => {
                        if (isDeleting || !canExpand) return;
                        // Don't toggle when clicking buttons or inputs
                        const target = e.target as HTMLElement;
                        if (target.closest("button, a, input, select")) return;
                        toggleExpand(channelId, account.accountId);
                      }}
                    >
                      <td className="channel-expand-col">
                        {canExpand && <span className={`advanced-chevron${isExpanded ? " advanced-chevron-open" : ""}`}><ChevronRightIcon /></span>}
                      </td>
                      <td className="font-medium">
                        <span className="channel-label-with-status">
                          {needsWeixinActivation && (
                            <WechatActivationWarning tooltip={t("channels.wechatContextTokenNotReadyTooltip")} />
                          )}
                          <span>{channelLabel}</span>
                        </span>
                      </td>
                      <td>{account.name || "\u2014"}</td>
                      <td><StatusBadge status={account.configured} t={t} /></td>
                      <td><StatusBadge status={account.running} t={t} /></td>
                      <td>{account.dmPolicy ? t(`channels.dmPolicyLabel_${account.dmPolicy}`, { defaultValue: account.dmPolicy }) : "\u2014"}</td>
                      <td>
                        <div className="td-actions">
                          {canEdit ? (
                            <button
                              className="btn btn-secondary"
                              onClick={() => onEdit(channelId, account)}
                              disabled={isDeleting}
                            >
                              {t("common.edit")}
                            </button>
                          ) : (
                            <button className="btn btn-secondary btn-invisible" disabled aria-hidden="true">{t("common.edit")}</button>
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
                    {isExpanded && canExpand && renderExpandedRow(compositeKey, channelId, account.accountId)}
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
