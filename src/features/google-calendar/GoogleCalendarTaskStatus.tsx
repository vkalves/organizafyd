import { CalendarDays, CircleAlert, Link2, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useCalendarStatus } from "./useCalendarStatus";

export function GoogleCalendarTaskStatus() {
  const query = useCalendarStatus();
  const status = query.data;
  let label = "Google Agenda";
  let Icon = CalendarDays;
  if (query.isPending && query.fetchStatus === "fetching") {
    label = "Verificando Google Agenda…";
    Icon = Loader2;
  } else if (!query.isError && status?.configured) {
    if (status.reconnectRequired) {
      label = "Reconectar Google Agenda";
      Icon = CircleAlert;
    } else if (!status.connected) {
      label = "Conectar Google Agenda";
      Icon = Link2;
    } else if (status.syncError) {
      label = "Google Agenda: sincronização pendente";
      Icon = CircleAlert;
    } else if (status.pendingCount > 0) {
      label = `${status.pendingCount} alteração(ões) pendente(s) no Google Agenda`;
    } else {
      label = status.lastSyncedAt ? "Google Agenda atualizado" : "Google Agenda conectado";
    }
  }
  return (
    <Link
      to="/config"
      title="Abra as configurações do Google Agenda"
      className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border border-border/70 bg-secondary/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${Icon === Loader2 ? "animate-spin" : ""}`} />
      <span>{label}</span>
    </Link>
  );
}
