import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CheckSquare,
  Clock,
  ImageIcon,
  Instagram,
  Network,
  StickyNote
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";

const ARCHIVED_TAG = "__organizafy_archived__";

interface DashboardTask {
  id: string;
  title: string;
  status: string | null;
  due_date: string | null;
  priority: string | null;
  is_fixed_daily: boolean | null;
  completed_at: string | null;
  created_at: string;
}

interface DashboardNote {
  id: string;
  title: string;
  updated_at: string;
  tags: string[] | null;
}

interface DashboardData {
  todayPending: number;
  todayDone: number;
  overdue: number;
  activeNoteCount: number;
  archivedNoteCount: number;
  mapCount: number;
  focusTasks: DashboardTask[];
  recentNotes: DashboardNote[];
}

interface QuickAction {
  label: string;
  description: string;
  icon: React.ElementType;
  path: string;
}

const quickActions: QuickAction[] = [
  { label: "Tarefas", description: "Organize seu dia", icon: CheckSquare, path: "/tarefas" },
  { label: "Notas", description: "Ideias e textos", icon: StickyNote, path: "/notas" },
  { label: "Mapas", description: "Planeje visualmente", icon: Network, path: "/mapas" },
  { label: "Mídia", description: "Arquivos e pastas", icon: ImageIcon, path: "/midia" },
  { label: "Instagram", description: "Conteúdo e contas", icon: Instagram, path: "/instagram" }
];

function safeTimeZone(value?: string | null) {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value || "America/Sao_Paulo" }).format(new Date());
    return value || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  path,
  attention = false
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ElementType;
  path: string;
  attention?: boolean;
}) {
  return (
    <Link
      to={path}
      className="group rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-card-hover sm:p-5"
    >
      <div className="mb-5 flex items-start justify-between">
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary",
          attention && "text-destructive"
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
      </div>
      <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm font-medium text-foreground/90">{title}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
    </Link>
  );
}

const Dashboard = () => {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileTimezone, setProfileTimezone] = useState("America/Sao_Paulo");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const [tasksRes, notesRes, mapsRes, profileRes] = await Promise.all([
        (supabase.from("tasks") as any)
          .select("id, title, status, due_date, priority, is_fixed_daily, completed_at, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        (supabase.from("notes") as any)
          .select("id, title, updated_at, tags")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),
        (supabase.from("mind_maps") as any)
          .select("id")
          .eq("user_id", user.id),
        (supabase.from("profiles") as any)
          .select("display_name, timezone")
          .eq("user_id", user.id)
          .maybeSingle()
      ]);

      if (cancelled) return;

      const timeZone = safeTimeZone(profileRes.data?.timezone);
      const today = dayKey(new Date(), timeZone);
      const tasks = (tasksRes.data || []) as DashboardTask[];
      const notes = (notesRes.data || []) as DashboardNote[];

      const todayPending = tasks.filter(
        (task) => task.due_date === today && task.status !== "done"
      );

      const todayDone = tasks.filter((task) => {
        if (task.status !== "done") return false;
        if (task.completed_at) {
          return dayKey(new Date(task.completed_at), timeZone) === today;
        }
        return task.due_date === today;
      });

      const overdue = tasks.filter(
        (task) => task.status !== "done" && !!task.due_date && task.due_date < today
      );

      const activeNotes = notes.filter(
        (note) => !(note.tags || []).includes(ARCHIVED_TAG)
      );

      const priorityOrder: Record<string, number> = {
        high: 3,
        medium: 2,
        low: 1
      };

      const focusTasks = tasks
        .filter((task) => task.status !== "done")
        .sort((a, b) => {
          const aOverdue = !!a.due_date && a.due_date < today ? 1 : 0;
          const bOverdue = !!b.due_date && b.due_date < today ? 1 : 0;
          if (aOverdue !== bOverdue) return bOverdue - aOverdue;

          const priorityDifference =
            (priorityOrder[b.priority || "low"] || 0) -
            (priorityOrder[a.priority || "low"] || 0);
          if (priorityDifference) return priorityDifference;

          const aToday = a.due_date === today ? 1 : 0;
          const bToday = b.due_date === today ? 1 : 0;
          if (aToday !== bToday) return bToday - aToday;

          if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return b.created_at.localeCompare(a.created_at);
        })
        .slice(0, 5);

      setProfileName(profileRes.data?.display_name || "");
      setProfileTimezone(timeZone);
      setData({
        todayPending: todayPending.length,
        todayDone: todayDone.length,
        overdue: overdue.length,
        activeNoteCount: activeNotes.length,
        archivedNoteCount: notes.length - activeNotes.length,
        mapCount: mapsRes.data?.length || 0,
        focusTasks,
        recentNotes: activeNotes.slice(0, 4)
      });
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const timeZone = safeTimeZone(profileTimezone);
  const today = useMemo(() => dayKey(now, timeZone), [now, timeZone]);

  const greeting = useMemo(() => {
    const hour = Number(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone,
        hour: "2-digit",
        hour12: false
      }).format(now)
    );

    if (hour < 5) return "Boa madrugada";
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  }, [now, timeZone]);

  const displayName = useMemo(() => {
    if (profileName.trim()) return profileName.trim().split(/\s+/)[0];

    const metadataName = user?.user_metadata?.display_name;
    if (typeof metadataName === "string" && metadataName.trim()) {
      return metadataName.trim().split(/\s+/)[0];
    }

    return user?.email?.split("@")[0]?.trim() || "você";
  }, [profileName, user]);

  const formattedDate = useMemo(() => {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    })
      .format(now)
      .toLocaleUpperCase("pt-BR");
  }, [now, timeZone]);

  if (loading || !data) {
    return (
      <div className="mx-auto min-w-0 max-w-6xl space-y-5 sm:space-y-6">
        <div className="h-36 animate-pulse rounded-xl border border-border bg-card" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-36 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.45fr_0.85fr]">
          <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
          <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      </div>
    );
  }

  const totalToday = data.todayPending + data.todayDone;
  const progress = totalToday
    ? Math.round((data.todayDone / totalToday) * 100)
    : 0;

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_19rem] lg:items-center lg:gap-8">
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[10px]">
              {formattedDate}
            </p>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {greeting},{" "}
              <span
                className="text-foreground/70"
                style={{ textShadow: "0 0 10px rgba(255,255,255,0.10)" }}
              >
                {displayName}
              </span>
            </h1>

            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              {data.overdue > 0
                ? "Você tem " + data.overdue + (data.overdue === 1 ? " tarefa atrasada para revisar." : " tarefas atrasadas para revisar.")
                : data.todayPending > 0
                  ? data.todayPending + (data.todayPending === 1 ? " tarefa pendente para hoje." : " tarefas pendentes para hoje.")
                  : "Seu dia está sem pendências programadas."}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/tarefas"
                className="flex h-10 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <CheckSquare className="h-4 w-4" /> Tarefas
              </Link>
              <Link
                to="/notas"
                className="flex h-10 items-center gap-2 rounded-md bg-secondary px-3.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <StickyNote className="h-4 w-4" /> Notas
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background/45 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Progresso de hoje</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{progress}%</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {data.todayDone} concluída{data.todayDone === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  de {totalToday} para hoje
                </p>
              </div>
            </div>

            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-foreground/70 transition-all duration-500"
                style={{ width: String(progress) + "%" }}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-secondary/55 px-3 py-2.5">
                <p className="text-lg font-semibold text-foreground">{data.todayPending}</p>
                <p className="text-[10px] text-muted-foreground">Pendentes</p>
              </div>
              <div className="rounded-lg bg-secondary/55 px-3 py-2.5">
                <p className="text-lg font-semibold text-foreground">{data.todayDone}</p>
                <p className="text-[10px] text-muted-foreground">Concluídas</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title="Pendentes hoje"
          value={data.todayPending}
          subtitle="Com prazo para hoje"
          icon={Clock}
          path="/tarefas"
        />
        <StatCard
          title="Concluídas hoje"
          value={data.todayDone}
          subtitle="Finalizadas durante o dia"
          icon={CheckCircle2}
          path="/tarefas"
        />
        <StatCard
          title="Atrasadas"
          value={data.overdue}
          subtitle={data.overdue ? "Precisam de atenção" : "Nenhum atraso"}
          icon={AlertTriangle}
          path="/tarefas"
          attention={data.overdue > 0}
        />
        <StatCard
          title="Notas ativas"
          value={data.activeNoteCount}
          subtitle={data.archivedNoteCount + " arquivada" + (data.archivedNoteCount === 1 ? "" : "s")}
          icon={StickyNote}
          path="/notas"
        />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.45fr_0.85fr]">
        <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Foco agora</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Atrasos e prioridades aparecem primeiro.
              </p>
            </div>
            <Link
              to="/tarefas"
              className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Ver tarefas →
            </Link>
          </div>

          {data.focusTasks.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
              <CheckCircle2 className="mb-3 h-7 w-7 text-muted-foreground/45" />
              <p className="text-sm font-medium text-foreground">Tudo em ordem</p>
              <p className="mt-1 text-xs text-muted-foreground">Nenhuma tarefa pendente no momento.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {data.focusTasks.map((task) => {
                const overdue = !!task.due_date && task.due_date < today;
                const dueToday = task.due_date === today;

                return (
                  <Link
                    key={task.id}
                    to="/tarefas"
                    className="group flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        overdue
                          ? "bg-destructive"
                          : task.priority === "high"
                            ? "bg-warning"
                            : "bg-muted-foreground/50"
                      )}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{task.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[10px] text-muted-foreground">
                          {overdue
                            ? "Atrasada"
                            : dueToday
                              ? "Hoje"
                              : task.due_date
                                ? new Date(task.due_date + "T12:00:00").toLocaleDateString("pt-BR")
                                : "Sem prazo"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70">
                          {task.priority === "high"
                            ? "Prioridade alta"
                            : task.priority === "medium"
                              ? "Prioridade média"
                              : "Prioridade baixa"}
                        </span>
                        {task.is_fixed_daily && (
                          <span className="text-[10px] text-muted-foreground/70">Fixa diária</span>
                        )}
                      </div>
                    </div>

                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Últimas notas</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Continue de onde parou.</p>
            </div>
            <Link
              to="/notas"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Ver todas →
            </Link>
          </div>

          {data.recentNotes.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center text-center">
              <StickyNote className="mb-3 h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhuma nota ativa</p>
            </div>
          ) : (
            <div className="space-y-1">
              {data.recentNotes.map((note) => (
                <Link
                  key={note.id}
                  to="/notas"
                  className="group flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/45"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                    <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{note.title}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {dayKey(new Date(note.updated_at), timeZone) === today
                        ? "Atualizada hoje"
                        : new Date(note.updated_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/35 transition-colors group-hover:text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Acesso rápido</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Entre direto nas áreas que você mais usa.
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {data.mapCount} {data.mapCount === 1 ? "mapa mental salvo" : "mapas mentais salvos"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.path}
                to={action.path}
                className="group rounded-lg border border-border bg-background/35 p-3 transition-all hover:border-foreground/20 hover:bg-accent/35"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                    <Icon className="h-4 w-4 text-foreground/80" />
                  </div>
                  <ArrowUpRight className="h-3 w-3 text-muted-foreground/35 transition-colors group-hover:text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">{action.label}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {action.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
