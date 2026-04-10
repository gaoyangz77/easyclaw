/** OAuth authorization timeout in milliseconds (5 minutes). */
export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Balance threshold below which we show a "low balance" warning. */
export const LOW_BALANCE_THRESHOLD = 50;

/** Days before expiry to show a "balance expiring" warning. */
export const EXPIRY_WARNING_DAYS = 2;

export function isBalanceLow(balance: number): boolean {
  return balance > 0 && balance < LOW_BALANCE_THRESHOLD;
}

export function isBalanceExpiringSoon(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return diff > 0 && diff < EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
}

export function isBalanceExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

export function hasUpgradeRequired(err: unknown): boolean {
  if (err && typeof err === "object" && "graphQLErrors" in err) {
    const gqlErrors = (err as { graphQLErrors: Array<{ extensions?: { upgradeRequired?: boolean } }> }).graphQLErrors;
    return gqlErrors?.some((e) => e.extensions?.upgradeRequired === true) ?? false;
  }
  return false;
}

export function formatBalanceDisplay(
  balance: number | undefined | null,
  tier: string | undefined | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (balance === undefined || balance === null) return "\u2014";
  if (tier) return t("tiktokShops.balance.of", { balance, tier: t(`tiktokShops.tier.${tier}`, { defaultValue: tier }) });
  return t("tiktokShops.balance.remaining", { balance });
}

export function getAuthStatusBadgeClass(status: string): string {
  switch (status) {
    case "AUTHORIZED":
      return "badge badge-active";
    case "TOKEN_EXPIRED":
      return "badge badge-warning";
    case "REVOKED":
    case "PENDING_AUTH":
      return "badge badge-danger";
    case "DISCONNECTED":
      return "badge badge-muted";
    default:
      return "badge badge-muted";
  }
}
