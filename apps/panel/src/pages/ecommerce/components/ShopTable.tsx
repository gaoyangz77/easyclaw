import { useTranslation } from "react-i18next";
import type { Shop } from "@rivonclaw/core/models";
import { formatBalanceDisplay, getAuthStatusBadgeClass } from "../ecommerce-utils.js";
import { BalanceBadge } from "./BalanceBadge.js";

interface ShopTableProps {
  shops: Shop[];
  oauthLoading: boolean;
  oauthWaiting: boolean;
  onOpenDrawer: (shopId: string) => void;
  onReauthorize: (shopId: string) => void;
  onRequestDelete: (shopId: string) => void;
}

export function ShopTable({ shops, oauthLoading, oauthWaiting, onOpenDrawer, onReauthorize, onRequestDelete }: ShopTableProps) {
  const { t } = useTranslation();

  if (shops.length === 0) {
    return (
      <div className="section-card">
        <div className="empty-cell">{t("ecommerce.noShops")}</div>
      </div>
    );
  }

  return (
    <div className="section-card">
      <table className="shop-table">
        <thead>
          <tr>
            <th>{t("ecommerce.table.headers.name")}</th>
            <th>{t("ecommerce.table.headers.platform")}</th>
            <th>{t("ecommerce.table.headers.region")}</th>
            <th>{t("ecommerce.table.headers.authStatus")}</th>
            <th>{t("ecommerce.table.headers.csBalance")}</th>
            <th className="text-right">{t("ecommerce.table.headers.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {shops.map((shop) => {
            const billing = shop.services?.customerServiceBilling;
            return (
              <tr key={shop.id}>
                <td>
                  <span className="shop-table-name">{shop.shopName}</span>
                </td>
                <td>{shop.platform === "TIKTOK_SHOP" ? "TikTok" : shop.platform}</td>
                <td>{shop.region}</td>
                <td>
                  <span className={getAuthStatusBadgeClass(shop.authStatus)}>
                    {t(`tiktokShops.authStatus_${shop.authStatus}`)}
                  </span>
                </td>
                <td>
                  <span className="shop-balance-cell">
                    {billing
                      ? formatBalanceDisplay(billing.balance, billing.tier, t)
                      : "\u2014"}
                    <BalanceBadge shop={shop} />
                  </span>
                </td>
                <td className="text-right">
                  <div className="td-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onOpenDrawer(shop.id)}
                    >
                      {t("ecommerce.view")}
                    </button>
                    {shop.authStatus === "TOKEN_EXPIRED" && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onReauthorize(shop.id)}
                        disabled={oauthLoading || oauthWaiting}
                      >
                        {t("ecommerce.reauthorize")}
                      </button>
                    )}
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => onRequestDelete(shop.id)}
                    >
                      {t("ecommerce.disconnect")}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
