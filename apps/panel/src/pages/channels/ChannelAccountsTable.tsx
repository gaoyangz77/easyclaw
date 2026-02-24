import type { ChannelAccountSnapshot } from "../../api/index.js";
import { StatusBadge, type AccountEntry } from "./channel-defs.jsx";

export function ChannelAccountsTable({
  allAccounts,
  deletingKey,
  t,
  onEdit,
  onManageAllowlist,
  onDelete,
}: {
  allAccounts: AccountEntry[];
  deletingKey: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onEdit: (channelId: string, account: ChannelAccountSnapshot) => void;
  onManageAllowlist: (channelId: string) => void;
  onDelete: (channelId: string, accountId: string) => void;
}) {
  return (
    <div className="section-card">
      <h3>{t("channels.allAccounts")}</h3>
      <div className="table-scroll-wrap">
        <table className="channel-table">
          <thead>
            <tr>
              <th>{t("channels.colChannel")}</th>
              <th>{t("channels.colName")}</th>
              <th>{t("channels.statusConfigured")}</th>
              <th>{t("channels.statusRunning")}</th>
              <th>{t("channels.colDmPolicy")}</th>
              <th>{t("channels.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {allAccounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-cell">
                  {t("channels.noAccountsConfigured")}
                </td>
              </tr>
            ) : (
              allAccounts.map(({ channelId, channelLabel, account, isWecom }) => {
                const rowKey = `${channelId}-${account.accountId}`;
                const isDeleting = deletingKey === rowKey;
                return (
                  <tr key={rowKey} className={`table-hover-row${isDeleting ? " row-deleting" : ""}`}>
                    <td className="font-medium">{channelLabel}</td>
                    <td>{account.name || "\u2014"}</td>
                    <td><StatusBadge status={account.configured} t={t} /></td>
                    <td><StatusBadge status={account.running} t={t} /></td>
                    <td>{account.dmPolicy ? t(`channels.dmPolicyLabel_${account.dmPolicy}`, { defaultValue: account.dmPolicy }) : "\u2014"}</td>
                    <td>
                      <div className="td-actions">
                        {isWecom ? (
                          <>
                            <button className="btn btn-secondary btn-invisible" disabled aria-hidden="true">{t("common.edit")}</button>
                            <button className="btn btn-secondary btn-invisible" disabled aria-hidden="true">{t("pairing.allowlist")}</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn btn-secondary"
                              onClick={() => onEdit(channelId, account)}
                              disabled={isDeleting}
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={() => onManageAllowlist(channelId)}
                              title={t("pairing.manageAllowlist")}
                              disabled={isDeleting}
                            >
                              {t("pairing.allowlist")}
                            </button>
                          </>
                        )}
                        <button
                          className="btn btn-danger"
                          onClick={() => onDelete(channelId, account.accountId)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? t("channels.deleting") : t("common.delete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
