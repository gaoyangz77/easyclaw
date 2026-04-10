import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { startQrLogin, waitQrLogin } from "../../api/channels.js";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
import { Modal } from "./Modal.js";

type QrLoginPhase = "loading" | "scanning" | "refreshing" | "success" | "error";

/** Per-poll server-side timeout. The desktop route sets RPC timeout = this + 15s headroom. */
const POLL_TIMEOUT_MS = 30_000;
/** Total QR session lifetime. Keep short to avoid excessive WeChat API polling. */
const SESSION_TIMEOUT_MS = 2 * 60_000;
/** Countdown display duration matching poll timeout. */
const QR_REFRESH_SECONDS = 30;

interface QrLoginModalProps {
  channelId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function QrLoginModal({ channelId, onClose, onSuccess }: QrLoginModalProps) {
  const { t } = useTranslation();
  const entityStore = useEntityStore();

  const [phase, setPhase] = useState<QrLoginPhase>("loading");
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(QR_REFRESH_SECONDS);

  const abortRef = useRef(false);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearCountdown = useCallback(() => {
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const resetCountdown = useCallback(() => {
    clearCountdown();
    setCountdown(QR_REFRESH_SECONDS);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  }, [clearCountdown]);

  const startLogin = useCallback(async () => {
    abortRef.current = false;
    setPhase("loading");
    setErrorMessage(null);
    setQrImageUrl(null);
    clearCountdown();

    try {
      const deadline = Date.now() + SESSION_TIMEOUT_MS;
      let currentQrUrl: string | null = null;

      while (!abortRef.current && Date.now() < deadline) {
        // Step 1: Get a (possibly fresh) QR code
        const startRes = await startQrLogin();
        if (abortRef.current) return;

        if (!startRes.qrDataUrl) {
          setErrorMessage(startRes.message || t("qrLogin.gatewayUnavailable"));
          setPhase("error");
          return;
        }

        // Step 2: Update QR image if the URL changed
        if (startRes.qrDataUrl !== currentQrUrl) {
          currentQrUrl = startRes.qrDataUrl;
          const qrData = await QRCode.toDataURL(currentQrUrl, {
            margin: 1,
            width: 250,
            color: { dark: "#000000FF", light: "#FFFFFFFF" },
          });
          if (abortRef.current) return;
          setQrImageUrl(qrData);
          setPhase("scanning");
          resetCountdown();
        }

        // Step 3: Poll for scan result (single /wait call per iteration)
        try {
          const result = await waitQrLogin(undefined, POLL_TIMEOUT_MS);
          if (abortRef.current) break;

          if (result.connected) {
            clearCountdown();
            // Set accountId as initial display name so the row isn't blank
            if (result.accountId) {
              entityStore.channelManager.updateAccount(channelId, result.accountId, {
                name: result.accountId,
                config: {},
              }).catch(() => { /* best-effort */ });
            }
            setPhase("success");
            // Brief delay so user sees the success message
            setTimeout(() => {
              if (!abortRef.current) {
                onSuccessRef.current();
                onCloseRef.current();
              }
            }, 1200);
            return;
          }
        } catch {
          // Poll timeout or transient error -- continue to next /start cycle
        }

        // Show refreshing state briefly before looping back to /start
        if (!abortRef.current && Date.now() < deadline) {
          setPhase("refreshing");
        }
        // Loop back: /start will create a fresh QR since /wait deleted the session
      }

      // Session timed out -- QR expired
      if (!abortRef.current) {
        clearCountdown();
        setErrorMessage(t("qrLogin.expired"));
        setPhase("error");
      }
    } catch (err: any) {
      if (!abortRef.current) {
        clearCountdown();
        setErrorMessage(err.message || t("qrLogin.failed"));
        setPhase("error");
      }
    }
  }, [t, channelId, entityStore, clearCountdown, resetCountdown]);

  useEffect(() => {
    startLogin();
    return () => {
      abortRef.current = true;
      clearCountdown();
    };
  }, [startLogin, clearCountdown]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("qrLogin.title")}
      maxWidth={420}
    >
      <div className="modal-form-col">
        {errorMessage && <div className="modal-error-box">{errorMessage}</div>}

        <div className="qr-login-body">
          {phase === "loading" && (
            <p className="centered-muted">{t("qrLogin.generating")}</p>
          )}

          {(phase === "scanning" || phase === "refreshing") && qrImageUrl && (
            <div className="qr-login-scan-view">
              <div className="badge badge-warning">{t("qrLogin.waiting")}</div>
              <p className="qr-login-hint">{t("qrLogin.scanPrompt")}</p>
              <div className="mobile-qr-container">
                <img src={qrImageUrl} alt="WeChat QR Code" width={250} height={250} />
              </div>
              <p className="qr-login-countdown">
                {phase === "refreshing"
                  ? t("qrLogin.refreshing")
                  : t("qrLogin.autoRefresh", { seconds: countdown })}
              </p>
            </div>
          )}

          {phase === "success" && (
            <div className="qr-login-scan-view">
              <div className="badge badge-success">{t("qrLogin.success")}</div>
            </div>
          )}

          {phase === "error" && (
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={startLogin}>
                {t("qrLogin.retry")}
              </button>
              <button className="btn btn-secondary" onClick={onClose}>
                {t("common.close")}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
