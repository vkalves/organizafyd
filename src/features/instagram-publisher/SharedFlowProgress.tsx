import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { publisherRequest } from "./api";
import type { SharedFlowProgress as Progress } from "../../../supabase/functions/instagram-publisher/shared-flow-progress";

const labels: Record<string, string> = {
  active: "Ativo", paused: "Pausado", stopped: "Cancelado", completed: "Concluído",
  scheduled: "Na fila", processing: "Publicando", published: "Publicado",
  failed: "Falhou", uncertain: "Precisa de revisão", cancelled: "Cancelado",
};
function date(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function SharedFlowProgress({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ["ig-shared-flow-progress", userId],
    queryFn: () => publisherRequest<Progress[]>("shared_flow_progress"),
    refetchInterval: 30000,
  });
  return <section className="operation-panel ig-panel space-y-3" aria-label="Acompanhamento de fluxos compartilhados">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Fluxos compartilhados comigo</h2>
      <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Atualizar acompanhamento</Button>
    </div>
    <p className="text-xs text-muted-foreground">Acompanhe suas contas no fluxo original. Atualização automática a cada 30 segundos.</p>
    {query.isLoading && <p role="status" className="text-sm">Carregando acompanhamento…</p>}
    {query.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível atualizar o acompanhamento. Tente novamente.</p> :
      !query.isLoading && !query.data?.length && <p className="text-sm text-muted-foreground">Ao participar de um fluxo e autorizar suas contas, o acompanhamento aparecerá aqui.</p>}
    {!query.isError && query.data?.map(item => <article key={item.flow_id + item.account_id} className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">{item.flow_name} · @{item.username}</h3>
      <p className="text-sm">{labels[item.state] ?? item.state}</p>
      <p className="text-xs text-muted-foreground">
        {item.counts.published ?? 0} publicado(s) · {item.counts.scheduled ?? 0} na fila · {item.counts.processing ?? 0} publicando · {(item.counts.failed ?? 0) + (item.counts.uncertain ?? 0)} para revisão · {item.counts.cancelled ?? 0} cancelado(s)
      </p>
      {item.next_at && <p className="text-xs">Próximo horário previsto: {date(item.next_at)}{item.state !== "active" && " · aguardando retomada do fluxo"}</p>}
      <details>
        <summary className="cursor-pointer text-sm">Ver últimas publicações e agendamentos</summary>
        <ul className="mt-2 space-y-2 text-xs">
          {item.recent.map(job => <li key={job.id} className="flex flex-wrap justify-between gap-2 border-t border-border pt-2">
            <span>{job.format} · {labels[job.status] ?? job.status}</span>
            <span>{job.published_at ? `Publicado em ${date(job.published_at)}` : `Previsto para ${date(job.scheduled_at)}`}</span>
          </li>)}
        </ul>
        {!item.recent.length && <p className="mt-2 text-xs text-muted-foreground">Nenhuma publicação registrada para esta conta neste fluxo.</p>}
      </details>
    </article>)}
  </section>;
}
