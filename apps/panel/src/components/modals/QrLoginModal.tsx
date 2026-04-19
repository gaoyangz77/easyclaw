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

  // Per-invocation abort token: each startLogin call owns its own token + AbortController.
  // A re-entrant startLogin (StrictMode double-mount, effect re-fire due to dep change)
  // aborts the OLD token's in-flight fetches first, then creates a fresh token.
  // This prevents two concurrent loops from both firing web.login.wait and leaving
  // a ghost long-poll blocking the browser connection slot.
  type LoginToken = { aborted: boolean; controller: AbortController };
  const activeTokenRef = useRef<LoginToken | null>(null);
  // Once a scan succeeds, prevent any subsequent re-entry from spawning a new loop.
  const completedRef = useRef(false);
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
    // Once a scan succeeded, ignore any re-entry (setPhase("success") + 1200ms
    // close sequence; parent may re-render and re-fire this effect).
    if (completedRef.current) return;

    // Abort any in-flight predecessor (StrictMode double-mount, dep change)
    // before taking over. The abort cancels both the `while` loop (via
    // token.aborted) and any fetch currently awaiting on the network
    // (via controller.abort()).
    const prior = activeTokenRef.current;
    if (prior && !prior.aborted) {
      prior.aborted = true;
      prior.controller.abort();
    }

    const myToken: LoginToken = { aborted: false, controller: new AbortController() };
    activeTokenRef.current = myToken;
    const signal = myToken.controller.signal;

    setPhase("loading");
    setErrorMessage(null);
    setQrImageUrl(null);
    clearCountdown();

    try {
      const deadline = Date.now() + SESSION_TIMEOUT_MS;
      let currentQrUrl: string | null = null;

      while (!myToken.aborted && Date.now() < deadline) {
        // Step 1: Get a (possibly fresh) QR code
        let startRes: Awaited<ReturnType<typeof startQrLogin>>;
        try {
          startRes = await startQrLogin(undefined, signal);
        } catch (e: any) {
          if (myToken.aborted || e?.name === "AbortError") return;
          throw e;
        }
        if (myToken.aborted) return;

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
          if (myToken.aborted) return;
          setQrImageUrl(qrData);
          setPhase("scanning");
          resetCountdown();
        }

        // Step 3: Poll for scan result (single /wait call per iteration)
        try {
          const result = await waitQrLogin(undefined, POLL_TIMEOUT_MS, signal);
          if (myToken.aborted) break;

          if (result.connected) {
            // Mark completed BEFORE any async side-effects so a re-render
            // triggered by updateAccount's MST patch can't spawn a new loop.
            completedRef.current = true;
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
              if (!myToken.aborted) {
                onSuccessRef.current();
                onCloseRef.current();
              }
            }, 1200);
            return;
          }
        } catch (e: any) {
          if (myToken.aborted || e?.name === "AbortError") return;
          // Poll timeout or transient error -- continue to next /start cycle
        }

        // Show refreshing state briefly before looping back to /start
        if (!myToken.aborted && Date.now() < deadline) {
          setPhase("refreshing");
        }
        // Loop back: /start will create a fresh QR since /wait deleted the session
      }

      // Session timed out -- QR expired
      if (!myToken.aborted) {
        clearCountdown();
        setErrorMessage(t("qrLogin.expired"));
        setPhase("error");
      }
    } catch (err: any) {
      if (!myToken.aborted) {
        clearCountdown();
        setErrorMessage(err.message || t("qrLogin.failed"));
        setPhase("error");
      }
    } finally {
      // Only clear the activeTokenRef if it still points at our token
      // (a newer invocation may have already replaced it).
      if (activeTokenRef.current === myToken) activeTokenRef.current = null;
    }
  }, [t, channelId, entityStore, clearCountdown, resetCountdown]);

  useEffect(() => {
    startLogin();
    return () => {
      const tok = activeTokenRef.current;
      if (tok && !tok.aborted) {
        tok.aborted = true;
        tok.controller.abort();
      }
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
