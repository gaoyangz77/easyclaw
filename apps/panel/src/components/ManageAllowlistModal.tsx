import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { fetchPairingRequests, fetchAllowlist, approvePairing, removeFromAllowlist, type PairingRequest } from "../api/index.js";

export interface ManageAllowlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  channelLabel: string;
}

export function ManageAllowlistModal({
  isOpen,
  onClose,
  channelId,
  channelLabel,
}: ManageAllowlistModalProps) {
  const { t, i18n } = useTranslation();

  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([]);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  // Confirm dialog state for remove
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

  // Load data when modal opens
  useEffect(() => {
    if (!isOpen) return;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const [requests, list] = await Promise.all([
          fetchPairingRequests(channelId),
          fetchAllowlist(channelId),
        ]);
        setPairingRequests(requests);
        setAllowlist(list);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [isOpen, channelId]);

  async function handleApprove(code: string) {
    setProcessing(code);
    setError(null);

    try {
      const result = await approvePairing(channelId, code, i18n.language);

      // Remove from pending requests
      setPairingRequests(prev => prev.filter(r => r.code !== code));

      // Add to allowlist
      setAllowlist(prev => [...prev, result.id]);
    } catch (err) {
      setError(`${t("pairing.failedToApprove")} ${String(err)}`);
    } finally {
      setProcessing(null);
    }
  }

  async function confirmRemove() {
    if (!removeConfirm) return;
    const entry = removeConfirm;
    setRemoveConfirm(null);

    setProcessing(entry);
    setError(null);

    try {
      await removeFromAllowlist(channelId, entry);

      // Remove from allowlist
      setAllowlist(prev => prev.filter(e => e !== entry));
    } catch (err) {
      setError(`${t("pairing.failedToRemove")} ${String(err)}`);
    } finally {
      setProcessing(null);
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t("pairing.modalTitle")} - ${channelLabel}`}
      maxWidth={700}
    >
      <div className="modal-content-col">
        {/* Loading State */}
        {loading && (
          <div className="modal-loading">
            {t("common.loading")}...
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="modal-error-box">
            <strong>{t("channels.errorLabel")}</strong> {error}
          </div>
        )}

        {/* Pending Pairing Requests */}
        {!loading && (
          <div>
            <h3 className="modal-section-title">
              {t("pairing.pendingRequests")} ({pairingRequests.length})
            </h3>

            {pairingRequests.length === 0 ? (
              <div className="modal-empty-state">
                {t("pairing.noPendingRequests")}
              </div>
            ) : (
              <div className="modal-table-wrap">
                <table className="modal-table">
                  <thead>
                    <tr>
                      <th>
                        {t("pairing.code")}
                      </th>
                      <th>
                        {t("pairing.userId")}
                      </th>
                      <th>
                        {t("pairing.requestedAt")}
                      </th>
                      <th className="text-right">
                        {t("pairing.action")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairingRequests.map((request) => (
                      <tr key={request.code}>
                        <td>
                          <code className="td-code">
                            {request.code}
                          </code>
                        </td>
                        <td>
                          {request.id}
                        </td>
                        <td className="td-muted">
                          {formatTimeAgo(request.createdAt)}
                        </td>
                        <td className="text-right">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleApprove(request.code)}
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
          </div>
        )}

        {/* Current Allowlist */}
        {!loading && (
          <div>
            <h3 className="modal-section-title">
              {t("pairing.currentAllowlist")} ({allowlist.length})
            </h3>

            {allowlist.length === 0 ? (
              <div className="modal-empty-state">
                {t("pairing.noAllowedUsers")}
              </div>
            ) : (
              <div className="modal-table-wrap">
                <table className="modal-table">
                  <thead>
                    <tr>
                      <th>
                        {t("pairing.userId")}
                      </th>
                      <th className="text-right">
                        {t("pairing.action")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allowlist.map((entry) => (
                      <tr key={entry}>
                        <td>
                          {entry}
                        </td>
                        <td className="text-right">
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => setRemoveConfirm(entry)}
                            disabled={processing === entry}
                          >
                            {processing === entry ? t("pairing.removing") : t("common.remove")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Close Button */}
        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            onClick={onClose}
          >
            {t("common.close")}
          </button>
        </div>
      </div>

      {/* Remove Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!removeConfirm}
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={confirmRemove}
        title={removeConfirm ? t("pairing.removeConfirmTitle", { entry: removeConfirm }) : ""}
        message={t("pairing.removeConfirmMessage")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
      />
    </Modal>
  );
}
