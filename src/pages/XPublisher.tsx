import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  ImagePlus,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { errorMessage, uploadFiles, xRequest } from "@/features/x/api";
import type { XData, XMedia } from "@/features/x/api";
import { textWeight } from "../../supabase/functions/x-publisher/model";
const labels: Record<string, string> = {
  scheduled: "Agendado",
  processing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  uncertain: "Conferir no X",
  cancelled: "Cancelado",
};
const dates = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});
function defaultTime() {
  const value = new Date(Date.now() + 3600000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export default function XPublisher() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const key = useMemo(() => ["x-publisher", user?.id], [user?.id]);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [text, setText] = useState("");
  const [time, setTime] = useState(defaultTime);
  const [files, setFiles] = useState<File[]>([]);
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState("all");
  const [fileKey, setFileKey] = useState(0);
  const draftId = useRef(crypto.randomUUID());
  const uploaded = useRef<XMedia[] | null>(null);
  const callbackStarted = useRef(false);
  const query = useQuery({
    queryKey: key,
    queryFn: () => xRequest<XData>("list"),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const data = query.data;
  const accounts = useMemo(() => data?.accounts || [], [data?.accounts]);
  const posts = (data?.posts || []).filter(
    (post) =>
      (filter === "all" || post.account_id === filter) &&
      (status === "all" || post.status === status),
  );
  const selected = accounts.find((a) => a.id === accountId);
  const count = textWeight(text);
  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);
  useEffect(() => {
    if (!user || callbackStarted.current) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.has("x_code") && !params.has("x_error")) return;
    callbackStarted.current = true;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    if (params.has("x_error")) {
      toast.error(errorMessage("oauth_denied"));
      return;
    }
    setBusy(true);
    xRequest("callback", {
      code: params.get("x_code"),
      state: params.get("x_state"),
    })
      .then(() => {
        toast.success("Conta do X conectada");
        return cache.invalidateQueries({ queryKey: key });
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setBusy(false));
  }, [user, cache, key]);
  async function action(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      await run();
      await cache.invalidateQueries({ queryKey: key });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível concluir.",
      );
    } finally {
      setBusy(false);
    }
  }
  function resetSubmission() {
    draftId.current = crypto.randomUUID();
    uploaded.current = null;
  }
  async function connect() {
    const result = await xRequest<{ url: string }>("connect");
    const url = new URL(result.url);
    if (
      url.origin !== "https://x.com" ||
      url.pathname !== "/i/oauth2/authorize"
    )
      throw new Error("Endereço de conexão inválido.");
    window.location.assign(url.toString());
  }
  async function schedule() {
    if (!user || !selected) return;
    if (
      Date.parse(time) < Date.now() + 60000 ||
      !Number.isFinite(Date.parse(time))
    )
      throw new Error(errorMessage("invalid_schedule"));
    if (!uploaded.current) uploaded.current = await uploadFiles(files, user.id);
    await xRequest("schedule", {
      id: draftId.current,
      accountId,
      text,
      media: uploaded.current,
      scheduledAt: new Date(time).toISOString(),
    });
    toast.success("Postagem agendada");
    setText("");
    setFiles([]);
    setTime(defaultTime());
    setFileKey((v) => v + 1);
    resetSubmission();
  }
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Publicações
          </p>
          <h1 className="text-2xl font-semibold">Automação do X</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha a conta, prepare o conteúdo e agende.
          </p>
        </div>
        <Button
          disabled={busy || !data?.configured}
          onClick={() => action(connect)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Conectar conta
        </Button>
      </div>
      {query.isLoading && (
        <p role="status" className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando contas…
        </p>
      )}
      {query.isError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 p-4"
        >
          <p>{query.error.message}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => query.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      )}
      {data && !data.configured && (
        <div
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"
          role="status"
        >
          <h2 className="font-medium">Falta ativar a integração</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            É necessário configurar o aplicativo do X e o agendador no servidor.
            Depois disso, você poderá conectar a primeira conta aqui.
          </p>
          <a
            className="mt-3 inline-flex text-sm underline"
            href="https://github.com/vkalves/organizafyd/blob/main/docs/x-publisher.md"
            target="_blank"
            rel="noreferrer"
          >
            Ver instruções de ativação
          </a>
        </div>
      )}
      {data?.configured && (
        <>
          <section aria-label="Contas conectadas" className="space-y-3">
            {!accounts.length ? (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <h2 className="font-medium">Conecte sua primeira conta</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  A autorização acontece no X. Você poderá adicionar outras
                  contas depois.
                </p>
              </div>
            ) : (
              accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
                >
                  <div>
                    <h2 className="font-medium">@{a.username}</h2>
                    <p className="text-sm text-muted-foreground">
                      {a.name} ·{" "}
                      {a.reconnect_required
                        ? "Precisa reconectar"
                        : a.paused
                          ? "Automação pausada"
                          : "Automação ativa"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.reconnect_required ? (
                      <Button
                        disabled={busy}
                        variant="outline"
                        onClick={() => action(connect)}
                      >
                        Reconectar
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            action(() =>
                              xRequest("pause", {
                                accountId: a.id,
                                paused: !a.paused,
                              }),
                            )
                          }
                        >
                          {a.paused ? (
                            <Play className="mr-2 h-4 w-4" />
                          ) : (
                            <Pause className="mr-2 h-4 w-4" />
                          )}
                          {a.paused ? "Retomar" : "Pausar"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Desconectar @${a.username}? As próximas postagens ficarão pausadas.`,
                              )
                            )
                              action(() =>
                                xRequest("disconnect", { accountId: a.id }),
                              );
                          }}
                        >
                          Desconectar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <section className="space-y-4 rounded-xl border bg-card p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <CalendarClock className="h-5 w-5" />
                Nova postagem
              </h2>
              <div className="space-y-2">
                <Label htmlFor="x-account">Conta</Label>
                <select
                  id="x-account"
                  disabled={busy}
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    resetSubmission();
                  }}
                  className="flex h-11 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="" disabled>
                    Selecione uma conta
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="x-text">Texto da postagem</Label>
                <Textarea
                  id="x-text"
                  disabled={busy}
                  rows={6}
                  placeholder="Escreva sua legenda…"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    resetSubmission();
                  }}
                />
                <p
                  className={`text-right text-xs ${count > 280 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {count}/280
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="x-files" className="flex items-center gap-2">
                  <ImagePlus className="h-4 w-4" />
                  Fotos ou vídeo
                </Label>
                <Input
                  key={fileKey}
                  id="x-files"
                  type="file"
                  accept="image/jpeg,image/png,video/mp4"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    setFiles(Array.from(e.target.files || []));
                    resetSubmission();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Até 4 fotos JPG/PNG (5 MB cada) ou 1 vídeo MP4 (20 MB).
                </p>
                {files.length > 0 && (
                  <p className="break-all text-xs">
                    {files.map((f) => f.name).join(", ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="x-time">Data e horário</Label>
                <Input
                  id="x-time"
                  type="datetime-local"
                  value={time}
                  disabled={busy}
                  onChange={(e) => {
                    setTime(e.target.value);
                    resetSubmission();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Fuso do seu dispositivo:{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}. O envio é
                  verificado a cada minuto.
                </p>
              </div>
              {selected?.paused && (
                <p className="text-sm text-amber-600">
                  Esta conta está pausada. Retome a automação para publicar os
                  agendamentos.
                </p>
              )}
              <Button
                className="w-full"
                disabled={
                  busy ||
                  !selected ||
                  selected.reconnect_required ||
                  count > 280 ||
                  (!text.trim() && !files.length)
                }
                onClick={() => action(schedule)}
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CalendarClock className="mr-2 h-4 w-4" />
                )}
                Agendar postagem
              </Button>
            </section>
            <section className="min-w-0 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Suas postagens</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Atualizar postagens"
                  disabled={query.isFetching}
                  onClick={() => query.refetch()}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="Filtrar conta"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="h-10 max-w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">Todas as contas</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filtrar estado"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">Todos os estados</option>
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                Mostrando até 200 postagens recentes. Ao retomar uma conta, os
                agendamentos atrasados também entram na fila.
              </p>
              {!posts.length && (
                <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Nenhuma postagem por aqui.
                </p>
              )}
              {posts.map((post) => (
                <article
                  key={post.id}
                  className="space-y-3 rounded-xl border bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      @
                      {accounts.find((a) => a.id === post.account_id)
                        ?.username || "conta"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                      {post.status === "published" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : ["failed", "uncertain"].includes(post.status) ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : null}
                      {labels[post.status] || post.status}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {post.text || "Postagem com mídia"}
                  </p>
                  {post.media.length > 0 && (
                    <p className="break-all text-xs text-muted-foreground">
                      {post.media.map((m) => m.name).join(", ")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {dates.format(new Date(post.scheduled_at))}
                  </p>
                  {post.error_code && (
                    <p className="text-sm text-destructive">
                      {errorMessage(post.error_code)}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {post.status === "scheduled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          action(() => xRequest("cancel", { id: post.id }))
                        }
                      >
                        Cancelar agendamento
                      </Button>
                    )}
                    {post.x_post_id && /^\d+$/.test(post.x_post_id) && (
                      <a
                        className="inline-flex items-center gap-1 text-sm underline"
                        href={`https://x.com/i/status/${post.x_post_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver no X<ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
