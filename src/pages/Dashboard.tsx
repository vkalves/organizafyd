import {
  ArrowRight,
  CheckSquare,
  Clock3,
  DollarSign,
  GitBranch,
  Instagram,
  Link2,
  Plus,
  RefreshCw,
  StickyNote,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, formatDate, toLocalDateInput } from "@/lib/date";
import { cn } from "@/lib/utils";

interface TaskPreview {
  id: string;
  title: string;
  status: string | null;
  due_date: string | null;
  priority: string | null;
  is_fixed_daily: boolean | null;
}

interface NotePreview {
  id: string;
  title: string;
  updated_at: string;
}

interface FunnelPreview {
  id: string;
  title: string;
  updated_at: string;
}

interface LinkPreview {
  id: string;
  title: string;
  url: string;
  created_at: string;
}

interface DashboardData {
  todayTotal: number;
  todayDone: number;
  monthBalance: number;
  monthIncome: number;
  monthExpense: number;
  funnelCount: number;
  noteCount: number;
  instagramCount: number;
  recentTasks: TaskPreview[];
  recentNotes: NotePreview[];
  recentFunnels: FunnelPreview[];
  recentLinks: LinkPreview[];
}

const quickActions = [
  { label: "Nova tarefa", icon: CheckSquare, path: "/tarefas" },
  { label: "Conta Instagram", icon: Instagram, path: "/instagram" },
  { label: "Novo funil", icon: GitBranch, path: "/funis" },
  { label: "Nova transação", icon: DollarSign, path: "/financeiro" },
  { label: "Nova nota", icon: StickyNote, path: "/notas" },
  { label: "Salvar link", icon: Link2, path: "/links" },
] as const;

function StatCard({ title, value, subtitle, icon: Icon, tone = "default" }: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <div className="surface-card p-5">
      <div className="mb-5 flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary">
          <Icon className="h-4 w-4" />
        </span>
        {tone !== "default" && (
          <span className={cn("flex items-center gap-1 text-xs font-semibold", tone === "success" ? "text-success" : "text-destructive")}>
            {tone === "success" ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            este mês
          </span>
        )}
      </div>
      <p className="truncate text-2xl font-semibold tracking-tight sm:text-[1.7rem]">{value}</p>
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function SectionCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="surface-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link to={href} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          Ver tudo <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}

const Dashboard = () => {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const firstName = useMemo(() => {
    const metadataName = user?.user_metadata?.display_name;
    const name = typeof metadataName === "string" && metadataName.trim() ? metadataName : user?.email?.split("@")[0];
    return name?.trim().split(/\s+/)[0] || "por aqui";
  }, [user]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    const today = toLocalDateInput();
    const now = new Date();
    const monthStart = toLocalDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
    const nextMonth = toLocalDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 1));

    const [todayTasksRes, recentTasksRes, transactionsRes, funnelsRes, notesRes, linksRes, instagramRes] = await Promise.all([
      supabase.from("tasks").select("id, title, status, due_date, priority, is_fixed_daily").eq("user_id", user.id).eq("due_date", today),
      supabase.from("tasks").select("id, title, status, due_date, priority, is_fixed_daily").eq("user_id", user.id).neq("status", "done").order("due_date", { ascending: true, nullsFirst: false }).limit(5),
      supabase.from("transactions").select("id, type, amount, date").eq("user_id", user.id).gte("date", monthStart).lt("date", nextMonth),
      supabase.from("funnels").select("id, title, updated_at", { count: "exact" }).eq("user_id", user.id).order("updated_at", { ascending: false }).limit(4),
      supabase.from("notes").select("id, title, updated_at", { count: "exact" }).eq("user_id", user.id).order("updated_at", { ascending: false }).limit(4),
      supabase.from("links").select("id, title, url, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(4),
      supabase.from("instagram_accounts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);

    const failure = [todayTasksRes, recentTasksRes, transactionsRes, funnelsRes, notesRes, linksRes, instagramRes].find((result) => result.error)?.error;
    if (failure) {
      setError("Não foi possível carregar todos os indicadores. Tente novamente.");
      setLoading(false);
      return;
    }

    const transactions = transactionsRes.data || [];
    const income = transactions.reduce((sum, item) => item.type === "income" ? sum + Number(item.amount) : sum, 0);
    const expense = transactions.reduce((sum, item) => item.type === "expense" ? sum + Number(item.amount) : sum, 0);
    const todayTasks = todayTasksRes.data || [];

    setData({
      todayTotal: todayTasks.length,
      todayDone: todayTasks.filter((task) => task.status === "done").length,
      monthBalance: income - expense,
      monthIncome: income,
      monthExpense: expense,
      funnelCount: funnelsRes.count || 0,
      noteCount: notesRes.count || 0,
      instagramCount: instagramRes.count || 0,
      recentTasks: (recentTasksRes.data || []) as TaskPreview[],
      recentNotes: (notesRes.data || []) as NotePreview[],
      recentFunnels: (funnelsRes.data || []) as FunnelPreview[],
      recentLinks: (linksRes.data || []) as LinkPreview[],
    });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (loading) {
    return (
      <div className="page-shell" aria-label="Carregando dashboard">
        <div className="h-20 w-full max-w-xl animate-pulse rounded-xl bg-secondary" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border border-border bg-card" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="empty-state mx-auto max-w-2xl">
        <span className="empty-state-icon"><RefreshCw className="h-6 w-6" /></span>
        <h1 className="text-lg font-semibold">Não foi possível abrir o dashboard</h1>
        <p>{error}</p>
        <button onClick={() => void loadDashboard()} className="action-primary mt-3"><RefreshCw className="h-4 w-4" /> Tentar novamente</button>
      </div>
    );
  }

  const taskProgress = data.todayTotal ? Math.round((data.todayDone / data.todayTotal) * 100) : 0;
  const balanceTone = data.monthBalance > 0 ? "success" : data.monthBalance < 0 ? "danger" : "default";

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h1 className="page-title">Olá, {firstName}</h1>
          <p className="page-description">Aqui está o que merece sua atenção hoje.</p>
        </div>
        <span className="hidden text-xs capitalize text-muted-foreground sm:block">{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date())}</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Ações rápidas">
        {quickActions.map((action) => (
          <Link key={action.label} to={action.path} className="filter-chip min-h-10 px-3.5 text-foreground">
            <Plus className="h-3.5 w-3.5" /> {action.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Tarefas de hoje" value={`${data.todayDone}/${data.todayTotal}`} subtitle={data.todayTotal ? `${taskProgress}% concluído` : "Nenhuma tarefa para hoje"} icon={CheckSquare} />
        <StatCard title="Saldo do mês" value={formatCurrency(data.monthBalance)} subtitle={`${formatCurrency(data.monthIncome)} em receitas`} icon={DollarSign} tone={balanceTone} />
        <StatCard title="Funis" value={String(data.funnelCount)} subtitle="Fluxos organizados" icon={GitBranch} />
        <StatCard title="Contas Instagram" value={String(data.instagramCount)} subtitle="Contas acompanhadas" icon={Instagram} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Próximas tarefas" href="/tarefas">
          {data.recentTasks.length === 0 ? (
            <CompactEmpty icon={CheckSquare} text="Nenhuma tarefa pendente." />
          ) : (
            <div className="divide-y divide-border/70">
              {data.recentTasks.map((task) => (
                <Link key={task.id} to="/tarefas" className="flex items-center gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-accent/40">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", task.priority === "high" ? "bg-destructive" : task.priority === "medium" ? "bg-warning" : "bg-muted-foreground")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{task.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{task.due_date ? formatDate(task.due_date) : "Sem data"}{task.is_fixed_daily ? " · Diária" : ""}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title={`Notas recentes · ${data.noteCount}`} href="/notas">
          {data.recentNotes.length === 0 ? <CompactEmpty icon={StickyNote} text="Nenhuma nota criada." /> : (
            <div className="divide-y divide-border/70">
              {data.recentNotes.map((note) => (
                <Link key={note.id} to="/notas" className="flex items-center gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-accent/40">
                  <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
                  <span className="text-[11px] text-muted-foreground">{formatDate(note.updated_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Funis recentes" href="/funis">
          {data.recentFunnels.length === 0 ? <CompactEmpty icon={GitBranch} text="Nenhum funil criado." /> : (
            <div className="divide-y divide-border/70">
              {data.recentFunnels.map((funnel) => (
                <Link key={funnel.id} to="/funis" className="flex items-center gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-accent/40">
                  <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{funnel.title}</span>
                  <span className="text-[11px] text-muted-foreground">{formatDate(funnel.updated_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Links recentes" href="/links">
          {data.recentLinks.length === 0 ? <CompactEmpty icon={Link2} text="Nenhum link salvo." /> : (
            <div className="divide-y divide-border/70">
              {data.recentLinks.map((item) => (
                <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-accent/40">
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </a>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};

function CompactEmpty({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center text-center text-sm text-muted-foreground">
      <Icon className="mb-2 h-6 w-6 opacity-50" />
      {text}
    </div>
  );
}

export default Dashboard;
