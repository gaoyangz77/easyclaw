import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
import { useRuntimeStatus } from "../../store/RuntimeStatusProvider.js";
import { observer } from "mobx-react-lite";
import { Modal } from "./Modal.js";

const DEFAULT_TTL_MS = 60_000;

interface MobileBindingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onBindingSuccess: () => void;
}

export const MobileBindingModal = observer(function MobileBindingModal({ isOpen, onClose, onBindingSuccess }: MobileBindingModalProps) {
    const { t } = useTranslation();
    const entityStore = useEntityStore();
    const runtimeStatus = useRuntimeStatus();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [existingCount, setExistingCount] = useState(0);
    const privacyMode = runtimeStatus.appSettings.privacyMode;
    const [qrRevealed, setQrRevealed] = useState(false);
    const [expired, setExpired] = useState(false);
    const [remainingSeconds, setRemainingSeconds] = useState(0);

    const pollAbortRef = useRef(false);
    const baseCountRef = useRef(0);
    const expiryTimerRef = useRef<number | null>(null);
    const countdownRef = useRef<number | null>(null);
    const onBindingSuccessRef = useRef(onBindingSuccess);
    onBindingSuccessRef.current = onBindingSuccess;
    const desktopDeviceIdRef = useRef<string | null>(null);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setQrRevealed(false);
            setError(null);
            setPairingCode(null);
            setQrDataUrl(null);
            setExpired(false);
        }
    }, [isOpen]);

    const clearTimers = useCallback(() => {
        if (expiryTimerRef.current) { clearTimeout(expiryTimerRef.current); expiryTimerRef.current = null; }
        if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    }, []);

    const generateCode = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            setExpired(false);
            clearTimers();
            pollAbortRef.current = true; // cancel any in-flight waitForPairing

            const deviceId = desktopDeviceIdRef.current;
            if (!deviceId) {
                setError("Desktop device ID not available");
                return;
            }

            const res = await entityStore.generateMobilePairingCode(deviceId);
            setPairingCode(res.code || null);

            if (res.code) {
                const qrContent = res.qrUrl!;
                const qrData = await QRCode.toDataURL(qrContent, {
                    margin: 1,
                    width: 250,
                    color: { dark: "#000000FF", light: "#FFFFFFFF" }
                });
                setQrDataUrl(qrData);

                const ttl = DEFAULT_TTL_MS;
                const ttlSeconds = Math.round(ttl / 1000);
                setRemainingSeconds(ttlSeconds);
                countdownRef.current = window.setInterval(() => {
                    setRemainingSeconds(prev => {
                        if (prev <= 1) {
                            if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
                expiryTimerRef.current = window.setTimeout(() => {
                    setExpired(true);
                    pollAbortRef.current = true; // stop long-poll on expiry
                }, ttl);

                // Start cloud long-poll for pairing completion
                pollAbortRef.current = false;
                const code = res.code;
                (async () => {
                    while (!pollAbortRef.current) {
                        try {
                            const result = await entityStore.waitForPairing(code);
                            if (pollAbortRef.current) break;
                            if (result.paired && result.accessToken && result.relayUrl) {
                                // Push the result to desktop for local side-effects
                                await entityStore.registerMobilePairing({
                                    pairingId: result.pairingId,
                                    desktopDeviceId: result.desktopDeviceId || deviceId,
                                    accessToken: result.accessToken,
                                    relayUrl: result.relayUrl,
                                    mobileDeviceId: result.mobileDeviceId,
                                });
                                if (!pollAbortRef.current) {
                                    onBindingSuccessRef.current();
                                }
                                break;
                            }
                            // If not paired and no reason (timeout), retry
                            if (result.reason) break; // e.g. "expired"
                        } catch {
                            // Network error — stop polling
                            break;
                        }
                    }
                })();
            } else {
                setQrDataUrl(null);
            }
        } catch (err: any) {
            setError(t("mobile.generationFailed", { error: err.message || "Unknown error" }));
        } finally {
            setLoading(false);
        }
    }, [t, clearTimers]);

    const generateCodeRef = useRef(generateCode);
    generateCodeRef.current = generateCode;

    // Fetch desktopDeviceId and generate pairing code when modal opens
    useEffect(() => {
        if (!isOpen) {
            pollAbortRef.current = true;
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const res = await entityStore.mobileManager.getStatus();
                const count = res.pairings?.length ?? 0;
                if (!cancelled) {
                    setExistingCount(count);
                    baseCountRef.current = count;
                    desktopDeviceIdRef.current = res.desktopDeviceId || null;
                }
            } catch { /* ignore */ }
            if (!cancelled) await generateCodeRef.current();
        })();

        return () => {
            cancelled = true;
            pollAbortRef.current = true;
            clearTimers();
        };
    }, [isOpen, clearTimers]);

    const showBlur = privacyMode && !qrRevealed;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t("mobile.pairTitle")}
            maxWidth={420}
        >
            <div className="modal-form-col">
                {error && <div className="modal-error-box">{error}</div>}

                <div className="mobile-pairing-modal-body">
                    <div className="mobile-pairing-view">
                        {loading && !pairingCode ? (
                            <p>{t("common.loading")}</p>
                        ) : (
                            <>
                                {existingCount > 0 && (
                                    <p className="mobile-existing-hint">
                                        {t("mobile.existingPairings", { count: existingCount })}
                                    </p>
                                )}

                                {expired
                                    ? <div className="status-badge badge-danger">{t("mobile.codeExpired")}</div>
                                    : <div className="status-badge badge-warning">{t("mobile.waitingForConnection")}</div>
                                }
                                <p className="mobile-scan-hint">
                                    {expired ? t("mobile.codeExpiredHint") : t("mobile.pairHint")}
                                </p>

                                {qrDataUrl && (
                                    <div
                                        className={`mobile-qr-container${showBlur ? " qr-privacy-blur" : ""}${expired ? " qr-expired" : ""}`}
                                        onClick={showBlur ? () => setQrRevealed(true) : expired ? () => generateCode() : undefined}
                                    >
                                        <img src={qrDataUrl} alt="Pairing QR Code" width={250} height={250} />
                                        {showBlur && (
                                            <div className="qr-privacy-overlay">
                                                {t("settings.app.clickToReveal")}
                                            </div>
                                        )}
                                        {expired && !showBlur && (
                                            <div className="qr-expired-overlay">
                                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                                    <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                                                </svg>
                                                <span>{t("mobile.clickToRefresh")}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {!expired && !showBlur && (
                                    <p className="mobile-countdown">{t("mobile.expiresIn", { seconds: remainingSeconds })}</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
});
