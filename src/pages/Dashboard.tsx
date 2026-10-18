import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CheckSquare,
  Clock,
  Instagram,
  Network,
  Presentation,
  CalendarDays,
  ArrowRight,
  StickyNote
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
  activity: { date: string; label: string; completed: number }[];
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
  { label: "Slides", description: "Apresente suas ideias", icon: Presentation, path: "/slides" },
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
      className="operation-panel group p-4 transition-all hover:border-foreground/25 sm:p-5"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{title}</p>
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground",
          attention && "text-destructive"
        )}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-3xl font-medium tabular-nums tracking-tight text-foreground">{value.toLocaleString("pt-BR")}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
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
          .or("data->>kind.is.null,data->>kind.neq.slides")
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

      const activityDateFormat = new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      });
      const activityLabelFormat = new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" });
      const completionsByDay = new Map<string, number>();
      for (const task of tasks) {
        if (task.status !== "done") continue;
        const key = task.completed_at ? activityDateFormat.format(new Date(task.completed_at)) : task.due_date;
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
        recentNotes: activeNotes.slice(0, 4),
        activity,
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

  const activity = data.activity.slice(-period);
  const completedInPeriod = activity.reduce((total, day) => total + day.completed, 0);

  return (
    <div className="dashboard-page mx-auto min-w-0 max-w-[1440px] space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div>
          <p className="page-eyebrow">Seu espaço de trabalho</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight">Dashboard</h1>
          <p className="mt-2 text-xs text-muted-foreground sm:text-sm">Tudo o que importa, em um só lugar.</p>
        </div>
        <div className="flex items-center gap-2 px-1 py-2 text-[10px] text-foreground/65 sm:text-xs">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="capitalize">{formattedDate.toLocaleLowerCase("pt-BR")}</span>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="operation-panel min-w-0 overflow-hidden" aria-label="Histórico de tarefas concluídas">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-6 sm:px-7">
            <div>
              <h2 className="text-sm font-medium">Tarefas concluídas</h2>
              <p className="mt-2 text-xs text-muted-foreground">Atividade dos últimos {period} dias</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <p className="text-4xl font-medium tabular-nums tracking-tight sm:text-5xl">{completedInPeriod.toLocaleString("pt-BR")}</p>
                <span className="rounded-full border border-foreground/15 bg-foreground/[0.04] px-2.5 py-1 text-[10px] text-foreground/75">{period} dias</span>
              </div>
            </div>
            <div className="flex rounded-full border border-border bg-black/15 p-1" aria-label="Período do gráfico">
              {([7, 30] as const).map((days) => (
                <button key={days} type="button" aria-pressed={period === days} onClick={() => setPeriod(days)}
                  className={cn("min-h-9 rounded-full px-3 text-xs transition-colors", period === days ? "bg-foreground/10 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {days} dias
                </button>
              ))}
            </div>
          </div>
          <div className="activity-chart mt-5 h-52 w-full px-2 sm:h-60 sm:px-4" role="img" aria-label={`${completedInPeriod} tarefas concluídas nos últimos ${period} dias`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activity} margin={{ top: 12, right: 18, bottom: 4, left: 18 }}>
                <defs>
                  <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d6d0c5" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#d6d0c5" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#96928e", fontSize: 10 }} minTickGap={32} tickMargin={14} />
                <YAxis hide allowDecimals={false} domain={[0, (max: number) => Math.max(3, max + 1)]} />
                <Tooltip cursor={{ stroke: "rgba(255,255,255,0.18)", strokeDasharray: "4 4" }}
                  contentStyle={{ background: "#1e1d1c", border: "1px solid #494642", borderRadius: 12, fontSize: 12, color: "#f4f1eb" }}
                  formatter={(value: number) => [value, "Concluídas"]} />
                <Area type="monotone" dataKey="completed" animationDuration={600} stroke="#e2dcd2" strokeWidth={2} fill="url(#activityFill)" activeDot={{ r: 4, fill: "#f4f1eb", stroke: "#242220", strokeWidth: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 px-5 py-3.5 text-[10px] text-muted-foreground sm:px-7">
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-foreground/60" />Seu ritmo, dia após dia</span>
            <Link to="/tarefas" className="flex items-center gap-1.5 transition-colors hover:text-foreground">Ver tarefas <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
        </section>

        <section className="operation-panel flex flex-col justify-between p-5 sm:p-6">
          <div>
            <p className="page-eyebrow">Seu dia em foco</p>
            <h2 className="mt-3 text-lg font-medium">{greeting}, {displayName}.</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {data.overdue > 0 ? `${data.overdue} tarefa${data.overdue === 1 ? " atrasada precisa" : "s atrasadas precisam"} da sua atenção.` : data.todayPending > 0 ? `${data.todayPending} tarefa${data.todayPending === 1 ? " pendente" : "s pendentes"} para hoje. Um passo de cada vez.` : "Seu dia está em ordem. Espaço para novas ideias."}
            </p>
          </div>
          <div className="flex items-center gap-5 py-6">
            <div className="relative h-24 w-24 shrink-0" role="progressbar" aria-label="Progresso de hoje" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
                <circle cx="50" cy="50" r="44" fill="none" stroke="#e2dcd2" strokeWidth="4" strokeLinecap="round" strokeDasharray="276.46" strokeDashoffset={276.46 * (1 - progress / 100)} className="transition-all duration-500" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl font-medium tabular-nums">{progress}%</span>
            </div>
            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">Progresso de hoje</p>
              <p><span className="font-medium">{data.todayDone}</span><span className="text-muted-foreground"> de {totalToday} concluídas</span></p>
              <p className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-foreground/60" />{data.todayPending} pendentes</p>
            </div>
          </div>
          <Link to="/tarefas" className="flex min-h-11 items-center justify-between rounded-xl border border-foreground/15 bg-foreground/[0.04] px-4 text-xs transition-colors hover:bg-foreground/10">
            Organizar meu dia <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>

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
        <section className="operation-panel min-w-0 p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Foco agora</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
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

        <section className="operation-panel min-w-0 p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Últimas notas</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Continue de onde parou.</p>
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
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-foreground/[0.03]">
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

      <section className="operation-panel p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Acesso rápido</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Entre direto nas áreas que você mais usa.
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {data.mapCount} {data.mapCount === 1 ? "mapa mental salvo" : "mapas mentais salvos"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.path}
                to={action.path}
                className="group rounded-xl border border-border/70 bg-foreground/[0.02] p-4 transition-all hover:border-foreground/25 hover:bg-foreground/[0.05]"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-foreground/[0.03]">
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
