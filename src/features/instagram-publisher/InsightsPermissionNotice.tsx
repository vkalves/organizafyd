import type { AnalyticsReport } from "./useInstagramAnalytics";
export function InsightsPermissionNotice({ report, accounts }: {
  report?: AnalyticsReport;
  accounts: { id: string; username: string }[];
}) {
  const blocked =
    report?.accounts.filter((account) =>
      account.insights_error === "permission_required"
    ) ?? [];
  if (!blocked.length) return null;
  const names = blocked.map((account) =>
    accounts.find((item) => item.id === account.account_id)?.username
  ).filter((name): name is string => !!name);
  return (
    <aside
      role="status"
      className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm space-y-2"
    >
      <p>
        A Meta não autorizou a consulta de visualizações de {blocked.length}
        {" "}
        conta(s). As curtidas disponíveis continuam aparecendo.
      </p>
      {names.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            Ver contas que precisam renovar a autorização
          </summary>
          <p className="mt-2 break-words">
            {names.map((name) => `@${name.replace(/^@/, "")}`).join(", ")}
          </p>
        </details>
      )}
      <a className="underline" href="/avanca/conectar">
        Reconectar as contas e autorizar o acesso às métricas
      </a>
    </aside>
  );
}
