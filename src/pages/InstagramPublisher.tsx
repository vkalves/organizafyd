import { LocalMediaPreviews } from "@/features/instagram-publisher/LocalMediaPreviews";
import { MediaPreview } from "@/features/instagram-publisher/MediaPreview";
import { Link, useSearchParams } from "react-router-dom";
import {
  HotfyDashboard,
  type InstagramView,
} from "@/features/instagram-publisher/HotfyDashboard";
import { useInstagramMonitor } from "@/features/instagram-publisher/InstagramAlerts";
import { monitorRequest } from "@/features/instagram-publisher/monitor";
import "@/features/instagram-publisher/hotfy-dashboard.css";
import { ConnectAccount } from "@/features/instagram-publisher/ConnectAccount";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Instagram, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  listAccounts,
  listPosts,
  savePost,
  cancelPost,
  connections,
  publisherRequest,
  uploadMedia,
} from "@/features/instagram-publisher/api";
import type { Format, Post } from "@/features/instagram-publisher/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
const Flows = lazy(() => import("@/features/instagram-publisher/Flows"));
const InstagramAnalytics = lazy(() =>
  import("@/features/instagram-publisher/InstagramAnalytics").then(
    (module) => ({ default: module.InstagramAnalytics }),
  ),
);
import {
  playConfirmation,
  unlockAudio,
} from "@/features/instagram-publisher/sound";
const labels = {
  draft: "Rascunho",
  waiting_integration: "Revisar e agendar",
  cancelled: "Cancelado",
  scheduled: "Agendado",
  processing: "Processando",
  published: "Publicado",
  failed: "Falhou",
  uncertain: "Conferir no Instagram",
};
const field =
  "w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm";
export default function InstagramPublisher() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const views: InstagramView[] = [
    "flows",
    "dashboard",
    "compose",
    "queue",
    "accounts",
    "alerts",
    "analytics",
  ];
  const view =
    views.includes(params.get("view") as InstagramView) &&
    params.get("view") !== "dashboard"
      ? (params.get("view") as InstagramView)
      : "flows";
  const monitor = useInstagramMonitor();
  const [reading, setReading] = useState(false);
  function go(next: InstagramView, nextFormat?: "Reel" | "Story") {
    setParams({ view: next });
    if (nextFormat) setFormat(nextFormat);
  }
  async function markRead(alertId: string) {
    setReading(true);
    try {
      await monitorRequest("read", alertId);
      await monitor.refetch();
    } catch {
      toast.error("Não foi possível marcar o alerta.");
    } finally {
      setReading(false);
    }
  }
  const accountsQuery = useQuery({
    queryKey: ["instagram-publisher-accounts", user?.id],
    queryFn: () => listAccounts(user!.id),
    enabled: !!user,
  });
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const cache = useQueryClient();
  const key = ["instagram-publisher", user?.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => listPosts(user!.id),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [accountId, setAccountId] = useState("");
  const [caption, setCaption] = useState("");
  const [format, setFormat] = useState<Format>(() =>
    params.get("format") === "Reel"
      ? "Reel"
      : params.get("format") === "Story"
        ? "Story"
        : "Feed",
  );
  const [media, setMedia] = useState("");
  const [chosenFiles, setChosenFiles] = useState<File[]>([]);
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [newToken, setNewToken] = useState("");
  const linkQuery = useQuery({
    queryKey: ["ig-connections", user?.id],
    queryFn: connections,
    enabled: !!user,
    refetchInterval: 30000,
  });
  const connection = linkQuery.data?.find((c) => c.account_id === accountId);
  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);
  function reset() {
    setId(crypto.randomUUID());
    setCaption("");
    setMedia("");
    setChosenFiles([]);
    setTime("");
  }
  async function perform(run: () => Promise<void>) {
    setBusy(true);
    try {
      await run();
      await Promise.all([
        cache.invalidateQueries({ queryKey: key }),
        cache.invalidateQueries({ queryKey: ["ig-connections", user?.id] }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível concluir.",
      );
    } finally {
      setBusy(false);
    }
  }
  function save(queue: boolean) {
    unlockAudio();
    if (!user) return;
    void perform(async () => {
      await savePost({
        id,
        user_id: user.id,
        account_id: accountId,
        caption,
        format,
        media_urls: media
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        scheduled_at: time ? new Date(time).toISOString() : null,
        status: queue ? "scheduled" : "draft",
      });
      reset();
      if (queue) playConfirmation("scheduled");
      toast.success(
        queue
          ? "Postagem agendada. O envio ocorrerá automaticamente no horário escolhido."
          : "Rascunho salvo.",
      );
    });
  }
  function edit(post: Post) {
    setId(post.id);
    setAccountId(post.account_id);
    setCaption(post.caption);
    setFormat(post.format);
    setMedia(post.media_urls.join("\n"));
    const date = post.scheduled_at ? new Date(post.scheduled_at) : null;
    setTime(
      date
        ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "",
    );
    go("compose");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const connectControl = (
    <ConnectAccount
      onConnected={async (connectedId) => {
        await Promise.all([
          cache.invalidateQueries({
            queryKey: ["instagram-publisher-accounts", user?.id],
          }),
          cache.invalidateQueries({
            queryKey: ["ig-connections", user?.id],
          }),
        ]);
        setAccountId(connectedId);
      }}
    />
  );
  return (
    <div className="ig-hotfy">
      <header className="ig-hotfy-header">
        <div>
          <p className="ig-eyebrow">Instagram · Central de publicação</p>
          <h1>Instagram</h1>
          <p className="text-muted-foreground">
            Seu centro de publicação, organizado para você pensar só no
            conteúdo.
          </p>
        </div>
        {connectControl}
      </header>
      <nav className="ig-tabs" aria-label="Seções do Instagram">
        {(
          [
            ["flows", "Fluxos"],
            ["accounts", "Contas"],
            ["compose", "Nova publicação"],
            ["queue", "Agendamentos"],
            ["alerts", "Alertas"],
            ["analytics", "Analytics"],
          ] as const
        ).map(([target, label]) => (
          <button
            type="button"
            key={target}
            aria-current={view === target ? "page" : undefined}
            onClick={() => go(target)}
          >
            {label}
          </button>
        ))}
      </nav>
      {view === "analytics" && (
        <Suspense fallback={<p role="status">Carregando Analytics…</p>}>
          <InstagramAnalytics />
        </Suspense>
      )}
      {view === "flows" && (
        <Suspense fallback={<p role="status">Carregando Fluxos…</p>}>
          <Flows
            accounts={accounts}
            connections={linkQuery.data ?? []}
            posts={query.data ?? []}
            onCreated={() => cache.invalidateQueries({ queryKey: key })}
          />
        </Suspense>
      )}
      <HotfyDashboard
        accounts={accounts}
        connections={linkQuery.data ?? []}
        posts={query.data ?? []}
        monitor={monitor.data}
        loading={accountsQuery.isLoading || query.isLoading}
        failed={accountsQuery.isError || query.isError}
        monitorFailed={monitor.isError}
        view={view}
        go={go}
        connect={connectControl}
        markRead={markRead}
        reading={reading}
      />
      <p
        className={`ig-monitor-status ${monitor.isError ? "error" : ""}`}
        role="status"
      >
        {monitor.isError
          ? "Não foi possível atualizar o monitoramento."
          : "Monitor automático · verificações em segundo plano · painel atualizado a cada 30 segundos."}{" "}
        <button
          className="underline ml-2"
          onClick={() => {
            void monitor.refetch();
            void accountsQuery.refetch();
            void query.refetch();
          }}
        >
          Atualizar dados
        </button>
      </p>
      <div
        className="operation-panel rounded-2xl border border-amber-500/30 p-4"
        role="status"
        hidden={view !== "compose"}
      >
        <strong>Publicação automática</strong>
        <p className="text-sm text-muted-foreground">
          Agende para publicar com o navegador fechado. A fila é verificada a
          cada minuto; o processamento da Meta pode atrasar o envio. Rascunhos
          antigos só serão enviados depois de revisados e agendados por você.
        </p>
      </div>
      {accountsQuery.isError && (
        <p role="alert">
          Não foi possível carregar as contas.{" "}
          <Button variant="outline" onClick={() => accountsQuery.refetch()}>
            Tentar novamente
          </Button>
        </p>
      )}
      {query.isError && (
        <div role="alert" className="text-destructive">
          {query.error.message}{" "}
          <Button variant="outline" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      <div
        className="grid gap-6"
        hidden={view !== "compose" && view !== "queue"}
        style={
          view !== "compose" && view !== "queue"
            ? { display: "none" }
            : undefined
        }
      >
        <section
          hidden={view !== "compose"}
          className="operation-panel space-y-4 rounded-2xl p-5"
        >
          <div className="flex justify-between">
            <h2 className="text-lg font-semibold">Preparar postagem</h2>
            <Button variant="ghost" disabled={busy} onClick={reset}>
              <Plus className="mr-1 h-4 w-4" />
              Nova
            </Button>
          </div>
          <div>
            <Label htmlFor="ig-account">Conta</Label>
            <select
              id="ig-account"
              className={field}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Selecione uma conta</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>
            {!accounts.length && !accountsQuery.isLoading && (
              <p className="text-sm text-muted-foreground">
                Nenhuma conta conectada ainda. Clique em “Conectar conta” acima
                para adicionar seu Instagram.
              </p>
            )}
          </div>
          {connection && (
            <div className="space-y-3 rounded-xl border p-3">
              <p className="text-sm">
                {connection.reconnect_required
                  ? "Reconexão necessária"
                  : connection.paused
                    ? "Automação pausada"
                    : "Conta conectada"}
              </p>
              <p className="text-xs text-muted-foreground">
                Ao retomar, postagens atrasadas também entram na fila. Cancele
                as que não deseja enviar antes de retomar.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await publisherRequest("pause", {
                        account_id: accountId,
                        paused: !connection.paused,
                      });
                    })
                  }
                >
                  {connection.paused ? "Retomar" : "Pausar"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const data = await publisherRequest<{ username: string }>(
                        "verify",
                        { account_id: accountId },
                      );
                      toast.success("Acesso confirmado: @" + data.username);
                    })
                  }
                >
                  Verificar conexão
                </Button>
              </div>
              <details>
                <summary className="cursor-pointer text-sm">
                  Atualizar token da conta
                </summary>
                <Label htmlFor="ig-token">Novo token</Label>
                <Input
                  id="ig-token"
                  type="password"
                  autoComplete="off"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                />
                <Button
                  className="mt-2"
                  disabled={busy || !newToken}
                  onClick={() =>
                    void perform(async () => {
                      await publisherRequest("reconnect", {
                        account_id: accountId,
                        token: newToken,
                      });
                      setNewToken("");
                      toast.success("Conexão atualizada");
                    })
                  }
                >
                  Atualizar conexão
                </Button>
              </details>
            </div>
          )}
          <div>
            <Label htmlFor="ig-format">Formato</Label>
            <select
              id="ig-format"
              className={field}
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
            >
              {["Feed", "Reel", "Story", "Carrossel"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ig-caption">Legenda</Label>
            <Textarea
              id="ig-caption"
              rows={5}
              maxLength={2200}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">
              {caption.length}/2.200
            </p>
          </div>
          <div>
            <Label htmlFor="ig-upload">Enviar fotos ou vídeos</Label>
            <Input
              id="ig-upload"
              type="file"
              accept="image/jpeg,image/png,video/mp4"
              multiple={format === "Carrossel"}
              disabled={busy}
              onChange={(e) => {
                unlockAudio();
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length && user) {
                  setChosenFiles(files);
                  void perform(async () => {
                    if (
                      files.length +
                        (media.trim() ? media.trim().split("\n").length : 0) >
                      (format === "Carrossel" ? 10 : 1)
                    )
                      throw new Error(
                        "Quantidade de mídias excedida para o formato.",
                      );
                    const urls = await uploadMedia(files, user.id);
                    if (files.some((file) => file.type === "video/mp4"))
                      playConfirmation("uploaded");
                    setMedia((prev) =>
                      [prev, ...urls].filter(Boolean).join("\n"),
                    );
                    setChosenFiles([]);
                  });
                }
              }}
            />
            <LocalMediaPreviews files={chosenFiles} />
            <p className="text-xs text-muted-foreground">
              JPG, PNG ou MP4, até 100 MB por arquivo. Os metadados são
              removidos antes do upload; PNG é convertido para JPG. O
              armazenamento é privado.
            </p>
          </div>
          <div>
            <Label htmlFor="ig-media">Mídias da postagem</Label>
            <Textarea
              id="ig-media"
              rows={3}
              placeholder="https://… (um link por linha)"
              value={media}
              onChange={(e) => setMedia(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Feed: JPG. Reel: MP4. Story: JPG ou MP4 (conta empresarial).
              Carrossel: 2 a 10 fotos JPG. A Meta valida dimensões, proporção,
              duração e codecs. Você também pode usar links HTTPS diretos com
              essas extensões.
            </p>
          </div>
          {!!media.trim() && (
            <section
              aria-label="Prévia da postagem"
              className="flex flex-wrap gap-3"
            >
              {media
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean)
                .map((url, index) => (
                  <MediaPreview
                    key={`${url}-${index}`}
                    url={url}
                    label={`Mídia ${index + 1} da postagem`}
                  />
                ))}
            </section>
          )}
          <div>
            <Label htmlFor="ig-time">Data e horário de publicação</Label>
            <Input
              id="ig-time"
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Fuso: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || query.isError || !accountId}
              variant="outline"
              onClick={() => save(false)}
            >
              Salvar rascunho
            </Button>
            <Button
              disabled={
                busy ||
                query.isError ||
                !connection ||
                connection.reconnect_required ||
                connection.paused
              }
              onClick={() => save(true)}
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarClock className="mr-2 h-4 w-4" />
              )}
              Agendar postagem
            </Button>
          </div>
        </section>
        <section
          hidden={view !== "queue"}
          className="operation-panel space-y-4 rounded-2xl p-5"
        >
          <h2 className="text-lg font-semibold">Fila de publicações</h2>
          <Label htmlFor="ig-filter">Status</Label>
          <select
            id="ig-filter"
            className={field}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Todos</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {query.isLoading && <p>Carregando postagens…</p>}
          {query.data
            ?.filter((p) => filter === "all" || p.status === filter)
            .map((post) => (
              <article
                key={post.id}
                className="space-y-2 rounded-xl border p-4"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>
                    @
                    {accounts.find((a) => a.id === post.account_id)?.username ??
                      "Conta"}
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    {labels[post.status]}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {post.caption || "Sem legenda"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {post.format} · {post.media_urls.length} mídia(s) ·{" "}
                  {post.scheduled_at
                    ? new Date(post.scheduled_at).toLocaleString("pt-BR")
                    : "Sem horário"}
                </p>
                {post.source !== "job" && post.status !== "cancelled" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => edit(post)}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await cancelPost(post, user!.id);
                          if (id === post.id) reset();
                        })
                      }
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
                {post.source === "job" && post.status === "scheduled" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await cancelPost(post, user!.id);
                      })
                    }
                  >
                    Cancelar agendamento
                  </Button>
                )}
                {post.status === "published" && post.media_id && (
                  <p className="text-xs text-muted-foreground">
                    ID da publicação: {post.media_id}
                  </p>
                )}
                {post.error_code && (
                  <p role="status" className="text-sm text-destructive">
                    {post.status === "uncertain"
                      ? "O envio pode ter ocorrido. Confira o perfil antes de criar outro agendamento."
                      : "A Meta ou o servidor não concluiu o envio. Revise a mídia e a conexão."}{" "}
                    ({post.error_code})
                  </p>
                )}
              </article>
            ))}
          {!query.isLoading &&
            !query.isError &&
            !query.data?.some(
              (p) => filter === "all" || p.status === filter,
            ) && (
              <p className="py-8 text-center text-muted-foreground">
                Nenhuma postagem neste filtro.
              </p>
            )}
          <p className="text-xs text-muted-foreground">
            Exibindo até 200 postagens recentes.
          </p>
        </section>
      </div>
    </div>
  );
}
