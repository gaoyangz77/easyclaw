import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Shop } from "@rivonclaw/core/models";
import { isBalanceLow, isBalanceExpiringSoon, isBalanceExpired } from "../ecommerce-utils.js";

export function BalanceBadge({ shop }: { shop: Shop }): JSX.Element | null {
  const { t } = useTranslation();
  const billing = shop.services?.customerServiceBilling;
  if (!billing) return null;

  if (billing.balance === 0) {
    return <span className="badge badge-danger">{t("tiktokShops.balance.none")}</span>;
  }
  if (isBalanceExpired(billing.balanceExpiresAt)) {
    return <span className="badge badge-danger">{t("tiktokShops.balance.expired")}</span>;
  }
  if (isBalanceLow(billing.balance)) {
    return <span className="badge badge-warning">{t("tiktokShops.balance.low")}</span>;
  }
  if (isBalanceExpiringSoon(billing.balanceExpiresAt)) {
    return (
      <span className="badge badge-warning">
        {t("tiktokShops.balance.expiring", {
          date: new Date(billing.balanceExpiresAt!).toLocaleDateString(),
        })}
      </span>
    );
  }
  return null;
}
