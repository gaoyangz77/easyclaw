import { useTranslation } from "react-i18next";
import { useQuery } from "@apollo/client/react";
import { GQL } from "@rivonclaw/core";
import { useAuth } from "../providers/AuthProvider.js";
import { SUBSCRIPTION_STATUS_QUERY } from "../api/auth-queries.js";
import { getUserInitial } from "../lib/user-manager.js";

export function AccountPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  const { data: subData } = useQuery<{
    subscriptionStatus: GQL.UserSubscription | null;
  }>(SUBSCRIPTION_STATUS_QUERY, { skip: !user });

  const subscription = subData?.subscriptionStatus;

  function handleLogout() {
    logout();
    onNavigate("/");
  }

  if (!user) {
    return (
      <div className="page-enter">
        <div className="section-card">
          <h2>{t("auth.loginRequired")}</h2>
          <p>{t("auth.loginFromSidebar")}</p>
        </div>
      </div>
    );
  }

  const initial = getUserInitial(user);
  const seatsUsed = subscription?.seatsUsed ?? 0;
  const seatsMax = subscription?.seatsMax ?? 1;
  const seatsPct = Math.round((seatsUsed / seatsMax) * 100);

  return (
    <div className="page-enter">
      <h1>{t("account.title")}</h1>
      <p className="page-description">{t("account.description")}</p>

      {/* ── Card 1: Profile ── */}
      <div className="section-card">
        <h3>{t("account.profile")}</h3>

        <div className="acct-profile-row">
          <div className="acct-avatar">{initial}</div>
          <div className="acct-profile-info">
            {user.name && <span className="acct-name">{user.name}</span>}
            <span className="acct-email">{user.email}</span>
            <span className="acct-member-since">
              {t("account.memberSince")}: {new Date(user.createdAt).toLocaleDateString()}
            </span>
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>
            {t("auth.logout")}
          </button>
        </div>
      </div>

      {/* ── Card 2: Subscription ── */}
      <div className="section-card">
        <h3>{t("account.subscription")}</h3>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label" style={{ cursor: "default" }}>
            <span>{t("account.plan")}</span>
            <span className="acct-badge acct-badge-plan">{subscription?.plan ?? user.plan}</span>
          </div>
        </div>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label" style={{ cursor: "default" }}>
            <span>{t("account.validUntil")}</span>
            <span>
              {subscription
                ? new Date(subscription.validUntil).toLocaleDateString()
                : "—"}
            </span>
          </div>
        </div>

        {/* Seats progress */}
        {subscription && (
          <div className="acct-seats">
            <div className="settings-toggle-label" style={{ cursor: "default" }}>
              <span>{t("account.seats")}</span>
              <span>{seatsUsed} / {seatsMax}</span>
            </div>
            <div className="acct-seats-track">
              <div className="acct-seats-fill" style={{ width: `${seatsPct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
