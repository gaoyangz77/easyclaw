import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../components/modals/Modal.js";
import { Select } from "../../../components/inputs/Select.js";
import { CopyIcon, CheckIcon, InfoIcon } from "../../../components/icons.js";
import type { PlatformApp } from "@rivonclaw/core/models";

interface ConnectShopModalProps {
  isOpen: boolean;
  onClose: () => void;
  platformApps: PlatformApp[];
  oauthLoading: boolean;
  oauthWaiting: boolean;
  oauthAuthUrl: string | null;
  linkCopied: boolean;
  onConnectShop: (platformAppId: string) => void;
  onCopyAuthUrl: () => void;
  onCancelOAuth: () => void;
}

export function ConnectShopModal({
  isOpen,
  onClose,
  platformApps,
  oauthLoading,
  oauthWaiting,
  oauthAuthUrl,
  linkCopied,
  onConnectShop,
  onCopyAuthUrl,
  onCancelOAuth,
}: ConnectShopModalProps) {
  const { t } = useTranslation();

  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");
  const prevOpenRef = useRef(false);

  // Auto-select first available market and platform when modal opens
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      const markets = [...new Set(platformApps.map((app) => app.market))];
      const firstMarket = markets.length > 0 ? markets[0] : "";
      setSelectedMarket(firstMarket);
      if (firstMarket) {
        const appsForMarket = platformApps.filter((app) => app.market === firstMarket);
        const platforms = [...new Set(appsForMarket.map((app) => app.platform))];
        setSelectedPlatform(platforms.length > 0 ? platforms[0] : "");
      } else {
        setSelectedPlatform("");
      }
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, platformApps]);

  const availableMarkets = useMemo(
    () => [...new Set(platformApps.map((app) => app.market))],
    [platformApps],
  );

  const matchingAppsForMarket = useMemo(() => {
    if (!selectedMarket) return [];
    return platformApps.filter((app) => app.market === selectedMarket);
  }, [platformApps, selectedMarket]);

  const availablePlatforms = useMemo(
    () => [...new Set(matchingAppsForMarket.map((app) => app.platform))],
    [matchingAppsForMarket],
  );

  const matchedApps = useMemo(() => {
    if (!selectedMarket || !selectedPlatform) return [];
    return platformApps.filter(
      (app) => app.market === selectedMarket && app.platform === selectedPlatform,
    );
  }, [platformApps, selectedMarket, selectedPlatform]);

  const selectedPlatformAppId = matchedApps.length === 1 ? matchedApps[0].id : "";

  const matchError = useMemo(() => {
    if (!selectedMarket || !selectedPlatform) return null;
    if (matchedApps.length === 0) return t("ecommerce.addShopModal.noMatch");
    if (matchedApps.length > 1) return t("ecommerce.addShopModal.multipleMatch");
    return null;
  }, [selectedMarket, selectedPlatform, matchedApps, t]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (oauthWaiting) {
          onCancelOAuth();
        }
        onClose();
      }}
      title={t("ecommerce.addShopModal.title")}
      preventBackdropClose={oauthWaiting}
    >
      <div className="modal-form-col">
        {!oauthWaiting ? (
          <>
            <div>
              <label className="form-label-block">
                {t("ecommerce.addShopModal.marketLabel")}
              </label>
              {platformApps.length === 0 ? (
                <div className="form-hint">{t("tiktokShops.noPlatformApps")}</div>
              ) : (
                <Select
                  value={selectedMarket}
                  onChange={(v) => {
                    setSelectedMarket(v);
                    setSelectedPlatform("");
                  }}
                  className="input-full"
                  placeholder={t("ecommerce.addShopModal.marketPlaceholder")}
                  options={availableMarkets.map((market) => ({
                    value: market,
                    label: t(`ecommerce.market.${market}`, { defaultValue: market }),
                  }))}
                />
              )}
            </div>
            <div>
              <label className="form-label-block">
                {t("ecommerce.addShopModal.platformLabel")}
              </label>
              <Select
                value={selectedPlatform}
                onChange={(v) => setSelectedPlatform(v)}
                className="input-full"
                placeholder={t("ecommerce.addShopModal.platformPlaceholder")}
                disabled={!selectedMarket}
                options={availablePlatforms.map((platform) => ({
                  value: platform,
                  label: t(`ecommerce.platform.${platform}`, { defaultValue: platform }),
                }))}
              />
            </div>
            {matchError && (
              <div className="form-hint form-hint-error">{matchError}</div>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={onClose}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => onConnectShop(selectedPlatformAppId)}
                disabled={oauthLoading || !selectedPlatformAppId}
              >
                {oauthLoading ? t("common.loading") : t("ecommerce.addShopModal.addButton")}
              </button>
            </div>
          </>
        ) : (
          <div className="oauth-flow">
            <div className="oauth-flow-step">
              <span className="oauth-flow-step-num">1</span>
              <span className="oauth-flow-step-text">{t("ecommerce.addShopModal.authLink")}</span>
            </div>
            <div className="auth-link-box">
              <div className="auth-link-url-row">
                <div className="auth-link-url">{oauthAuthUrl}</div>
                <button
                  className={`auth-link-copy-btn${linkCopied ? " auth-link-copy-btn-success" : ""}`}
                  onClick={onCopyAuthUrl}
                >
                  {linkCopied ? <CheckIcon /> : <CopyIcon />}
                  {linkCopied
                    ? t("ecommerce.addShopModal.copySuccess")
                    : t("ecommerce.addShopModal.copyButton")}
                </button>
              </div>
            </div>
            <div className="auth-link-hint">
              <InfoIcon />
              <span>{t("ecommerce.addShopModal.tooltip")}</span>
            </div>

            <div className="oauth-flow-step">
              <span className="oauth-flow-step-num">2</span>
              <span className="oauth-flow-step-text">{t("ecommerce.addShopModal.waitingAuth")}</span>
            </div>
            <div className="oauth-waiting-indicator">
              <span className="oauth-waiting-spinner" />
              <span className="oauth-waiting-text">{t("ecommerce.addShopModal.waitingAuth")}</span>
            </div>

            <div className="oauth-flow-actions">
              <button
                className="btn btn-secondary"
                onClick={onCancelOAuth}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
