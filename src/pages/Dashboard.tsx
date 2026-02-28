import { 
  LayoutDashboard, 
  GitBranch, 
  CheckSquare, 
  DollarSign, 
  StickyNote, 
  Link2,
  Plus,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Clock
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

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

function EmptyListItem({ icon: Icon, label, sublabel }: { icon: React.ElementType; label: string; sublabel: string }) {
  return (
    <div className="flex items-center gap-3 py-3 px-1 border-b border-border/50 last:border-0">
      <div className="p-1.5 rounded bg-secondary">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{label}</p>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </div>
      <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
    </div>
  );
}

const Dashboard = () => {
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Visão geral da sua produtividade</p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        {quickActions.map((action) => (
          <Link
            key={action.label}
            to={action.path}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary hover:bg-accent text-sm text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{action.label}</span>
          </Link>
        ))}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard 
          title="Tarefas Hoje" 
          value="0" 
          subtitle="Nenhuma tarefa pendente" 
          icon={CheckSquare}
        />
        <StatCard 
          title="Saldo do Mês" 
          value="R$ 0,00" 
          subtitle="Receitas - Despesas" 
          icon={DollarSign}
          trend="neutral"
        />
        <StatCard 
          title="Funis Ativos" 
          value="0" 
          subtitle="Nenhum funil criado" 
          icon={GitBranch}
        />
        <StatCard 
          title="Notas" 
          value="0" 
          subtitle="Nenhuma nota salva" 
          icon={StickyNote}
        />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tarefas do Dia */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Tarefas do Dia</h2>
            <Link to="/tarefas" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Ver todas →
            </Link>
          </div>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Clock className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma tarefa para hoje</p>
            <Link to="/tarefas" className="text-xs text-foreground mt-2 hover:underline">
              Criar tarefa →
            </Link>
          </div>
        </div>

        {/* Últimas Notas */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Últimas Notas</h2>
            <Link to="/notas" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Ver todas →
            </Link>
          </div>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <StickyNote className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma nota criada</p>
            <Link to="/notas" className="text-xs text-foreground mt-2 hover:underline">
              Criar nota →
            </Link>
          </div>
        </div>

        {/* Funis Recentes */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Funis Recentes</h2>
            <Link to="/funis" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Ver todos →
            </Link>
          </div>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <GitBranch className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum funil criado</p>
            <Link to="/funis" className="text-xs text-foreground mt-2 hover:underline">
              Criar funil →
            </Link>
          </div>
        </div>

        {/* Links Salvos */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Links Salvos</h2>
            <Link to="/links" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Ver todos →
            </Link>
          </div>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Link2 className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum link salvo</p>
            <Link to="/links" className="text-xs text-foreground mt-2 hover:underline">
              Salvar link →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
