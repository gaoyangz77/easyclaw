import { useTranslation } from "react-i18next";
import type { Shop } from "@rivonclaw/core/models";
import { isBalanceLow, isBalanceExpiringSoon } from "../tiktok-shops-utils.js";

interface TikTokShopSessionsTabProps {
  shop: Shop;
}

/**
 * Per-shop CS balance view.
 *
 * Historical note: this tab previously also showed `activeSessions` and
 * `totalSessions` counters sourced from the `csSessionStats` GraphQL query.
 * Those counters were derived from `cs_sessions` document writes and disappeared
 * when CS BI data moved to the ClickHouse event stream — volume / throughput
 * dashboards now live in Grafana, not per-shop in the panel. The remaining
 * balance display comes straight off the Shop entity
 * (`shop.services.customerServiceBilling`), which is kept in MST sync via SSE.
 */
export function TikTokShopSessionsTab({ shop }: TikTokShopSessionsTabProps) {
  const { t } = useTranslation();

  const billing = shop.services?.customerServiceBilling;
  if (!billing) {
    return (
      <div className="shop-detail-section">
        <div className="empty-cell">{t("tiktokShops.modal.sessions.noData")}</div>
      </div>
    );
  }

  const balance = billing.balance ?? 0;
  const balanceExpiresAt = billing.balanceExpiresAt;

  return (
    <div className="shop-detail-section">
      <div className="shop-detail-grid">
        <div className="shop-detail-field">
          <span className="form-label-block">{t("tiktokShops.modal.sessions.balance")}</span>
          <span className="shop-balance-cell">
            {balance}
            {balance === 0 && (
              <span className="badge badge-danger">{t("tiktokShops.balance.none")}</span>
            )}
            {isBalanceLow(balance) && (
              <span className="badge badge-warning">{t("tiktokShops.balance.low")}</span>
            )}
          </span>
        </div>
        {balanceExpiresAt && (
          <div className="shop-detail-field">
            <span className="form-label-block">{t("tiktokShops.detail.balanceExpiry")}</span>
            <span>
              {new Date(balanceExpiresAt).toLocaleDateString()}
              {isBalanceExpiringSoon(balanceExpiresAt) && (
                <span className="badge badge-warning shop-badge-inline">
                  {t("tiktokShops.balance.expiring", {
                    date: new Date(balanceExpiresAt).toLocaleDateString(),
                  })}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
