import { useState } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import {
  Instagram as InstagramIcon,
  Plus,
  ArrowLeft,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useInstagramData } from "@/features/instagram/data";
import {
  Editor,
  selectClass,
  type EditRequest,
} from "@/features/instagram/Editor";
import { ContentCalendar } from "@/features/instagram/Calendar";
import {
  statuses,
  stages,
  priorities,
  taskStatuses,
  metricNames,
  safeUrl,
  localDay,
  displayDate,
  matchesSearch,
  type Content,
  type Task,
  type Table,
  type MetricKey,
} from "@/features/instagram/model";
const panel = "min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5";
const btn = "min-h-11";
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
function Status({ status }: { status: string }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span
        className={`h-1.5 w-1.5 rounded-full ${status === "active" ? "bg-success" : status === "attention" ? "bg-warning" : status === "problem" ? "bg-destructive" : "bg-muted-foreground"}`}
      />
      {statuses[status]}
    </Badge>
  );
}
function Avatar({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return safeUrl(url) && !failed ? (
    <img
      src={safeUrl(url)}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-12 w-12 shrink-0 rounded-lg object-cover"
    />
  ) : (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-lg">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
export default function Instagram() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const mode = location.pathname.endsWith("/hoje")
    ? "today"
    : location.pathname.endsWith("/tarefas")
      ? "tasks"
      : "accounts";
  const query = useInstagramData();
  const { data, save, saving } = query;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState("overview");
  const [stage, setStage] = useState("");
  const [metric, setMetric] = useState<MetricKey>("followers");
  const [edit, setEdit] = useState<EditRequest | null>(null);
  const [deletion, setDeletion] = useState<{
    table: Exclude<Table, "history">;
    id: string;
    name: string;
  } | null>(null);
  if (query.isLoading)
    return (
      <p role="status" className="p-8 text-muted-foreground">
        Carregando sua central Instagram…
      </p>
    );
  if (query.isError || !data)
    return (
      <div className={panel}>
        <h1 className="text-xl font-semibold">
          Não foi possível carregar Instagram
        </h1>
        <p className="my-3 text-sm text-muted-foreground">
          Verifique sua conexão e se a migração Instagram foi aplicada no
          Supabase.
        </p>
        <Button onClick={() => query.refetch()}>Tentar novamente</Button>
      </div>
    );
  const account = data.accounts.find((a) => a.id === accountId);
  const contents = data.contents.filter(
    (c) => !accountId || c.account_id === accountId,
  );
  const tasks = data.tasks.filter(
    (t) => !accountId || t.account_id === accountId,
  );
  const metrics = data.metrics
    .filter((m) => m.account_id === accountId)
    .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
  const latestMetric = (id: string) =>
    data.metrics
      .filter((m) => m.account_id === id && m.followers !== null)
      .sort((a, b) => b.recorded_on.localeCompare(a.recorded_on))[0];
  const latestPost = (id: string) =>
    data.contents
      .filter(
        (c) =>
          c.account_id === id && c.status === "published" && c.published_at,
      )
      .sort((a, b) => b.published_at!.localeCompare(a.published_at!))[0];
  const nextTask = (id: string) =>
    data.tasks
      .filter((t) => t.account_id === id && t.status !== "done")
      .sort((a, b) =>
        (a.due_at || "9999").localeCompare(b.due_at || "9999"),
      )[0];
  const openEdit = (table: EditRequest["table"], row: object) =>
    setEdit({ table, id: (row as { id: string }).id, values: { ...row } });
  const create = (
    table: EditRequest["table"],
    values: Record<string, unknown> = {},
  ) =>
    setEdit({
      table,
      values: { ...(accountId ? { account_id: accountId } : {}), ...values },
    });
  const remove = (table: Exclude<Table, "history">, id: string, name: string) =>
    setDeletion({ table, id, name });
  const mutate = async (args: Parameters<typeof save>[0]) => {
    try {
      await save(args);
    } catch {
      /* Mutation displays actionable errors; preserve current UI. */
    }
  };
  const actions = (
    table: EditRequest["table"],
    row: { id: string },
    name: string,
  ) => (
    <div className="flex shrink-0 gap-1">
      <Button
        className={btn}
        size="icon"
        variant="ghost"
        aria-label={`Editar ${name}`}
        onClick={() => openEdit(table, row)}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        className={btn}
        size="icon"
        variant="ghost"
        aria-label={`Excluir ${name}`}
        onClick={() => remove(table, row.id, name)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
  const taskRow = (t: Task) => (
    <div
      key={t.id}
      className="flex min-w-0 items-start gap-2 rounded-lg border bg-card p-3"
    >
      <input
        type="checkbox"
        aria-label={`Concluir ${t.title}`}
        className="mt-3 h-5 w-5 shrink-0"
        checked={t.status === "done"}
        disabled={saving}
        onChange={() =>
          mutate({
            table: "tasks",
            id: t.id,
            values: { status: t.status === "done" ? "todo" : "done" },
          })
        }
      />
      <div className="min-w-0 flex-1">
        <p
          className={`break-words text-sm font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}
        >
          {t.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {displayDate(t.due_at)} · {priorities[t.priority]} ·{" "}
          {taskStatuses[t.status]}
        </p>
        {t.description && (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {t.description}
          </p>
        )}
        {t.notes && (
          <p className="break-words text-xs text-muted-foreground">{t.notes}</p>
        )}
      </div>
      {actions("tasks", t, t.title)}
    </div>
  );
  const contentRow = (c: Content) => (
    <div key={c.id} className={panel}>
      <div className="flex items-start gap-2">
        {safeUrl(c.thumbnail_url) && (
          <img
            alt=""
            src={safeUrl(c.thumbnail_url)}
            loading="lazy"
            className="h-14 w-14 rounded object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{c.title}</p>
          <p className="text-xs text-muted-foreground">
            {c.format} · {stages[c.status]}
          </p>
        </div>
        {actions("contents", c, c.title)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {c.status === "published" ? "Publicado" : "Planejado"}:{" "}
        {displayDate(c.status === "published" ? c.published_at : c.planned_at)}
      </p>
      {c.caption && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">
          {c.caption}
        </p>
      )}
      {c.hashtags && (
        <p className="mt-1 break-words text-xs text-muted-foreground">
          {c.hashtags}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {safeUrl(c.media_url) && (
          <Button variant="outline" asChild>
            <a
              href={safeUrl(c.media_url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir mídia
            </a>
          </Button>
        )}
        {safeUrl(c.publication_url) && (
          <Button variant="outline" asChild>
            <a
              href={safeUrl(c.publication_url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver publicação
            </a>
          </Button>
        )}
        {c.status !== "published" && (
          <Button
            variant="secondary"
            onClick={() =>
              setEdit({
                table: "contents",
                id: c.id,
                values: {
                  ...c,
                  status: "published",
                  published_at: new Date().toISOString(),
                },
              })
            }
          >
            Marcar publicado
          </Button>
        )}
      </div>
    </div>
  );
  const today = localDay();
  const visibleAccounts = data.accounts.filter(
    (a) => matchesSearch(a, search) && (!status || a.status === status),
  );
  const todayTasks = tasks.filter(
    (t) => t.due_at && localDay(t.due_at) === today,
  );
  const overdue = tasks.filter(
    (t) => t.due_at && localDay(t.due_at) < today && t.status !== "done",
  );
  const todayContents = contents.filter(
    (c) =>
      (c.status === "published" ? c.published_at : c.planned_at) &&
      localDay((c.status === "published" ? c.published_at : c.planned_at)!) ===
        today,
  );
  const form = edit && (
    <Editor
      key={`${edit.table}-${edit.id || "new"}`}
      request={edit}
      data={data}
      saving={saving}
      onClose={() => setEdit(null)}
      onSave={async (values) => {
        await save({ table: edit.table, id: edit.id, values });
        setEdit(null);
      }}
    />
  );
  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {accountId && (
            <Button asChild variant="ghost" className="mb-2 -ml-3">
              <Link to="/instagram">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Todas as contas
              </Link>
            </Button>
          )}
          <h1 className="flex items-center gap-2 break-all text-2xl font-bold">
            <InstagramIcon className="h-6 w-6 shrink-0" />
            {accountId
              ? account
                ? `@${account.username}`
                : "Conta não encontrada"
              : mode === "today"
                ? "Hoje"
                : mode === "tasks"
                  ? "Tarefas do Instagram"
                  : "Instagram"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {account
              ? `@${account.username}`
              : mode === "today"
                ? new Date().toLocaleDateString("pt-BR", { dateStyle: "full" })
                : "Organize suas contas, conteúdos e rotina."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {account ? (
            <>
              {safeUrl(
                account.instagram_url ||
                  `https://www.instagram.com/${account.username}/`,
              ) && (
                <Button asChild variant="outline">
                  <a
                    href={safeUrl(
                      account.instagram_url ||
                        `https://www.instagram.com/${account.username}/`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir
                  </a>
                </Button>
              )}
              <Button onClick={() => openEdit("accounts", account)}>
                Editar conta
              </Button>
            </>
          ) : (
            !accountId && (
              <Button
                onClick={() => create(mode === "tasks" ? "tasks" : "accounts")}
                disabled={mode === "tasks" && !data.accounts.length}
              >
                <Plus className="mr-2 h-4 w-4" />
                {mode === "tasks" ? "Nova tarefa" : "Nova conta"}
              </Button>
            )
          )}
        </div>
      </header>
      {!accountId && (
        <nav aria-label="Instagram" className="flex flex-wrap gap-2">
          {[
            ["/instagram", "Contas"],
            ["/instagram/hoje", "Hoje"],
            ["/instagram/tarefas", "Todas as tarefas"],
          ].map(([path, title]) => (
            <Button
              asChild
              variant={location.pathname === path ? "secondary" : "ghost"}
              key={path}
            >
              <Link to={path}>{title}</Link>
            </Button>
          ))}
        </nav>
      )}
      {!accountId && mode === "accounts" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Contas", data.accounts.length],
              [
                "Ativas",
                data.accounts.filter((a) => a.status === "active").length,
              ],
                            [
                "Aquecendo",
                data.accounts.filter((a) => a.status === "warming").length,
              ],
              [
                "Em criação",
                data.accounts.filter((a) => a.status === "creating").length,
              ],
            ].map(([title, value]) => (
              <div className={panel} key={title}>
                <p className="text-2xl font-semibold">{value}</p>
                <p className="text-xs text-muted-foreground">{title}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              className="h-11"
              aria-label="Buscar contas"
              placeholder="Buscar conta..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Filtrar status"
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Todos os status</option>
              {Object.entries(statuses).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {!visibleAccounts.length && (
            <Empty>
              {data.accounts.length
                ? "Nenhuma conta corresponde aos filtros."
                : "Adicione sua primeira conta para começar."}
            </Empty>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleAccounts.map((a) => (
                      <article key={a.id} className={panel}>
                        <div className="flex items-center gap-3">
                          <Avatar url={a.avatar_url} name={a.name} />
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/instagram/conta/${a.id}`}
                              className="break-all font-semibold hover:underline"
                            >
                              @{a.username}
                            </Link>
                          </div>
                          <Button
                            className={btn}
                            size="icon"
                            variant="ghost"
                            aria-label={`Apagar @${a.username}`}
                            onClick={() =>
                              remove("accounts", a.id, `@${a.username}`)
                            }
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="my-3 flex flex-wrap gap-1">
                          <Status status={a.status} />
                        </div>
                        <p className="font-semibold">
                          {latestMetric(a.id)?.followers?.toLocaleString(
                            "pt-BR",
                          ) ?? "—"}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            seguidores
                          </span>
                        </p>
                        <dl className="mt-3 space-y-2 text-xs">
                          <div>
                            <dt className="text-muted-foreground">
                              Última publicação
                            </dt>
                            <dd>
                              {displayDate(latestPost(a.id)?.published_at)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Próxima tarefa
                            </dt>
                            <dd className="break-words">
                              {nextTask(a.id)?.title ||
                                "Nenhuma tarefa pendente"}
                            </dd>
                          </div>
                        </dl>
                        {a.notes && (
                          <p className="mt-3 line-clamp-2 break-words text-xs text-muted-foreground">
                            {a.notes}
                          </p>
                        )}
                        <div className="mt-4">
                          <Button asChild className="w-full">
                            <Link to={`/instagram/conta/${a.id}`}>
                              Gerenciar
                            </Link>
                          </Button>
                        </div>
                      </article>
            ))}
          </div>
        </>
      )}
      {!accountId && (mode === "today" || mode === "tasks") && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {mode === "today"
                ? `${todayTasks.filter((t) => t.status !== "done").length} tarefas pendentes · ${todayContents.length} conteúdos hoje`
                : `${tasks.filter((t) => t.status !== "done").length} tarefas pendentes`}
            </p>
            <Button
              variant="outline"
              disabled={!data.accounts.length}
              onClick={() =>
                create(
                  "tasks",
                  mode === "today" ? { due_at: `${today}T09:00` } : {},
                )
              }
            >
              Nova tarefa
            </Button>
          </div>
          {mode === "today" && overdue.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-warning">
                Atrasadas · {overdue.length}
              </h2>
              {overdue.map((t) => (
                <div key={t.id}>
                  <Link
                    className="text-xs text-muted-foreground"
                    to={`/instagram/conta/${t.account_id}`}
                  >
                    @
                    {data.accounts.find((a) => a.id === t.account_id)?.username}
                  </Link>
                  {taskRow(t)}
                </div>
              ))}
            </div>
          )}
          {data.accounts.map((a) => {
            const ts = (mode === "today" ? todayTasks : tasks)
              .filter((t) => t.account_id === a.id)
              .sort((x, y) =>
                (x.due_at || "9999").localeCompare(y.due_at || "9999"),
              );
            const cs =
              mode === "today"
                ? todayContents.filter((c) => c.account_id === a.id)
                : [];
            return (
              (ts.length > 0 || cs.length > 0) && (
                <section key={a.id} className="space-y-2">
                  <h2 className="break-words font-medium">
                    <Link to={`/instagram/conta/${a.id}`}>
                      @{a.username}
                    </Link>
                  </h2>
                  {ts.map(taskRow)}
                  {cs.map(contentRow)}
                </section>
              )
            );
          })}
          {(mode === "today"
            ? todayTasks.length + todayContents.length
            : tasks.length) === 0 && (
            <Empty>
              {mode === "today"
                ? "Nenhum compromisso planejado para hoje."
                : "Nenhuma tarefa cadastrada."}
            </Empty>
          )}
        </>
      )}
      {accountId && !account && (
        <Empty>
          Esta conta não existe ou não está disponível.{" "}
          <Link to="/instagram" className="underline">
            Voltar
          </Link>
        </Empty>
      )}
      {account && (
        <>
          <nav aria-label="Abas da conta" className="flex flex-wrap gap-1">
            {[
              ["overview", "Visão geral"],
              ["contents", "Conteúdos"],
              ["calendar", "Calendário"],
              ["tasks", "Tarefas"],
              ["metrics", "Métricas"],
              ["info", "Informações"],
              ["history", "Histórico"],
            ].map(([key, title]) => (
              <Button
                key={key}
                variant={tab === key ? "secondary" : "ghost"}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
              >
                {title}
              </Button>
            ))}
          </nav>
          {tab === "overview" && (
            <>
              <div className={panel}>
                <div className="flex items-center gap-3">
                  <Avatar url={account.avatar_url} name={account.name} />
                  <div>
                    <Status status={account.status} />
                    <p className="mt-2 text-sm text-muted-foreground">
                      {account.category || "Sem categoria"}
                    </p>
                  </div>
                </div>
                {account.notes && (
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm">
                    {account.notes}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  "Conteúdos publicados",
                  "Conteúdos prontos",
                  "Conteúdos pendentes",
                ].map((title) => (
                  <div key={title} className={panel}>
                    <p className="text-xl font-semibold">—</p>
                    <p className="text-xs text-muted-foreground">{title}</p>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "contents" && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => create("contents")}>
                  Novo conteúdo
                </Button>
                <select
                  aria-label="Filtrar etapa"
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className={`${selectClass} sm:w-auto`}
                >
                  <option value="">Todas as etapas</option>
                  {Object.entries(stages).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              {contents.filter((c) => !stage || c.status === stage).length ===
                0 && <Empty>Nenhum conteúdo nesta etapa.</Empty>}
              <div className="grid gap-3 lg:grid-cols-2">
                {contents
                  .filter((c) => !stage || c.status === stage)
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map(contentRow)}
              </div>
            </>
          )}
          {tab === "calendar" && (
            <div className={panel}>
              <ContentCalendar
                contents={contents}
                onCreate={(date) =>
                  create("contents", { planned_at: `${date}T09:00` })
                }
                onEdit={(c) => openEdit("contents", c)}
              />
            </div>
          )}
          {tab === "tasks" && (
            <>
              <Button onClick={() => create("tasks")}>Nova tarefa</Button>
              {!tasks.length && (
                <Empty>Esta conta ainda não tem tarefas.</Empty>
              )}
              <div className="space-y-2">
                {[...tasks]
                  .sort((a, b) =>
                    (a.due_at || "9999").localeCompare(b.due_at || "9999"),
                  )
                  .map(taskRow)}
              </div>
            </>
          )}
          {tab === "metrics" && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => create("metrics")}>
                  Registrar métricas
                </Button>
                <select
                  aria-label="Métrica do gráfico"
                  className={`${selectClass} sm:w-auto`}
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as MetricKey)}
                >
                  {Object.entries(metricNames).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                Registros manuais. Uma medição por dia; edite o registro para
                corrigir valores.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[0, 7, 30].map((days) => {
                  const date = new Date();
                  date.setDate(date.getDate() - days);
                  const cutoff = localDay(date);
                  const measurement = [...metrics]
                    .reverse()
                    .find((m) => m.recorded_on <= cutoff && m[metric] != null);
                  return (
                    <div className={panel} key={days}>
                      <p className="text-xs text-muted-foreground">
                        {days === 0 ? "Atual" : `${days} dias atrás`}
                      </p>
                      <p className="mt-1 break-all text-lg font-semibold">
                        {measurement?.[metric]?.toLocaleString("pt-BR") ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {measurement
                          ? displayDate(measurement.recorded_on)
                          : "Sem registro"}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Comparação usa o último registro disponível até cada data.
              </p>
              {metrics.length === 0 ? (
                <Empty>Registre métricas para acompanhar a evolução.</Empty>
              ) : (
                <>
                  <div
                    className={`${panel} h-72`}
                    role="img"
                    aria-label={`Evolução de ${metricNames[metric]}`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metrics}>
                        <CartesianGrid
                          stroke="hsl(var(--border))"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="recorded_on"
                          tickFormatter={(d) => displayDate(d)}
                          tick={{ fontSize: 10 }}
                        />
                        <YAxis width={45} tick={{ fontSize: 10 }} />
                        <Tooltip
                          labelFormatter={(d) => displayDate(String(d))}
                          contentStyle={{
                            background: "hsl(var(--card))",
                            borderColor: "hsl(var(--border))",
                          }}
                        />
                        <Line
                          dataKey={metric}
                          name={metricNames[metric]}
                          stroke="hsl(var(--foreground))"
                          strokeWidth={2}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {[...metrics].reverse().map((m) => (
                      <div className={panel} key={m.id}>
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-medium">
                            {displayDate(m.recorded_on)}
                          </h3>
                          {actions("metrics", m, m.recorded_on)}
                        </div>
                        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {Object.entries(metricNames).map(([k, v]) => (
                            <div key={k}>
                              <dt className="text-xs text-muted-foreground">
                                {v}
                              </dt>
                              <dd className="text-sm">
                                {m[k] === null
                                  ? "—"
                                  : Number(m[k]).toLocaleString("pt-BR")}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {tab === "info" && (
            <>
              <div className={panel}>
                <h2 className="mb-4 font-medium">Informações da conta</h2>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {[
                    ["Username", `@${account.username}`],
                    ["E-mail", account.email],
                    ["Número", account.phone],
                    ["Aparelho", account.responsible],
                    ["Criada em", displayDate(account.account_created_on)],
                    ["Status", statuses[account.status]],
                    ["Observações", account.notes],
                  ].map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">
                        {v || "Não informado"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => openEdit("accounts", account)}
                >
                  Editar informações
                </Button>
              </div>
              <Button
                variant="destructive"
                onClick={() =>
                  remove("accounts", account.id, `@${account.username}`)
                }
              >
                Excluir conta
              </Button>
            </>
          )}
          {tab === "history" && (
            <div className="space-y-2">
              {!data.history.some((h) => h.account_id === account.id) && (
                <Empty>Nenhuma atividade registrada.</Empty>
              )}
              {data.history
                .filter((h) => h.account_id === account.id)
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((h) => {
                  const [table, verb] = h.action.split(":");
                  const entity =
                    {
                      instagram_accounts: "Conta",
                      instagram_contents: "Conteúdo",
                      instagram_tasks: "Tarefa",
                      instagram_metrics: "Métricas",
                    }[table] || "Registro";
                  return (
                    <article key={h.id} className={panel}>
                      <p className="text-xs text-muted-foreground">
                        {displayDate(h.created_at)}
                      </p>
                      <p className="mt-1 break-words text-sm">
                        {entity}:{" "}
                        {
                          {
                            insert: "criação",
                            update: "atualização",
                            delete: "exclusão",
                          }[verb]
                        }
                        {h.details.title ? ` · ${h.details.title}` : ""}
                      </p>
                      {h.details.status && (
                        <p className="text-xs text-muted-foreground">
                          {h.details.previous_status
                            ? `${statuses[h.details.previous_status] || stages[h.details.previous_status] || taskStatuses[h.details.previous_status] || h.details.previous_status} → `
                            : ""}
                          {statuses[h.details.status] ||
                            stages[h.details.status] ||
                            taskStatuses[h.details.status] ||
                            h.details.status}
                        </p>
                      )}
                      {h.details.followers !== null &&
                        h.details.followers !== undefined && (
                          <p className="text-xs">
                            Seguidores:{" "}
                            {h.details.previous_followers
                              ? `${h.details.previous_followers} → `
                              : ""}
                            {h.details.followers}
                          </p>
                        )}
                    </article>
                  );
                })}
            </div>
          )}
        </>
      )}
      {form}
      <Dialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open && !saving) setDeletion(null);
        }}
      >
        <DialogContent className="w-[calc(100%_-_1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar exclusão</DialogTitle>
            <DialogDescription className="break-words">
              Excluir {deletion?.name}?{" "}
              {deletion?.table === "accounts"
                ? "Os conteúdos, tarefas, métricas e histórico desta conta também serão excluídos."
                : "Esta ação não pode ser desfeita."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setDeletion(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={async () => {
                if (!deletion) return;
                try {
                  await save({ ...deletion, remove: true });
                  setDeletion(null);
                  if (
                    deletion.table === "accounts" &&
                    accountId === deletion.id
                  )
                    navigate("/instagram");
                } catch {
                  /* Keep confirmation open on failure. */
                }
              }}
            >
              {saving ? "Excluindo…" : "Excluir"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
