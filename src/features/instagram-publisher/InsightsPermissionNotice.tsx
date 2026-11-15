import { ChevronDown, Info, ArrowUpRight } from "lucide-react";
import type { AnalyticsReport } from "./useInstagramAnalytics";

export function InsightsPermissionNotice({ report, accounts }: {
  report?: AnalyticsReport;
  accounts: { id: string; username: string }[];
}) {
  const blocked = report?.accounts.filter((account) => account.insights_error === "permission_required") ?? [];
  if (!blocked.length) return null;
  const names = blocked.map((account) =>
    accounts.find((item) => item.id === account.account_id)?.username
  ).filter((name): name is string => !!name);
  return (
    <details className="group my-3 rounded-xl border border-white/10 bg-white/[0.025] text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Info className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span className="flex-1">Métricas parciais <span className="ml-1 opacity-60">· {blocked.length} {blocked.length === 1 ? "conta" : "contas"}</span></span>
        <span className="sr-only">Ver detalhes da conexão</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-2 border-t border-white/5 px-3 py-3 leading-relaxed">
        <p>Algumas contas precisam renovar o acesso às visualizações. As curtidas disponíveis continuam aparecendo.</p>
        {names.length > 0 && <p className="break-words text-foreground/70">{names.map((name) => `@${name.replace(/^@/, "")}`).join(", ")}</p>}
        <a className="inline-flex items-center gap-1 text-foreground/80 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/avanca/conectar">
          Revisar conexão <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </details>
  );
}
