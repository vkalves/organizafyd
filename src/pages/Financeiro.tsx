import { DollarSign, Plus, TrendingUp, TrendingDown, Wallet, Trash2, Edit2, Save } from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  date: string;
  category_id: string | null;
  account_id: string | null;
  tags: string[] | null;
  created_at: string;
}

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number | null;
  created_at: string;
}

interface Category {
  id: string;
  name: string;
  type: string;
  budget_limit: number | null;
  created_at: string;
}

const tabs = ["Transações", "Contas", "Categorias"];

const Financeiro = () => {
  const [activeTab, setActiveTab] = useState("Transações");
  const { data: transactions, loading, create: createTx, update: updateTx, remove: removeTx } = useSupabaseCrud<Transaction>("transactions", "date");
  const { data: accounts, create: createAcc, remove: removeAcc } = useSupabaseCrud<Account>("financial_accounts");
  const { data: categories, create: createCat, remove: removeCat } = useSupabaseCrud<Category>("financial_categories");

  const [showTxDialog, setShowTxDialog] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [txForm, setTxForm] = useState({ type: "expense", amount: "", description: "", date: new Date().toISOString().split("T")[0], category_id: "", account_id: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string } | null>(null);
  const [showAccDialog, setShowAccDialog] = useState(false);
  const [accForm, setAccForm] = useState({ name: "", type: "wallet" });
  const [showCatDialog, setShowCatDialog] = useState(false);
  const [catForm, setCatForm] = useState({ name: "", type: "expense", budget_limit: "" });

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthTransactions = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const income = monthTransactions.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = monthTransactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const openCreateTx = () => {
    setEditTx(null);
    setTxForm({ type: "expense", amount: "", description: "", date: new Date().toISOString().split("T")[0], category_id: "", account_id: "" });
    setShowTxDialog(true);
  };

  const openEditTx = (t: Transaction) => {
    setEditTx(t);
    setTxForm({ type: t.type, amount: String(t.amount), description: t.description || "", date: t.date, category_id: t.category_id || "", account_id: t.account_id || "" });
    setShowTxDialog(true);
  };

  const handleSaveTx = async () => {
    if (!txForm.amount) return toast.error("Valor obrigatório");
    const payload = { type: txForm.type, amount: Number(txForm.amount), description: txForm.description, date: txForm.date, category_id: txForm.category_id || null, account_id: txForm.account_id || null };
    if (editTx) await updateTx(editTx.id, payload);
    else await createTx(payload);
    setShowTxDialog(false);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "tx") await removeTx(deleteConfirm.id);
    else if (deleteConfirm.type === "acc") await removeAcc(deleteConfirm.id);
    else if (deleteConfirm.type === "cat") await removeCat(deleteConfirm.id);
    setDeleteConfirm(null);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground mt-1">Controle suas finanças pessoais</p>
        </div>
        <button onClick={openCreateTx} className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Nova Transação
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><Wallet className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Saldo</span></div>
          <p className={cn("text-xl font-semibold", balance >= 0 ? "text-success" : "text-destructive")}>{fmt(balance)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-success" /><span className="text-xs text-muted-foreground">Receitas</span></div>
          <p className="text-xl font-semibold text-success">{fmt(income)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><TrendingDown className="w-4 h-4 text-destructive" /><span className="text-xs text-muted-foreground">Despesas</span></div>
          <p className="text-xl font-semibold text-destructive">{fmt(expense)}</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={cn(
            "px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
            activeTab === tab ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}>{tab}</button>
        ))}
      </div>

      {activeTab === "Transações" && (
        loading ? <div className="text-center py-20 text-muted-foreground animate-pulse">Carregando...</div> :
        transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="p-4 rounded-full bg-secondary mb-4"><DollarSign className="w-8 h-8 text-muted-foreground" /></div>
            <h2 className="text-lg font-semibold text-foreground mb-1">Sem transações</h2>
            <p className="text-sm text-muted-foreground max-w-sm">Adicione suas receitas e despesas.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border hover:bg-card-hover transition-colors group">
                <div className={cn("p-2 rounded-md", t.type === "income" ? "bg-success/10" : "bg-destructive/10")}>
                  {t.type === "income" ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-destructive" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{t.description || (t.type === "income" ? "Receita" : "Despesa")}</p>
                  <span className="text-[10px] text-muted-foreground">{new Date(t.date).toLocaleDateString("pt-BR")}</span>
                </div>
                <span className={cn("text-sm font-medium", t.type === "income" ? "text-success" : "text-destructive")}>
                  {t.type === "income" ? "+" : "-"}{fmt(t.amount)}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEditTx(t)} className="p-1.5 rounded hover:bg-accent"><Edit2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
                  <button onClick={() => setDeleteConfirm({ type: "tx", id: t.id })} className="p-1.5 rounded hover:bg-accent"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {activeTab === "Contas" && (
        <div className="space-y-3">
          <button onClick={() => { setAccForm({ name: "", type: "wallet" }); setShowAccDialog(true); }} className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-sm text-foreground hover:bg-accent transition-colors">
            <Plus className="w-4 h-4" /> Nova Conta
          </button>
          {accounts.length === 0 ? <p className="text-sm text-muted-foreground text-center py-10">Nenhuma conta criada</p> :
            accounts.map(a => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-card border border-border group">
                <div><p className="text-sm text-foreground">{a.name}</p><span className="text-[10px] text-muted-foreground capitalize">{a.type}</span></div>
                <button onClick={() => setDeleteConfirm({ type: "acc", id: a.id })} className="p-1.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
              </div>
            ))
          }
        </div>
      )}

      {activeTab === "Categorias" && (
        <div className="space-y-3">
          <button onClick={() => { setCatForm({ name: "", type: "expense", budget_limit: "" }); setShowCatDialog(true); }} className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-sm text-foreground hover:bg-accent transition-colors">
            <Plus className="w-4 h-4" /> Nova Categoria
          </button>
          {categories.length === 0 ? <p className="text-sm text-muted-foreground text-center py-10">Nenhuma categoria criada</p> :
            categories.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-card border border-border group">
                <div><p className="text-sm text-foreground">{c.name}</p><span className="text-[10px] text-muted-foreground capitalize">{c.type === "income" ? "Receita" : "Despesa"}</span></div>
                <button onClick={() => setDeleteConfirm({ type: "cat", id: c.id })} className="p-1.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
              </div>
            ))
          }
        </div>
      )}

      {/* Transaction Dialog */}
      <Dialog open={showTxDialog} onOpenChange={setShowTxDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">{editTx ? "Editar" : "Nova"} Transação</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              {["expense", "income"].map(t => (
                <button key={t} onClick={() => setTxForm({ ...txForm, type: t })} className={cn(
                  "flex-1 h-10 rounded-md text-sm font-medium transition-colors",
                  txForm.type === t ? (t === "income" ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground") : "bg-secondary text-foreground"
                )}>{t === "income" ? "Receita" : "Despesa"}</button>
              ))}
            </div>
            <input type="number" placeholder="Valor" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <input type="text" placeholder="Descrição" value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <input type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
            <select value={txForm.category_id} onChange={(e) => setTxForm({ ...txForm, category_id: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="">Sem categoria</option>
              {categories.filter(c => c.type === txForm.type).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={txForm.account_id} onChange={(e) => setTxForm({ ...txForm, account_id: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="">Sem conta</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={handleSaveTx} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"><Save className="w-4 h-4 inline mr-2" />{editTx ? "Salvar" : "Criar"}</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAccDialog} onOpenChange={setShowAccDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Nova Conta</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input type="text" placeholder="Nome" value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <select value={accForm.type} onChange={(e) => setAccForm({ ...accForm, type: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="wallet">Carteira</option>
              <option value="bank">Banco</option>
              <option value="card">Cartão</option>
            </select>
            <button onClick={async () => { if (!accForm.name) return; await createAcc(accForm); setShowAccDialog(false); }}
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">Criar</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCatDialog} onOpenChange={setShowCatDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Nova Categoria</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input type="text" placeholder="Nome" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <select value={catForm.type} onChange={(e) => setCatForm({ ...catForm, type: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </select>
            <input type="number" placeholder="Limite orçamento (opcional)" value={catForm.budget_limit} onChange={(e) => setCatForm({ ...catForm, budget_limit: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <button onClick={async () => { if (!catForm.name) return; await createCat({ name: catForm.name, type: catForm.type, budget_limit: catForm.budget_limit ? Number(catForm.budget_limit) : null }); setShowCatDialog(false); }}
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">Criar</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir?</p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-md bg-secondary text-sm text-foreground">Cancelar</button>
            <button onClick={handleDelete} className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Financeiro;
