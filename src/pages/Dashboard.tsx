import { InstagramOverview } from "@/features/instagram-publisher/InstagramOverview";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CalendarDays,
  ArrowRight,
  StickyNote,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link, Navigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { getWorkspaceMode, type WorkspaceMode } from "@/features/agonia/schedule";

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
  focusTasks: DashboardTask[];
  recentNotes: DashboardNote[];
  activity: { date: string; label: string; completed: number }[];
}

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
    day: "2-digit",
  }).format(date);
}

function StatItem({
  title,
  value,
  subtitle,
  icon: Icon,
  path,
  attention = false,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ElementType;
  path: string;
  attention?: boolean;
}) {
  return (
    <Link to={path} className="stat group">
      <div className="stat-label">
        <span>{title}</span>
        <Icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", attention && "text-destructive")} />
      </div>
      <p className="stat-value">{value.toLocaleString("pt-BR")}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="stat-hint">{subtitle}</span>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
      </div>
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
  const [period, setPeriod] = useState<7 | 30>(7);
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(() =>
    getWorkspaceMode(),
  );

  useEffect(() => {
    const onModeChange = (event: Event) => {
      const custom = event as CustomEvent<WorkspaceMode>;
      setWorkspaceModeState(custom.detail || getWorkspaceMode());
    };
    window.addEventListener("organizafy-mode-changed", onModeChange);
    return () =>
      window.removeEventListener("organizafy-mode-changed", onModeChange);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user || workspaceMode === "agonia") return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const [tasksRes, notesRes, profileRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, title, status, due_date, priority, is_fixed_daily, completed_at, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("notes")
          .select("id, title, updated_at, tags")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("display_name, timezone")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      const timeZone = safeTimeZone(profileRes.data?.timezone);
      const today = dayKey(new Date(), timeZone);
      const tasks = (tasksRes.data || []) as DashboardTask[];
      const notes = (notesRes.data || []) as DashboardNote[];

      const todayPending = tasks.filter(
        (task) => task.due_date === today && task.status !== "done",
      );

      const todayDone = tasks.filter((task) => {
        if (task.status !== "done") return false;
        if (task.completed_at) {
          return dayKey(new Date(task.completed_at), timeZone) === today;
        }
        return task.due_date === today;
      });

      const overdue = tasks.filter(
        (task) => task.status !== "done" && !!task.due_date && task.due_date < today,
      );

      const activeNotes = notes.filter(
        (note) => !(note.tags || []).includes(ARCHIVED_TAG),
      );

      const activityDateFormat = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const activityLabelFormat = new Intl.DateTimeFormat("pt-BR", {
        timeZone,
        day: "2-digit",
        month: "2-digit",
      });
      const completionsByDay = new Map<string, number>();
      for (const task of tasks) {
        if (task.status !== "done") continue;
        const key = task.completed_at
          ? activityDateFormat.format(new Date(task.completed_at))
          : task.due_date;
        if (key) completionsByDay.set(key, (completionsByDay.get(key) || 0) + 1);
      }
      const activity = Array.from({ length: 30 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (29 - index));
        const key = activityDateFormat.format(date);
        return {
          date: key,
          label: activityLabelFormat.format(date),
          completed: completionsByDay.get(key) || 0,
        };
      });

      const priorityOrder: Record<string, number> = {
        high: 3,
        medium: 2,
        low: 1,
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
        focusTasks,
        recentNotes: activeNotes.slice(0, 4),
        activity,
      });
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [user, workspaceMode]);

  const timeZone = safeTimeZone(profileTimezone);
  const today = useMemo(() => dayKey(now, timeZone), [now, timeZone]);

  const greeting = useMemo(() => {
    const hour = Number(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone,
        hour: "2-digit",
        hour12: false,
      }).format(now),
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
    }).format(now);
  }, [now, timeZone]);

  if (workspaceMode === "agonia") {
    return <Navigate to="/disparo" replace />;
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-xl border border-border bg-card" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
          <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      </div>
    );
  }

  const totalToday = data.todayPending + data.todayDone;
  const progress = totalToday ? Math.round((data.todayDone / totalToday) * 100) : 0;

  const activity = data.activity.slice(-period);
  const completedInPeriod = activity.reduce((total, day) => total + day.completed, 0);

  const summaryLine =
    data.overdue > 0
      ? `${data.overdue} tarefa${data.overdue === 1 ? " atrasada" : "s atrasadas"} · ${data.todayPending} para hoje.`
      : data.todayPending > 0
        ? `${data.todayPending} tarefa${data.todayPending === 1 ? " pendente" : "s pendentes"} para hoje.`
        : "Tudo em dia por aqui.";

  return (
    <div className="dashboard-page space-y-5">
      {/* Header (single greeting, single CTA) */}
      <header className="page-header">
        <div>
          <h1 className="page-title">
            {greeting}, {displayName}
          </h1>
          <p className="page-subtitle">{summaryLine}</p>
        </div>
        <div className="page-actions">
          <span className="chip capitalize">
            <CalendarDays className="h-3.5 w-3.5" />
            {formattedDate}
          </span>
          <Link
            to="/tarefas"
            className="silver-button inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-medium"
          >
            Ver tarefas <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* KPI Strip */}
      <div className="stat-grid">
        <StatItem
          title="Pendentes hoje"
          value={data.todayPending}
          subtitle="Com prazo para hoje"
          icon={Clock}
          path="/tarefas"
        />
        <StatItem
          title="Concluídas hoje"
          value={data.todayDone}
          subtitle={`${progress}% do dia`}
          icon={CheckCircle2}
          path="/tarefas"
        />
        <StatItem
          title="Atrasadas"
          value={data.overdue}
          subtitle={data.overdue ? "Precisam de atenção" : "Nenhum atraso"}
          icon={AlertTriangle}
          path="/tarefas"
          attention={data.overdue > 0}
        />
        <StatItem
          title="Notas ativas"
          value={data.activeNoteCount}
          subtitle={`${data.archivedNoteCount} arquivada${data.archivedNoteCount === 1 ? "" : "s"}`}
          icon={StickyNote}
          path="/notas"
        />
      </div>

      {/* Focus now + Recent notes */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="panel min-w-0">
          <div className="panel-head">
            <div>
              <h2 className="section-title">Foco agora</h2>
              <p className="section-subtitle">Atrasos e prioridades primeiro</p>
            </div>
            <Link to="/tarefas" className="panel-link">
              Todas <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="panel-body">
            {data.focusTasks.length === 0 ? (
              <div className="empty-state">
                <CheckCircle2 className="h-6 w-6 text-muted-foreground/50" />
                <strong>Tudo em ordem</strong>
                <span>Nenhuma tarefa pendente no momento.</span>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.focusTasks.map((task) => {
                  const overdue = !!task.due_date && task.due_date < today;
                  const dueToday = task.due_date === today;

                  return (
                    <Link
                      key={task.id}
                      to="/tarefas"
                      className="group flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          overdue
                            ? "bg-destructive"
                            : task.priority === "high"
                              ? "bg-warning"
                              : "bg-muted-foreground/50",
                        )}
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{task.title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>
                            {overdue
                              ? "Atrasada"
                              : dueToday
                                ? "Hoje"
                                : task.due_date
                                  ? new Date(task.due_date + "T12:00:00").toLocaleDateString("pt-BR")
                                  : "Sem prazo"}
                          </span>
                          <span>·</span>
                          <span>
                            {task.priority === "high"
                              ? "Alta"
                              : task.priority === "medium"
                                ? "Média"
                                : "Baixa"}
                          </span>
                          {task.is_fixed_daily && (
                            <>
                              <span>·</span>
                              <span>Diária</span>
                            </>
                          )}
                        </div>
                      </div>

                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="panel min-w-0">
          <div className="panel-head">
            <div>
              <h2 className="section-title">Últimas notas</h2>
              <p className="section-subtitle">Continue de onde parou</p>
            </div>
            <Link to="/notas" className="panel-link">
              Todas <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="panel-body">
            {data.recentNotes.length === 0 ? (
              <div className="empty-state">
                <StickyNote className="h-6 w-6 text-muted-foreground/50" />
                <strong>Nenhuma nota ativa</strong>
                <span>Suas anotações recentes aparecem aqui.</span>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.recentNotes.map((note) => (
                  <Link
                    key={note.id}
                    to="/notas"
                    className="group flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                      <StickyNote className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{note.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {dayKey(new Date(note.updated_at), timeZone) === today
                          ? "Atualizada hoje"
                          : new Date(note.updated_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Instagram pulse strip */}
      <InstagramOverview />

      {/* Activity chart */}
      <section className="panel min-w-0 overflow-hidden" aria-label="Histórico de tarefas concluídas">
        <div className="panel-head">
          <div>
            <h2 className="section-title">Ritmo de entregas</h2>
            <p className="section-subtitle">
              {completedInPeriod.toLocaleString("pt-BR")} concluída{completedInPeriod === 1 ? "" : "s"} nos últimos {period} dias
            </p>
          </div>
          <div className="segmented" role="group" aria-label="Período do gráfico">
            {([7, 30] as const).map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={period === days}
                onClick={() => setPeriod(days)}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        <div
          className="activity-chart px-4 py-4"
          role="img"
          aria-label={`${completedInPeriod} tarefas concluídas nos últimos ${period} dias`}
        >
          {(() => {
            const maxVal = Math.max(1, ...activity.map((point) => point.completed));
            return (
              <div className="flex h-36 items-end gap-1.5 sm:gap-2">
                {activity.map((point, index) => {
                  const pct = point.completed > 0 ? Math.max(10, Math.round((point.completed / maxVal) * 100)) : 4;
                  const showLabel =
                    period === 7 || index === 0 || index === activity.length - 1 || index % 5 === 0;
                  return (
                    <div
                      key={point.date}
                      className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                      title={`${point.label}: ${point.completed} concluída${point.completed === 1 ? "" : "s"}`}
                    >
                      <div className="relative flex w-full flex-1 items-end">
                        <div
                          className={cn(
                            "w-full rounded-t-[4px] transition-colors",
                            point.completed > 0
                              ? "bg-primary/80 group-hover:bg-primary"
                              : "bg-border/70 group-hover:bg-muted-foreground/40",
                          )}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <span className="h-3.5 truncate text-[10px] tabular-nums text-muted-foreground">
                        {showLabel ? point.label : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
