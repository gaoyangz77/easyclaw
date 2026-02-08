import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import { fetchPairingRequests, fetchAllowlist, approvePairing, removeFromAllowlist, type PairingRequest } from "../api.js";

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
  const { t } = useTranslation();

  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([]);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

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
      const result = await approvePairing(channelId, code);

      // Remove from pending requests
      setPairingRequests(prev => prev.filter(r => r.code !== code));

      // Add to allowlist
      setAllowlist(prev => [...prev, result.id]);
    } catch (err) {
      setError(`Failed to approve: ${String(err)}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleRemove(entry: string) {
    const confirmed = window.confirm(
      `Remove ${entry} from allowlist?\n\nThey will no longer be able to send messages.`
    );

    if (!confirmed) return;

    setProcessing(entry);
    setError(null);

    try {
      await removeFromAllowlist(channelId, entry);

      // Remove from allowlist
      setAllowlist(prev => prev.filter(e => e !== entry));
    } catch (err) {
      setError(`Failed to remove: ${String(err)}`);
    } finally {
      setProcessing(null);
    }
  }

  function formatTimeAgo(timestamp: string): string {
    const now = Date.now();
    const then = Date.parse(timestamp);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "just now";
    if (diffMins === 1) return "1m ago";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return "1h ago";
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "1d ago";
    return `${diffDays}d ago`;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t("pairing.modalTitle")} - ${channelLabel}`}
      maxWidth={700}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Loading State */}
        {loading && (
          <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
            {t("common.loading")}...
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div
            style={{
              padding: "12px",
              backgroundColor: "#ffebee",
              color: "#c62828",
              borderRadius: 4,
              fontSize: 13,
              borderLeft: "3px solid #f44336",
            }}
          >
            <strong>{t("channels.errorLabel")}</strong> {error}
          </div>
        )}

        {/* Pending Pairing Requests */}
        {!loading && (
          <div>
            <h3 style={{ margin: "0 0 12px 0", fontSize: 15, fontWeight: 600 }}>
              {t("pairing.pendingRequests")} ({pairingRequests.length})
            </h3>

            {pairingRequests.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#888", fontSize: 13, backgroundColor: "#f5f5f5", borderRadius: 4 }}>
                {t("pairing.noPendingRequests")}
              </div>
            ) : (
              <div style={{ border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f5f5f5", borderBottom: "1px solid #e0e0e0" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>
                        {t("pairing.code")}
                      </th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>
                        {t("pairing.userId")}
                      </th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>
                        {t("pairing.requestedAt")}
                      </th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#666" }}>
                        {t("pairing.action")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairingRequests.map((request) => (
                      <tr key={request.code} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <code style={{ fontSize: 13, fontWeight: 600, color: "#1976d2" }}>
                            {request.code}
                          </code>
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 13, color: "#333" }}>
                          {request.id}
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: "#666" }}>
                          {formatTimeAgo(request.createdAt)}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <button
                            className="btn btn-primary"
                            onClick={() => handleApprove(request.code)}
                            disabled={processing === request.code}
                            style={{ fontSize: 12, padding: "6px 12px" }}
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
            <h3 style={{ margin: "0 0 12px 0", fontSize: 15, fontWeight: 600 }}>
              {t("pairing.currentAllowlist")} ({allowlist.length})
            </h3>

            {allowlist.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#888", fontSize: 13, backgroundColor: "#f5f5f5", borderRadius: 4 }}>
                {t("pairing.noAllowedUsers")}
              </div>
            ) : (
              <div style={{ border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f5f5f5", borderBottom: "1px solid #e0e0e0" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>
                        {t("pairing.userId")}
                      </th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#666" }}>
                        {t("pairing.action")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allowlist.map((entry) => (
                      <tr key={entry} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "10px 12px", fontSize: 13, color: "#333" }}>
                          {entry}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <button
                            className="btn btn-danger"
                            onClick={() => handleRemove(entry)}
                            disabled={processing === entry}
                            style={{ fontSize: 12, padding: "6px 12px" }}
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
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: "8px 16px", fontSize: 14 }}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
