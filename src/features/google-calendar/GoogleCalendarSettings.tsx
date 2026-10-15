import { CalendarDays, CheckCircle2, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  calendarErrorMessage,
  calendarRequest,
  calendarSyncErrorMessage,
  type CalendarSyncResult,
} from "./api";
import { useCalendarStatus } from "./useCalendarStatus";

type Operation = "connect" | "select_calendar" | "sync" | "disconnect";
const buttonClass = "flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

export function GoogleCalendarSettings() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const handledCallback = useRef<string | null>(null);
  const mounted = useRef(true);
  const accountGeneration = useRef(0);
  const latestUserId = useRef(user?.id);
  if (latestUserId.current !== user?.id) {
    latestUserId.current = user?.id;
    accountGeneration.current++;
  }
  const pendingCallback = useRef<{ code: string; state: string } | null>(null);
  const callbackInProgress = useRef(false);
  const operationLock = useRef(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedCalendar, setSelectedCalendar] = useState("");
  const [syncResult, setSyncResult] = useState<CalendarSyncResult | null>(null);
  const [completingConnection, setCompletingConnection] = useState(false);
  const statusKey = ["google-calendar", user?.id];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const statusQuery = useCalendarStatus();
  const status = statusQuery.data;
  const calendarsQuery = useQuery({
    queryKey: [...statusKey, "calendars"],
    queryFn: () => calendarRequest("calendars"),
    enabled: Boolean(status?.configured && status.connected && !status.reconnectRequired),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    setSelectedCalendar(status?.calendarId || "");
  }, [status?.calendarId, user?.id]);

  useEffect(() => {
    operationLock.current = false;
    callbackInProgress.current = false;
    setActionError(null);
    setSyncResult(null);
    setOperation(null);
    setCompletingConnection(false);
  }, [user?.id]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const callback = params.get("google_calendar");
    if (callback !== "connected" && callback !== "error" && callback !== "callback") return;
    const callbackKey = `${location.key}:${callback}`;
    if (handledCallback.current === callbackKey) return;
    handledCallback.current = callbackKey;
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    let nextHash = location.hash;
    if (callback === "callback") {
      const code = fragment.get("google_calendar_code");
      const state = fragment.get("google_calendar_state");
      const remainingHash = location.hash.replace(/^#/, "").split("&").filter(part => {
        try {
          const name = decodeURIComponent(part.split("=")[0].replace(/\+/g, " "));
          return name !== "google_calendar_code" && name !== "google_calendar_state";
        } catch {
          return true;
        }
      }).join("&");
      nextHash = remainingHash ? `#${remainingHash}` : "";
      if (code && state) {
        pendingCallback.current = { code, state };
      } else {
        toast.error("Não foi possível conectar o Google Agenda. Tente novamente.");
      }
    } else if (callback === "connected") {
      toast.success("Google Agenda conectado.");
    } else {
      toast.error("Não foi possível conectar o Google Agenda. Tente novamente.");
    }
    params.delete("google_calendar");
    const cleanLocation = {
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : "",
      hash: nextHash,
    };
    // Strip the temporary authorization data before any asynchronous token exchange.
    window.history.replaceState(window.history.state, "", `${cleanLocation.pathname}${cleanLocation.search}${cleanLocation.hash}`);
    navigate(cleanLocation, { replace: true });
    void cache.invalidateQueries({ queryKey: ["google-calendar", user?.id] });
  }, [cache, location.hash, location.key, location.pathname, location.search, navigate, user?.id]);

  useEffect(() => {
    if (!user || !pendingCallback.current || callbackInProgress.current) return;
    const payload = pendingCallback.current;
    pendingCallback.current = null;
    callbackInProgress.current = true;
    const generation = accountGeneration.current;
    const isCurrent = () => mounted.current && generation === accountGeneration.current;
    setCompletingConnection(true);
    void calendarRequest("callback", payload).then(result => {
      if (!isCurrent()) return;
      if (!result.connected) throw new Error("Connection incomplete");
      toast.success("Google Agenda conectado.");
    }).catch(error => {
      if (isCurrent()) setActionError(calendarErrorMessage(error));
    }).finally(() => {
      if (!isCurrent()) return;
      callbackInProgress.current = false;
      setCompletingConnection(false);
      void cache.invalidateQueries({ queryKey: ["google-calendar", user.id] });
    });
  }, [cache, location.key, user]);

  async function runAction(nextOperation: Operation, work: (isCurrent: () => boolean) => Promise<void>) {
    if (operationLock.current || callbackInProgress.current || !user) return;
    const generation = accountGeneration.current;
    const isCurrent = () => mounted.current && generation === accountGeneration.current;
    operationLock.current = true;
    setOperation(nextOperation);
    setActionError(null);
    setSyncResult(null);
    try {
      await work(isCurrent);
      if (isCurrent()) await cache.invalidateQueries({ queryKey: ["google-calendar", user.id] });
    } catch (error) {
      if (isCurrent()) setActionError(calendarErrorMessage(error));
    } finally {
      if (isCurrent()) {
        operationLock.current = false;
        setOperation(null);
      }
    }
  }

  const lastSyncDate = status?.lastSyncedAt ? new Date(status.lastSyncedAt) : null;
  const lastSyncLabel = lastSyncDate && !Number.isNaN(lastSyncDate.getTime())
    ? lastSyncDate.toLocaleString("pt-BR")
    : null;
  const busy = operation !== null || completingConnection;

  return (
    <section aria-labelledby="google-calendar-heading" className="operation-panel space-y-5 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="google-calendar-heading" className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CalendarDays className="h-4 w-4 text-muted-foreground" /> Google Agenda
        </h2>
        {status?.connected && !status.reconnectRequired && (
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Envie suas tarefas do Organizafy para o Google Agenda. Tarefas com data aparecem como eventos de dia inteiro;
        tarefas sem data não são enviadas. Edições, conclusões e exclusões feitas aqui também são sincronizadas.
        Alterações feitas no Google Agenda não atualizam suas tarefas no site.
      </p>
      {completingConnection && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Finalizando conexão com o Google Agenda…</p>}

      {!user || statusQuery.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Verificando conexão…
        </p>
      ) : statusQuery.isError || !status?.configured ? (
        <div className="space-y-3">
          <p role="status" className="text-sm text-muted-foreground">Integração indisponível no momento. Tente novamente mais tarde.</p>
          <button type="button" className={buttonClass} disabled={statusQuery.isFetching} onClick={() => void statusQuery.refetch()}>
            <RefreshCw className={`h-4 w-4 ${statusQuery.isFetching ? "animate-spin" : ""}`} /> Tentar novamente
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {status.reconnectRequired && (
            <p role="status" className="text-sm text-foreground">A autorização do Google expirou ou foi revogada. Reconecte sua conta para continuar.</p>
          )}
          {(!status.connected || status.reconnectRequired) && (
            <button
              type="button"
              disabled={busy}
              className={`${buttonClass} border-transparent bg-primary text-primary-foreground hover:bg-primary/90`}
              onClick={() => void runAction("connect", async isCurrent => {
                const { url } = await calendarRequest("connect");
                if (isCurrent()) window.location.assign(url);
              })}
            >
              {operation === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {operation === "connect" ? "Abrindo Google…" : status.reconnectRequired ? "Reconectar Google Agenda" : "Conectar Google Agenda"}
            </button>
          )}
          {status.connected && (
            <>
              <div className="space-y-2">
                <p className="break-words text-sm text-foreground">Agenda atual: <span className="font-medium">{status.calendarSummary || "Agenda principal"}</span></p>
                {!status.reconnectRequired && (
                  calendarsQuery.isPending ? (
                    <p role="status" className="text-xs text-muted-foreground">Carregando agendas…</p>
                  ) : calendarsQuery.isError ? (
                    <div className="space-y-2">
                      <p role="status" className="text-sm text-muted-foreground">Não foi possível carregar suas agendas.</p>
                      <button type="button" className={buttonClass} disabled={busy || calendarsQuery.isFetching} onClick={() => void calendarsQuery.refetch()}>Carregar agendas novamente</button>
                    </div>
                  ) : (
                    <>
                      <label htmlFor="google-calendar-selection" className="block text-xs text-muted-foreground">Agenda para suas tarefas</label>
                      <select
                        id="google-calendar-selection"
                        value={selectedCalendar}
                        disabled={busy}
                        onChange={event => setSelectedCalendar(event.target.value)}
                        className="h-11 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                      >
                        <option value="" disabled>Escolha uma agenda</option>
                        {status.calendarId && !calendarsQuery.data?.calendars.some(calendar => calendar.id === status.calendarId) && (
                          <option value={status.calendarId} disabled>{status.calendarSummary || "Agenda atual indisponível"}</option>
                        )}
                        {calendarsQuery.data?.calendars.map(calendar => (
                          <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? " (principal)" : ""}</option>
                        ))}
                      </select>
                      <p className="text-xs leading-relaxed text-muted-foreground">Ao trocar de agenda, os eventos sincronizados pelo Organizafy serão movidos para a agenda escolhida.</p>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busy || !selectedCalendar || selectedCalendar === status.calendarId}
                        onClick={() => void runAction("select_calendar", async isCurrent => {
                          await calendarRequest("select_calendar", { calendarId: selectedCalendar });
                          if (isCurrent()) toast.success("Agenda escolhida. Acompanhe a sincronização abaixo.");
                        })}
                      >
                        {operation === "select_calendar" && <Loader2 className="h-4 w-4 animate-spin" />}
                        {operation === "select_calendar" ? "Salvando agenda…" : "Salvar agenda"}
                      </button>
                    </>
                  )
                )}
              </div>
              <div className="space-y-2 rounded-xl border border-border/70 bg-secondary/40 p-4 text-xs text-muted-foreground">
                <p>{lastSyncLabel ? `Última sincronização: ${lastSyncLabel}` : "Ainda não houve sincronização."}</p>
                <p>{status.pendingCount > 0 ? `${status.pendingCount} alteração(ões) aguardando sincronização.` : "Nenhuma alteração pendente."}</p>
                {status.syncError && <p role="status" className="text-foreground">{calendarSyncErrorMessage(status.syncError)}</p>}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || status.reconnectRequired}
                  onClick={() => void runAction("sync", async isCurrent => {
                    const result = await calendarRequest("sync");
                    if (isCurrent()) setSyncResult(result);
                  })}
                >
                  <RefreshCw className={`h-4 w-4 ${operation === "sync" ? "animate-spin" : ""}`} />
                  {operation === "sync" ? "Sincronizando…" : "Sincronizar agora"}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void runAction("disconnect", async isCurrent => {
                    await calendarRequest("disconnect");
                    if (isCurrent()) toast.success("Google Agenda desconectado.");
                  })}
                >
                  {operation === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                  {operation === "disconnect" ? "Desconectando…" : "Desconectar Google Agenda"}
                </button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">Ao desconectar, a sincronização para. Os eventos já criados permanecem no Google Agenda.</p>
            </>
          )}
        </div>
      )}
      {syncResult && (
        <p role="status" className="text-sm text-foreground">
          {syncResult.reconnectRequired ? "Reconecte sua conta Google para continuar a sincronização."
            : !syncResult.connected ? "O Google Agenda foi desconectado. Conecte novamente para sincronizar."
              : `${syncResult.synced} alteração(ões) sincronizada(s), ${syncResult.pending} pendente(s) e ${syncResult.errors} erro(s).`}
        </p>
      )}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
    </section>
  );
}
