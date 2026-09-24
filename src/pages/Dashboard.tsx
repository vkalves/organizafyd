import { 
  CheckSquare, StickyNote,
  Plus, ArrowUpRight, Clock
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState, useEffect } from "react";

interface QuickAction {
  label: string;
  icon: React.ElementType;
  path: string;
}

const quickActions: QuickAction[] = [
  { label: "Nova Tarefa", icon: CheckSquare, path: "/tarefas" },
  { label: "Nova Nota", icon: StickyNote, path: "/notas" },
];

function StatCard({ title, value, subtitle, icon: Icon }: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
}) {
  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:bg-card-hover sm:p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-md bg-secondary">
          <Icon className="w-4 h-4 text-foreground" />
        </div>
      </div>
      <p className="text-2xl font-semibold text-foreground tracking-tight">{value}</p>
      <p className="text-sm text-muted-foreground mt-1">{title}</p>
      <p className="text-xs text-muted-foreground/70 mt-0.5">{subtitle}</p>
    </div>
  );
}

interface DashboardData {
  todayTasks: number;
  todayTasksDone: number;
  noteCount: number;
  recentTasks: any[];
  recentNotes: any[];
}

const Dashboard = () => {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const greeting = useMemo(() => {
    const hour = now.getHours();
    if (hour < 5) return "Boa madrugada";
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  }, [now]);

  const displayName = useMemo(() => {
    const metadataName = user?.user_metadata?.display_name;
    if (typeof metadataName === "string" && metadataName.trim()) {
      return metadataName.trim().split(/\s+/)[0];
    }

    const emailName = user?.email?.split("@")[0]?.trim();
    return emailName || "você";
  }, [user]);

  const formattedDate = useMemo(
    () =>
      now
        .toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
        .replace(/ de /g, " DE ")
        .toLocaleUpperCase("pt-BR"),
    [now],
  );

  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    const load = async () => {
      const [tasksRes, notesRes] = await Promise.all([
        (supabase.from("tasks") as any).select("id, title, status, due_date, priority, is_fixed_daily").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        (supabase.from("notes") as any).select("id, title, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(5),
      ]);

      const tasks = tasksRes.data || [];
      const todayTasks = tasks.filter((t: any) => t.due_date === today && t.status !== "done");
      const todayDone = tasks.filter((t: any) => t.due_date === today && t.status === "done");

      setData({
        todayTasks: todayTasks.length,
        todayTasksDone: todayDone.length,
        noteCount: notesRes.data?.length || 0,
        recentTasks: tasks.filter((t: any) => t.status !== "done").slice(0, 5),
        recentNotes: notesRes.data || [],
      });
      setLoading(false);
    };
    load();
  }, [user]);


  if (loading) {
    return (
      <div className="mx-auto min-w-0 max-w-6xl space-y-6 sm:space-y-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-secondary rounded w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1,2].map(i => <div key={i} className="h-32 bg-card border border-border rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  const d = data!;

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-6 sm:space-y-8">
      <section className="rounded-xl border border-border bg-card/40 px-4 py-5 sm:px-5 sm:py-6">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-[1.35rem] font-semibold tracking-tight text-foreground sm:text-2xl">
            {greeting},{" "}
            <span className="text-foreground">{displayName}</span>
          </h1>
          <p className="mt-2 text-[9px] font-medium uppercase tracking-[0.28em] text-muted-foreground sm:text-[10px]">
            {formattedDate}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {quickActions.map((action) => (
          <Link key={action.label} to={action.path}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent sm:min-h-0">
            <Plus className="w-3.5 h-3.5" />
            <span>{action.label}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard 
          title="Tarefas Hoje" 
          value={String(d.todayTasks)} 
          subtitle={d.todayTasksDone > 0 ? `${d.todayTasksDone} concluída(s)` : "Pendentes para hoje"} 
          icon={CheckSquare}
        />
        <StatCard 
          title="Notas" 
          value={String(d.noteCount)} 
          subtitle={d.noteCount === 0 ? "Nenhuma nota salva" : "Notas salvas"} 
          icon={StickyNote}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Tarefas Pendentes</h2>
            <Link to="/tarefas" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Ver todas →</Link>
          </div>
          {d.recentTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Clock className="w-8 h-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma tarefa pendente</p>
              <Link to="/tarefas" className="text-xs text-foreground mt-2 hover:underline">Criar tarefa →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {d.recentTasks.map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 py-2 px-1 border-b border-border/50 last:border-0">
                  <div className={cn("w-2 h-2 rounded-full", t.priority === "high" ? "bg-destructive" : t.priority === "medium" ? "bg-warning" : "bg-muted-foreground")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.due_date || "Sem data"}{t.is_fixed_daily ? " · Fixa diária" : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Últimas Notas</h2>
            <Link to="/notas" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Ver todas →</Link>
          </div>
          {d.recentNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <StickyNote className="w-8 h-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma nota criada</p>
              <Link to="/notas" className="text-xs text-foreground mt-2 hover:underline">Criar nota →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {d.recentNotes.map((n: any) => (
                <Link key={n.id} to="/notas" className="flex items-center gap-3 py-2 px-1 border-b border-border/50 last:border-0 hover:bg-accent/30 rounded">
                  <StickyNote className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{n.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(n.updated_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default Dashboard;
