import { 
  LayoutDashboard, GitBranch, CheckSquare, DollarSign, StickyNote, Link2,
  Plus, ArrowUpRight, TrendingUp, TrendingDown, Clock
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";

interface QuickAction {
  label: string;
  icon: React.ElementType;
  path: string;
}

const quickActions: QuickAction[] = [
  { label: "Novo Funil", icon: GitBranch, path: "/funis" },
  { label: "Nova Tarefa", icon: CheckSquare, path: "/tarefas" },
  { label: "Nova Nota", icon: StickyNote, path: "/notas" },
  { label: "Novo Link", icon: Link2, path: "/links" },
  { label: "Nova Transação", icon: DollarSign, path: "/financeiro" },
];

function StatCard({ title, value, subtitle, icon: Icon, trend }: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 hover:bg-card-hover transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-md bg-secondary">
          <Icon className="w-4 h-4 text-foreground" />
        </div>
        {trend && (
          <span className={cn(
            "text-xs font-medium flex items-center gap-1",
            trend === "up" && "text-success",
            trend === "down" && "text-destructive",
            trend === "neutral" && "text-muted-foreground"
          )}>
            {trend === "up" && <TrendingUp className="w-3 h-3" />}
            {trend === "down" && <TrendingDown className="w-3 h-3" />}
          </span>
        )}
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
  monthBalance: number;
  monthIncome: number;
  monthExpense: number;
  funnelCount: number;
  noteCount: number;
  recentTasks: any[];
  recentNotes: any[];
  recentFunnels: any[];
  recentLinks: any[];
}

const Dashboard = () => {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthStart = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`;
    const nextMonth = currentMonth === 11 ? `${currentYear + 1}-01-01` : `${currentYear}-${String(currentMonth + 2).padStart(2, "0")}-01`;

    const load = async () => {
      const [tasksRes, txRes, funnelsRes, notesRes, linksRes] = await Promise.all([
        (supabase.from("tasks") as any).select("id, title, status, due_date, priority, is_fixed_daily").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        (supabase.from("transactions") as any).select("id, type, amount, date").eq("user_id", user.id).gte("date", monthStart).lt("date", nextMonth),
        (supabase.from("funnels") as any).select("id, title, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(5),
        (supabase.from("notes") as any).select("id, title, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(5),
        (supabase.from("links") as any).select("id, title, url, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
      ]);

      const tasks = tasksRes.data || [];
      const txs = txRes.data || [];
      const todayTasks = tasks.filter((t: any) => t.due_date === today && t.status !== "done");
      const todayDone = tasks.filter((t: any) => t.due_date === today && t.status === "done");
      const income = txs.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
      const expense = txs.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);

      setData({
        todayTasks: todayTasks.length,
        todayTasksDone: todayDone.length,
        monthBalance: income - expense,
        monthIncome: income,
        monthExpense: expense,
        funnelCount: funnelsRes.data?.length || 0,
        noteCount: notesRes.data?.length || 0,
        recentTasks: tasks.filter((t: any) => t.status !== "done").slice(0, 5),
        recentNotes: notesRes.data || [],
        recentFunnels: funnelsRes.data || [],
        recentLinks: linksRes.data || [],
      });
      setLoading(false);
    };
    load();
  }, [user]);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-secondary rounded w-48" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-32 bg-card border border-border rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  const d = data!;
  const balanceTrend = d.monthBalance > 0 ? "up" : d.monthBalance < 0 ? "down" : "neutral";

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Visão geral da sua produtividade</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {quickActions.map((action) => (
          <Link key={action.label} to={action.path}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary hover:bg-accent text-sm text-foreground transition-colors">
            <Plus className="w-3.5 h-3.5" />
            <span>{action.label}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard 
          title="Tarefas Hoje" 
          value={String(d.todayTasks)} 
          subtitle={d.todayTasksDone > 0 ? `${d.todayTasksDone} concluída(s)` : "Pendentes para hoje"} 
          icon={CheckSquare}
        />
        <StatCard 
          title="Saldo do Mês" 
          value={fmt(d.monthBalance)} 
          subtitle={`${fmt(d.monthIncome)} receitas`}
          icon={DollarSign}
          trend={balanceTrend}
        />
        <StatCard 
          title="Funis Ativos" 
          value={String(d.funnelCount)} 
          subtitle={d.funnelCount === 0 ? "Nenhum funil criado" : "Funis salvos"} 
          icon={GitBranch}
        />
        <StatCard 
          title="Notas" 
          value={String(d.noteCount)} 
          subtitle={d.noteCount === 0 ? "Nenhuma nota salva" : "Notas salvas"} 
          icon={StickyNote}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
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

        <div className="bg-card border border-border rounded-lg p-5">
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

        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Funis Recentes</h2>
            <Link to="/funis" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Ver todos →</Link>
          </div>
          {d.recentFunnels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <GitBranch className="w-8 h-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum funil criado</p>
              <Link to="/funis" className="text-xs text-foreground mt-2 hover:underline">Criar funil →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {d.recentFunnels.map((f: any) => (
                <Link key={f.id} to="/funis" className="flex items-center gap-3 py-2 px-1 border-b border-border/50 last:border-0 hover:bg-accent/30 rounded">
                  <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{f.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(f.updated_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Links Salvos</h2>
            <Link to="/links" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Ver todos →</Link>
          </div>
          {d.recentLinks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Link2 className="w-8 h-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum link salvo</p>
              <Link to="/links" className="text-xs text-foreground mt-2 hover:underline">Salvar link →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {d.recentLinks.map((l: any) => (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-2 px-1 border-b border-border/50 last:border-0 hover:bg-accent/30 rounded">
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{l.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
