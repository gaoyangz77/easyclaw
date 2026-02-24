import { formatCost, formatTokens, type ProviderGroup } from "./usage-utils.js";

export function UsageTable({
  grouped, isCN, t,
}: {
  grouped: ProviderGroup[];
  isCN: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="usage-blocks">
      {grouped.flatMap((pg) =>
        pg.keys.map((kg) => (
          <div key={kg.keyId} className="usage-key-block">
            <div className="usage-key-header">
              <span className="usage-key-provider">{pg.provider}</span>
              <span className="usage-key-label">{kg.keyLabel}</span>
              {kg.authType !== "oauth" && (
                <span className="usage-key-cost">
                  {formatCost(kg.totalCost, kg.currency, isCN)}
                </span>
              )}
            </div>
            <table className="usage-inner-table">
              <thead>
                <tr>
                  <th>{t("keyUsage.model")}</th>
                  <th>{t("keyUsage.inputTokens")}</th>
                  <th>{t("keyUsage.outputTokens")}</th>
                  <th>{t("keyUsage.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {kg.models.map((mr) => (
                  <tr key={mr.row.model} className="table-hover-row">
                    <td className="usage-model-name">
                      {mr.row.model}
                      {mr.isActive && (
                        <>
                          {" "}
                          <span className="badge badge-active">{t("keyUsage.active")}</span>
                        </>
                      )}
                    </td>
                    <td className="usage-token-cell">{formatTokens(mr.row.inputTokens)}</td>
                    <td className="usage-token-cell">{formatTokens(mr.row.outputTokens)}</td>
                    <td className="usage-token-cell">
                      {kg.authType === "oauth"
                        ? "-"
                        : formatCost(mr.cost.amount, mr.cost.currency, isCN)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )),
      )}
    </div>
  );
}
