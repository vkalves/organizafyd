import { useState, useEffect } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import {
  Instagram as InstagramIcon,
  Plus,
  ArrowLeft,
  Pencil,
  Trash2,
  RotateCcw,
  CheckCircle2,
  ChevronRight,
  User,
  Flame,
  Hourglass,
  Search,
  SlidersHorizontal,
  Link2,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  devices,
  models,
  isVerified,
  verifiedLabel,
  safeUrl,
  localDay,
  displayDate,
  matchesSearch,
  contentCounts,
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
      {status === "warming" || status === "attention" ? (
        <Flame className="h-3.5 w-3.5 shrink-0 text-warning" />
      ) : (
        <span
          className={`h-1.5 w-1.5 rounded-full ${status === "active" ? "bg-success" : status === "problem" ? "bg-destructive" : "bg-muted-foreground"}`}
        />
      )}
      {statuses[status]}
    </Badge>
  );
}
function VerifiedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px] shrink-0"
      aria-label="Conta verificada"
    >
      <path
        fill="hsl(var(--info))"
        d="M12 0.8 L14.11 4.13 L17.6 2.3 L17.76 6.24 L21.7 6.4 L19.87 9.89 L23.2 12 L19.87 14.11 L21.7 17.6 L17.76 17.76 L17.6 21.7 L14.11 19.87 L12 23.2 L9.89 19.87 L6.4 21.7 L6.24 17.76 L2.3 17.6 L4.13 14.11 L0.8 12 L4.13 9.89 L2.3 6.4 L6.24 6.24 L6.4 2.3 L9.89 4.13 Z"
      />
      <path
        d="M7.7 12.35 10.55 15.4 16.55 8.55"
        fill="none"
        stroke="hsl(var(--info-foreground))"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Handle({
  username,
  verified,
  className = "",
}: {
  username: string;
  verified?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      <span className="min-w-0 break-all">@{username}</span>
      {verified ? <VerifiedIcon /> : null}
    </span>
  );
}
function ProgressRing({
  value,
  className = "h-20 w-20",
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 72 72" className={`shrink-0 ${className}`} aria-hidden="true">
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="hsl(var(--border))"
        strokeWidth="6"
      />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeWidth="6"
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="41"
        textAnchor="middle"
        fill="currentColor"
        fontSize="12"
        fontWeight="600"
      >
        {pct}%
      </text>
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
      <path d="M11 5.5h2" strokeLinecap="round" />
      <path d="M12 18.4h.01" strokeLinecap="round" />
    </svg>
  );
}
function StatLine({
  icon,
  count,
  label,
  dim,
  action,
}: {
  icon?: React.ReactNode;
  count: number;
  label: string;
  dim?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg bg-muted/40 px-4 py-3.5 ${dim ? "opacity-45" : ""}`}
    >
      <p className="flex items-center gap-2.5 text-base">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="font-semibold tabular-nums">{count}</span> {label}
        </span>
        {action}
      </p>
    </div>
  );
}
function FilterBar({
  search,
  onSearch,
  label,
  filters,
  onClear,
  action,
}: {
  search: string;
  onSearch: (value: string) => void;
  label: string;
  filters: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: string[][];
  }[];
  onClear: () => void;
  action?: React.ReactNode;
}) {
  const active = filters.filter((item) => item.value).length;
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-44 shrink-0 sm:w-52">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          className="h-8 border-0 bg-muted/40 pl-8 text-sm shadow-none"
          aria-label={label}
          placeholder="Buscar..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="relative h-8 w-8 shrink-0"
            aria-label="Filtros"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {active ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-medium">
                {active}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 space-y-2 p-3">
          {filters.map((item) => (
            <select
              key={item.label}
              aria-label={item.label}
              className={`${selectClass} !h-9`}
              value={item.value}
              onChange={(e) => item.onChange(e.target.value)}
            >
              <option value="">{item.label}</option>
              {item.options.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={!search && !active}
            onClick={onClear}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Limpar
          </Button>
        </PopoverContent>
      </Popover>
      {action}
    </div>
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
  const { accountId, group } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const mode =
    location.pathname.includes("/pendentes") ||
    location.pathname.endsWith("/hoje")
      ? "pending"
      : location.pathname.includes("/prontos") ||
          location.pathname.endsWith("/tarefas")
        ? "ready"
        : "accounts";
  const query = useInstagramData();
  const { data, save, saving } = query;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [device, setDevice] = useState("");
  const [model, setModel] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingModel, setPendingModel] = useState("");
  const [pendingAccount, setPendingAccount] = useState("");
  const [pendingDevice, setPendingDevice] = useState("");
  const [readySearch, setReadySearch] = useState("");
  const [readyModel, setReadyModel] = useState("");
  const [readyAccount, setReadyAccount] = useState("");
  const [readyDevice, setReadyDevice] = useState("");
  const [tab, setTab] = useState("overview");
  const [stage, setStage] = useState("");
  const [metric, setMetric] = useState<MetricKey>("followers");
  const [edit, setEdit] = useState<EditRequest | null>(null);
  const [deletion, setDeletion] = useState<{
    table: Exclude<Table, "history">;
    id: string;
    name: string;
  } | null>(null);
  const [readyConfirm, setReadyConfirm] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [groupConfirm, setGroupConfirm] = useState(false);
  const [editingReady, setEditingReady] = useState(false);
  const [readyDraft, setReadyDraft] = useState("");
  const [selectedPublish, setSelectedPublish] = useState<string[]>([]);
  useEffect(() => {
    if (mode === "pending") {
      if (tab !== "overview" && tab !== "ideas") setTab("overview");
    } else if (mode === "ready") {
      if (tab !== "overview") setTab("overview");
      setSelectedPublish([]);
    } else if (accountId && tab !== "overview" && tab !== "contents") {
      setTab("overview");
    }
  }, [mode, accountId, tab]);
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
  const ideas = (data.ideas || []).filter(
    (i) => !accountId || i.account_id === accountId,
  );
  const tasks = data.tasks.filter(
    (t) => !accountId || t.account_id === accountId,
  );
  const metrics = data.metrics
    .filter((m) => m.account_id === accountId)
    .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
  const countsFor = (id: string) =>
    contentCounts(data.contents.filter((c) => c.account_id === id));
  const pendingPool = contents.filter(
    (c) => c.status === "idea" || c.status === "ready",
  );
  const readyPool = contents.filter(
    (c) => c.status === "ready" || c.status === "published",
  );
  const overviewCounts = contentCounts(
    mode === "ready" ? readyPool : pendingPool,
  );
  const overviewTotal =
    mode === "ready"
      ? overviewCounts.ready + overviewCounts.published
      : overviewCounts.pending + overviewCounts.ready;
  const overviewPct = overviewTotal
    ? ((mode === "ready" ? overviewCounts.published : overviewCounts.ready) /
        overviewTotal) *
      100
    : 0;
  const groupUrl =
    contents.map((c) => safeUrl(c.publication_url)).find(Boolean) || "";
  const accountReadyCounts = contentCounts(readyPool);
  const applyReadyCount = async (n: number) => {
    const pool = [...pendingPool].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    const target = Math.max(0, Math.min(Math.floor(n), pool.length));
    const changes = pool.filter(
      (item, i) => item.status !== (i < target ? "ready" : "idea"),
    );
    for (let i = 0; i < changes.length; i += 1) {
      const item = changes[i];
      const next = pool.indexOf(item) < target ? "ready" : "idea";
      await save({
        table: "contents",
        id: item.id,
        values: { ...item, status: next },
        quiet: i < changes.length - 1,
      });
    }
  };
  const addReadyVideos = async (n: number) => {
    if (!account || n <= 0) return;
    const target = overviewCounts.ready + n;
    await applyReadyCount(Math.min(target, pendingPool.length));
    const extra = target - pendingPool.length;
    if (extra <= 0) return;
    const href = groupUrl || null;
    for (let i = 0; i < extra; i += 1) {
      await save({
        table: "contents",
        values: {
          account_id: account.id,
          title: "Pronto",
          format: "Reel",
          status: "ready",
          publication_url: href,
        },
        quiet: i < extra - 1,
      });
    }
  };
  const applyPublishedCount = async (n: number) => {
    const pool = [...readyPool].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    const target = Math.max(0, Math.min(Math.floor(n), pool.length));
    const changes = pool.filter(
      (item, i) => item.status !== (i < target ? "published" : "ready"),
    );
    for (let i = 0; i < changes.length; i += 1) {
      const item = changes[i];
      const next = pool.indexOf(item) < target ? "published" : "ready";
      await save({
        table: "contents",
        id: item.id,
        values: {
          ...item,
          status: next,
          published_at:
            next === "published"
              ? item.published_at || new Date().toISOString()
              : item.published_at,
        },
        quiet: i < changes.length - 1,
      });
    }
  };
  const openEdit = (table: EditRequest["table"], row: object) =>
    setEdit({ table, id: (row as { id: string }).id, values: { ...row } });
  const create = (
    table: EditRequest["table"],
    values: Record<string, unknown> = {},
    compact = false,
  ) =>
    setEdit({
      table,
      compact,
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
  const visibleAccounts = data.accounts.filter(
    (a) =>
      matchesSearch(a, search) &&
      (!status || a.status === status) &&
      (!device || a.responsible === device) &&
      (!model || a.category === model),
  );
  const pendingAccounts = data.accounts.filter((a) => {
    const hasPending = data.contents.some(
      (c) =>
        c.account_id === a.id &&
        c.status !== "published" &&
        c.status !== "ready",
    );
    if (!hasPending) return false;
    if (pendingAccount && a.id !== pendingAccount) return false;
    if (pendingModel && a.category !== pendingModel) return false;
    if (pendingDevice && a.responsible !== pendingDevice) return false;
    if (!pendingSearch.trim()) return true;
    const q = pendingSearch
      .replace(/^@/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return [a.username, a.category, a.responsible]
      .join(" ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .includes(q);
  });
  const fullyReadyAccountIds = new Set(
    data.accounts
      .filter((a) => {
        const items = data.contents.filter((c) => c.account_id === a.id);
        return (
          items.some((c) => c.status === "ready") &&
          !items.some(
            (c) => c.status !== "published" && c.status !== "ready",
          )
        );
      })
      .map((a) => a.id),
  );
  const readyAccounts = data.accounts.filter((a) => {
    if (!fullyReadyAccountIds.has(a.id)) return false;
    if (readyAccount && a.id !== readyAccount) return false;
    if (readyModel && a.category !== readyModel) return false;
    if (readyDevice && a.responsible !== readyDevice) return false;
    if (!readySearch.trim()) return true;
    const q = readySearch
      .replace(/^@/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return [a.username, a.category, a.responsible]
      .join(" ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .includes(q);
  });
  const form = edit && (
    <Editor
      key={`${edit.table}-${edit.id || "new"}`}
      request={edit}
      data={data}
      saving={saving}
      onClose={() => setEdit(null)}
      onDelete={
        edit.table === "ideas" && edit.id
          ? () => {
              const name =
                String(edit.values?.content || edit.values?.title || "ideia");
              const id = edit.id;
              setEdit(null);
              remove("ideas", id, name);
            }
          : undefined
      }
      onSave={async (values) => {
        if (edit.compact && edit.table === "contents" && !edit.id) {
          const qty = Math.max(1, Math.min(99, Number(values.quantity) || 1));
          const rest = { ...values };
          delete rest.quantity;
          for (let i = 0; i < qty; i += 1) {
            await save({
              table: "contents",
              values: rest,
              quiet: i < qty - 1,
            });
          }
        } else {
          await save({ table: edit.table, id: edit.id, values });
        }
        setEdit(null);
      }}
    />
  );
  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5">
      {accountId ? (
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" className="mb-2 -ml-3">
              <Link
                to={
                  group
                    ? `/instagram/pendentes/${accountId}`
                    : mode === "pending"
                      ? "/instagram/pendentes"
                      : mode === "ready"
                        ? "/instagram/prontos"
                        : "/instagram"
                }
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {group
                  ? `@${account?.username || "conta"}`
                  : mode === "pending"
                    ? "Conteúdos pendentes"
                    : mode === "ready"
                      ? "Conteúdos prontos"
                      : "Todas as contas"}
              </Link>
            </Button>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <InstagramIcon className="h-6 w-6 shrink-0" />
            {account
              ? (
                    <Handle
                      username={account.username}
                      verified={isVerified(account)}
                    />
                  )
                : "Conta não encontrada"}
          </h1>
          {account ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "pending" || mode === "ready" ? (
                <span className="min-w-0 break-words">
                  {account.category || "Sem modelo"}
                </span>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-2">
                  <PhoneIcon />
                  <span className="min-w-0 break-words">
                    {account.responsible || "Sem aparelho"}
                  </span>
                </span>
              )}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {account && mode === "pending" && !group && (
            <Button onClick={() => setReadyConfirm(true)}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Conteúdo pronto
            </Button>
          )}
          {account && mode === "ready" && !group && (
            <Button
              disabled={!selectedPublish.length}
              onClick={() => setPublishConfirm(true)}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirmar
            </Button>
          )}
          {account && mode === "accounts" && (
            <Button
              variant="destructive"
              onClick={() =>
                remove("accounts", account.id, `@${account.username}`)
              }
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Apagar conta
            </Button>
          )}
        </div>
      </header>
      ) : null}
      {!accountId && mode === "accounts" && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatLine
              icon={<User className="h-5 w-5 shrink-0 text-muted-foreground" />}
              count={data.accounts.length}
              label="contas"
            />
            <StatLine
              icon={
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-success"
                  aria-hidden="true"
                />
              }
              count={data.accounts.filter((a) => a.status === "active").length}
              label="ativas"
            />
            <StatLine
              icon={<Flame className="h-5 w-5 shrink-0 text-warning" />}
              count={data.accounts.filter((a) => a.status === "warming").length}
              label="aquecendo"
            />
          </div>
          <FilterBar
            search={search}
            onSearch={setSearch}
            label="Buscar contas"
            filters={[
              {
                label: "Status",
                value: status,
                onChange: setStatus,
                options: Object.entries(statuses),
              },
              {
                label: "Aparelho",
                value: device,
                onChange: setDevice,
                options: Object.entries(devices),
              },
              {
                label: "Modelo",
                value: model,
                onChange: setModel,
                options: Object.entries(models),
              },
            ]}
            onClear={() => {
              setSearch("");
              setStatus("");
              setDevice("");
              setModel("");
            }}
            action={
              <Button className="h-8 shrink-0" onClick={() => create("accounts")}>
                <Plus className="mr-2 h-4 w-4" />
                Nova conta
              </Button>
            }
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleAccounts.map((a) => {
              const counts = countsFor(a.id);
              return (
                      <article key={a.id} className={panel}>
                        <div className="flex items-center gap-3">
                          <Avatar url={a.avatar_url} name={a.name} />
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/instagram/conta/${a.id}`}
                              className="font-semibold hover:underline"
                            >
                              <Handle
                                username={a.username}
                                verified={isVerified(a)}
                              />
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
                        <div className="my-3 space-y-2">
                          <Status status={a.status} />
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <PhoneIcon />
                            <span className="min-w-0 break-words">
                              {a.responsible || "Sem aparelho"}
                            </span>
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {a.category || "Sem modelo"}
                          </p>
                        </div>
                        <dl className="space-y-2 text-xs">
                          <div>
                            <dt className="text-muted-foreground">
                              Conteúdos prontos
                            </dt>
                            <dd className="text-sm font-semibold">
                              {counts.ready}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Conteúdos pendentes
                            </dt>
                            <dd className="text-sm font-semibold">
                              {counts.pending}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-4">
                          <Button asChild className="w-full">
                            <Link to={`/instagram/conta/${a.id}`}>
                              Gerenciar
                            </Link>
                          </Button>
                        </div>
                      </article>
              );
            })}
          </div>
        </>
      )}
      {!accountId && mode === "pending" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatLine
              icon={
                <Hourglass className="h-5 w-5 shrink-0 text-muted-foreground" />
              }
              count={
                data.contents.filter(
                  (c) => c.status !== "published" && c.status !== "ready",
                ).length
              }
              label="conteúdos pendentes totais"
            />
            <StatLine
              icon={<User className="h-5 w-5 shrink-0 text-muted-foreground" />}
              count={
                new Set(
                  data.contents
                    .filter(
                      (c) => c.status !== "published" && c.status !== "ready",
                    )
                    .map((c) => c.account_id),
                ).size
              }
              label="contas pendentes"
            />
          </div>
          <FilterBar
            search={pendingSearch}
            onSearch={setPendingSearch}
            label="Buscar conteúdos pendentes"
            filters={[
              {
                label: "Conta",
                value: pendingAccount,
                onChange: setPendingAccount,
                options: data.accounts
                  .filter((a) =>
                    data.contents.some(
                      (c) =>
                        c.account_id === a.id &&
                        c.status !== "published" &&
                        c.status !== "ready",
                    ),
                  )
                  .sort((a, b) => a.username.localeCompare(b.username))
                  .map((a) => [a.id, `@${a.username}`]),
              },
              {
                label: "Aparelho",
                value: pendingDevice,
                onChange: setPendingDevice,
                options: Object.entries(devices),
              },
              {
                label: "Modelo",
                value: pendingModel,
                onChange: setPendingModel,
                options: Object.entries(models),
              },
            ]}
            onClear={() => {
              setPendingSearch("");
              setPendingModel("");
              setPendingAccount("");
              setPendingDevice("");
            }}
            action={
              <Button
                className="h-8 shrink-0"
                disabled={!data.accounts.length}
                onClick={() => create("contents", { status: "idea" }, true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Novo Conteúdo
              </Button>
            }
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {pendingAccounts.map((a) => {
              const pool = data.contents.filter(
                (c) =>
                  c.account_id === a.id &&
                  (c.status === "idea" || c.status === "ready"),
              );
              const counts = contentCounts(pool);
              const total = counts.pending + counts.ready;
              return (
                <article key={a.id} className={panel}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xl font-bold leading-tight">
                        <Handle
                          username={a.username}
                          verified={isVerified(a)}
                        />
                      </p>
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {a.category || "Sem modelo"}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <PhoneIcon />
                        <span className="min-w-0 break-words">
                          {a.responsible || "Sem aparelho"}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <p className="text-sm tabular-nums">
                        <span className="opacity-40">{counts.pending}</span>
                        <span className="opacity-40">/</span>
                        <span className="font-semibold">{counts.ready}</span>
                      </p>
                      <ProgressRing
                        className="h-16 w-16"
                        value={total ? (counts.ready / total) * 100 : 0}
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button asChild className="w-full">
                      <Link to={`/instagram/pendentes/${a.id}`}>
                        Gerenciar conteúdo
                      </Link>
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          {pendingAccounts.length === 0 && (
            <Empty>
              {data.contents.some(
                (c) => c.status !== "published" && c.status !== "ready",
              )
                ? "Nenhuma conta corresponde aos filtros."
                : "Nenhuma conta com conteúdo pendente. Use Novo Conteúdo para adicionar."}
            </Empty>
          )}
        </>
      )}
      {!accountId && mode === "ready" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatLine
              icon={
                <CheckCircle2 className="h-5 w-5 shrink-0 text-muted-foreground" />
              }
              count={
                data.contents.filter(
                  (c) =>
                    c.status === "ready" &&
                    fullyReadyAccountIds.has(c.account_id),
                ).length
              }
              label="conteúdos prontos totais"
            />
            <StatLine
              icon={<User className="h-5 w-5 shrink-0 text-muted-foreground" />}
              count={fullyReadyAccountIds.size}
              label="contas prontas"
            />
          </div>
          <FilterBar
            search={readySearch}
            onSearch={setReadySearch}
            label="Buscar conteúdos prontos"
            filters={[
              {
                label: "Conta",
                value: readyAccount,
                onChange: setReadyAccount,
                options: data.accounts
                  .filter((a) => fullyReadyAccountIds.has(a.id))
                  .sort((a, b) => a.username.localeCompare(b.username))
                  .map((a) => [a.id, `@${a.username}`]),
              },
              {
                label: "Aparelho",
                value: readyDevice,
                onChange: setReadyDevice,
                options: Object.entries(devices),
              },
              {
                label: "Modelo",
                value: readyModel,
                onChange: setReadyModel,
                options: Object.entries(models),
              },
            ]}
            onClear={() => {
              setReadySearch("");
              setReadyModel("");
              setReadyAccount("");
              setReadyDevice("");
            }}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {readyAccounts.map((a) => {
              const pool = data.contents.filter(
                (c) =>
                  c.account_id === a.id &&
                  (c.status === "ready" || c.status === "published"),
              );
              const counts = contentCounts(pool);
              const total = counts.ready + counts.published;
              return (
                <article key={a.id} className={panel}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xl font-bold leading-tight">
                        <Handle
                          username={a.username}
                          verified={isVerified(a)}
                        />
                      </p>
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {a.category || "Sem modelo"}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <PhoneIcon />
                        <span className="min-w-0 break-words">
                          {a.responsible || "Sem aparelho"}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <p className="text-sm tabular-nums">
                        <span className="opacity-40">{counts.ready}</span>
                        <span className="opacity-40">/</span>
                        <span className="font-semibold">
                          {counts.published}
                        </span>
                      </p>
                      <ProgressRing
                        className="h-16 w-16"
                        value={total ? (counts.published / total) * 100 : 0}
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button asChild className="w-full">
                      <Link to={`/instagram/prontos/${a.id}`}>
                        Gerenciar conteúdo
                      </Link>
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          {readyAccounts.length === 0 && (
            <Empty>
              {fullyReadyAccountIds.size
                ? "Nenhuma conta corresponde aos filtros."
                : "Nenhuma conta com conteúdos 100% prontos. Termine os pendentes primeiro."}
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
      {account && mode === "pending" && group && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Grupo {group}</h2>
          {contents.filter((c) => c.title === group).length === 0 && (
            <Empty>Nenhum conteúdo neste grupo.</Empty>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {contents
              .filter((c) => c.title === group)
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map(contentRow)}
          </div>
        </div>
      )}
      {account && mode === "pending" && !group && (
        <>
          <nav aria-label="Abas da conta" className="flex flex-wrap items-center gap-1">
            {[
              ["overview", "Conteúdos"],
              ["ideas", "Ideias"],
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
            <button
              type="button"
              disabled={!groupUrl}
              onClick={() => setGroupConfirm(true)}
              className="ml-auto flex items-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-medium text-foreground disabled:opacity-40"
            >
              <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Grupo de vídeos
            </button>
          </nav>
          {tab === "overview" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <StatLine
                  dim
                  icon={
                    <Hourglass className="h-5 w-5 shrink-0 text-muted-foreground" />
                  }
                  count={overviewCounts.pending}
                  label="pendentes"
                />
                {editingReady ? (
                  <form
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-4 py-3.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void applyReadyCount(Number(readyDraft) || 0).then(
                        () => setEditingReady(false),
                      );
                    }}
                  >
                    <Input
                      className="h-10 w-20"
                      inputMode="numeric"
                      aria-label="Conteúdos prontos"
                      value={readyDraft}
                      onChange={(e) =>
                        setReadyDraft(e.target.value.replace(/\D/g, ""))
                      }
                      autoFocus
                    />
                    <Button type="submit" size="sm" disabled={saving}>
                      Ok
                    </Button>
                    {[2, 5, 10].map((n) => (
                      <Button
                        key={n}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => {
                          const next = overviewCounts.ready + n;
                          setReadyDraft(String(next));
                          void addReadyVideos(n).then(() =>
                            setEditingReady(false),
                          );
                        }}
                      >
                        +{n}
                      </Button>
                    ))}
                  </form>
                ) : (
                  <StatLine
                    icon={
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                    }
                    count={overviewCounts.ready}
                    label="prontos"
                    action={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label="Editar conteúdos prontos"
                        onClick={() => {
                          setReadyDraft(String(overviewCounts.ready));
                          setEditingReady(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                )}
              </div>
              <div className={`${panel} flex items-center gap-4`}>
                <ProgressRing value={overviewPct} />
                <div>
                  <p className="text-3xl font-semibold tabular-nums">
                    {Math.round(overviewPct)}%
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Concluído
                  </p>
                </div>
              </div>
            </div>
          )}
          {tab === "ideas" && (
            <>
              <Button onClick={() => create("ideas")}>
                <Plus className="mr-2 h-4 w-4" />
                Nova ideia
              </Button>
              {!ideas.length && (
                <Empty>Nenhuma ideia nesta conta.</Empty>
              )}
              <div className="space-y-3">
                {[...ideas]
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .map((idea) => (
                    <article
                      key={idea.id}
                      className="min-w-0 cursor-pointer rounded-lg border border-border bg-card p-5 text-left"
                      onClick={() => openEdit("ideas", idea)}
                    >
                      <p className="whitespace-pre-wrap break-words text-base leading-relaxed line-clamp-6">
                        {idea.content || idea.title}
                      </p>
                    </article>
                  ))}
              </div>
            </>
          )}
        </>
      )}
      {account && mode === "ready" && (
        <>
          <nav
            aria-label="Abas da conta"
            className="flex flex-wrap items-center gap-1"
          >
            <Button variant="secondary" aria-pressed>
              Conteúdos
            </Button>
            <button
              type="button"
              disabled={!groupUrl}
              onClick={() => setGroupConfirm(true)}
              className="ml-auto flex items-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-medium text-foreground disabled:opacity-40"
            >
              <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Grupo de vídeos
            </button>
          </nav>
          <div className="space-y-3">
            {readyPool.length === 0 ? (
              <Empty>Nenhum vídeo nesta conta.</Empty>
            ) : (
              [...readyPool]
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .map((item, i) => {
                  const posted = item.status === "published";
                  const checked =
                    posted || selectedPublish.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      className={`${panel} flex cursor-pointer items-center gap-3 ${posted ? "opacity-70" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0"
                        checked={checked}
                        disabled={posted || saving}
                        onChange={() =>
                          setSelectedPublish((cur) =>
                            cur.includes(item.id)
                              ? cur.filter((id) => id !== item.id)
                              : [...cur, item.id],
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 font-medium">
                        Video {i + 1}
                      </span>
                      {posted ? (
                        <span className="text-xs text-muted-foreground">
                          Publicado
                        </span>
                      ) : null}
                    </label>
                  );
                })
            )}
            <Button
              disabled={!selectedPublish.length || saving}
              onClick={() => setPublishConfirm(true)}
            >
              Confirmar
            </Button>
          </div>
        </>
      )}
      {account && mode === "accounts" && (
        <>
          <nav aria-label="Abas da conta" className="flex flex-wrap gap-1">
            {[
              ["overview", "Informações"],
              ["contents", "Conteúdos"],
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
                <div className="mb-4 flex items-center gap-3">
                  <Avatar url={account.avatar_url} name={account.username} />
                  <div className="min-w-0">
                    <p className="font-semibold">
                      <Handle
                        username={account.username}
                        verified={isVerified(account)}
                      />
                    </p>
                    <div className="mt-1">
                      <Status status={account.status} />
                    </div>
                  </div>
                </div>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {[
                    ["Status", statuses[account.status]],
                    [
                      "Conta verificada?",
                      verifiedLabel(account.niche),
                    ],
                    ["E-mail associado", account.email],
                    ["Número associado", account.phone],
                    ["Aparelho", account.responsible],
                    ["Modelo", account.category],
                    [
                      "Data de criação da conta",
                      account.account_created_on
                        ? displayDate(account.account_created_on)
                        : "",
                    ],
                    ["Observações", account.notes],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className={
                        k === "Observações" ? "min-w-0 sm:col-span-2" : "min-w-0"
                      }
                    >
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">
                        {k === "Status" ? (
                          <span className="inline-flex items-center gap-1.5">
                            {(account.status === "warming" ||
                              account.status === "attention") && (
                              <Flame className="h-3.5 w-3.5 text-warning" />
                            )}
                            {v || "Não informado"}
                          </span>
                        ) : (
                          v || "Não informado"
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <Button
                  className="mt-4"
                  onClick={() => openEdit("accounts", account)}
                >
                  Editar conta
                </Button>
              </div>
            </>
          )}
          {tab === "contents" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={panel}>
                <p className="font-medium">Conteúdos pendentes</p>
                <div className="mt-4 flex items-center gap-5">
                  <ProgressRing
                    value={
                      overviewTotal
                        ? (overviewCounts.ready / overviewTotal) * 100
                        : 0
                    }
                  />
                  <div>
                    <p className="text-lg tabular-nums">
                      <span className="opacity-40">
                        {overviewCounts.pending}
                      </span>
                      <span className="opacity-40">/</span>
                      <span className="font-semibold">
                        {overviewCounts.ready}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      pendentes / prontos
                    </p>
                  </div>
                </div>
              </div>
              <div className={panel}>
                <p className="font-medium">Conteúdos prontos</p>
                <div className="mt-4 flex items-center gap-5">
                  <ProgressRing
                    value={
                      accountReadyCounts.ready + accountReadyCounts.published
                        ? (accountReadyCounts.published /
                            (accountReadyCounts.ready +
                              accountReadyCounts.published)) *
                          100
                        : 0
                    }
                  />
                  <div>
                    <p className="text-lg tabular-nums">
                      <span className="opacity-40">
                        {accountReadyCounts.ready}
                      </span>
                      <span className="opacity-40">/</span>
                      <span className="font-semibold">
                        {accountReadyCounts.published}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      prontos / publicados
                    </p>
                  </div>
                </div>
              </div>
            </div>
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
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Username</dt>
                    <dd className="text-sm">
                      <Handle
                        username={account.username}
                        verified={isVerified(account)}
                      />
                    </dd>
                  </div>
                  {[
                    [
                      "Conta verificada?",
                      verifiedLabel(account.niche),
                    ],
                    ["E-mail", account.email],
                    ["Número", account.phone],
                    ["Aparelho", account.responsible],
                    ["Modelo", account.category],
                    ["Criada em", displayDate(account.account_created_on)],
                    ["Status", statuses[account.status]],
                    ["Observações", account.notes],
                  ].map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">
                        {k === "Status" ? (
                          <span className="inline-flex items-center gap-1.5">
                            {(account.status === "warming" ||
                              account.status === "attention") && (
                              <Flame className="h-3.5 w-3.5 text-warning" />
                            )}
                            {v || "Não informado"}
                          </span>
                        ) : (
                          v || "Não informado"
                        )}
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
                      instagram_ideas: "Ideia",
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
        open={groupConfirm}
        onOpenChange={(open) => {
          if (!open) setGroupConfirm(false);
        }}
      >
        <DialogContent className="w-[calc(100%_-_1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Abrir grupo de vídeos</DialogTitle>
            <DialogDescription>
              Continuar para o grupo de vídeos desta conta?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setGroupConfirm(false)}>
              Não
            </Button>
            <Button
              onClick={() => {
                if (groupUrl) window.open(groupUrl, "_blank", "noopener,noreferrer");
                setGroupConfirm(false);
              }}
            >
              Continuar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={publishConfirm}
        onOpenChange={(open) => {
          if (!open && !saving) setPublishConfirm(false);
        }}
      >
        <DialogContent className="w-[calc(100%_-_1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar publicação</DialogTitle>
            <DialogDescription>
              {`Marcar ${selectedPublish.length} vídeo${selectedPublish.length === 1 ? "" : "s"} como publicado?`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setPublishConfirm(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={saving || !selectedPublish.length}
              onClick={async () => {
                const ids = selectedPublish;
                for (let i = 0; i < ids.length; i += 1) {
                  const item = readyPool.find((c) => c.id === ids[i]);
                  if (!item) continue;
                  await save({
                    table: "contents",
                    id: item.id,
                    values: {
                      ...item,
                      status: "published",
                      published_at:
                        item.published_at || new Date().toISOString(),
                    },
                    quiet: i < ids.length - 1,
                  });
                }
                setSelectedPublish([]);
                setPublishConfirm(false);
              }}
            >
              {saving ? "Salvando…" : "Confirmar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={readyConfirm}
        onOpenChange={(open) => {
          if (!open && !saving) setReadyConfirm(false);
        }}
      >
        <DialogContent className="w-[calc(100%_-_1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar conteúdo pronto</DialogTitle>
            <DialogDescription>
              Marcar os conteúdos pendentes desta conta como prontos?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setReadyConfirm(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                await applyReadyCount(pendingPool.length);
                setReadyConfirm(false);
              }}
            >
              {saving ? "Salvando…" : "Confirmar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
                ? "Os conteúdos, ideias, tarefas, métricas e histórico desta conta também serão excluídos."
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
