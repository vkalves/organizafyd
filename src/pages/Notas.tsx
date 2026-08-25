import { useState, useMemo, useEffect } from "react";
import {
  Instagram, Plus, ArrowLeft, Trash2, Pencil, AlertTriangle,
  Flame, CheckCircle2, Mail, Phone, Calendar, MessageSquare,
  Video, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

// ============================================================
// Tipos
// ============================================================
interface InstagramAccount {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  joined_at: string; // date (YYYY-MM-DD) - início do Dia 1
  status: "aquecimento" | "aquecida";
  observations: string | null;
  created_at: string;
  updated_at: string;
}

interface WarmupProgress {
  id: string;
  account_id: string;
  day_number: number;
  task_index: number;
  completed: boolean;
  completed_at: string | null;
}

interface InstagramVideo {
  id: string;
  account_id: string;
  published: boolean;
  created_at: string;
}

// ============================================================
// Processo de aquecimento (fixo, 8 dias)
// ============================================================
const REPEAT_2A4 = [
  "Assistir 30 minutos de Reels com rolagem automática",
  "Curtir, comentar e republicar conteúdos durante o uso",
  "Publicar Story após assistir aos Reels",
  "Publicar foto no Feed após 12 horas do Story",
  "Publicar foto do próprio rosto e arquivar",
];
const REPEAT_5A8_EXTRA = [
  "Publicar foto nos Melhores Amigos",
  "Criar Destaques utilizando as fotos publicadas",
];

const WARMUP_DAYS: { day: number; tasks: string[] }[] = [
  { day: 1, tasks: ["Criar conta e deixar OFF por 24 horas"] },
  { day: 2, tasks: [...REPEAT_2A4, ...REPEAT_5A8_EXTRA] },
  { day: 3, tasks: [...REPEAT_2A4, ...REPEAT_5A8_EXTRA] },
  { day: 4, tasks: [...REPEAT_2A4, ...REPEAT_5A8_EXTRA] },
  { day: 5, tasks: ["Publicar 1 Reel", "Publicar Story para a área de links e Destaques", ...REPEAT_5A8_EXTRA] },
  { day: 6, tasks: ["Publicar 1 Reel", "Assistir 10 minutos de Reels", ...REPEAT_5A8_EXTRA] },
  { day: 7, tasks: ["Publicar 1 Reel", "Assistir 10 minutos de Reels", ...REPEAT_5A8_EXTRA] },
  { day: 8, tasks: ["Publicar 1 Reel", "Assistir 10 minutos de Reels", ...REPEAT_5A8_EXTRA] },
];
const TOTAL_TASKS = WARMUP_DAYS.reduce((acc, d) => acc + d.tasks.length, 0); // 38

function getCurrentDay(joinedAt: string): number {
  const start = new Date(joinedAt + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
  return Math.min(Math.max(diff, 1), 8);
}

// ============================================================
// Componente principal
// ============================================================
const Notas = () => {
  const { data: accounts, loading, create: createAccount, update: updateAccount, remove: removeAccount } =
    useSupabaseCrud<InstagramAccount>("instagram_accounts", "created_at");
  const { data: progress, create: createProgress, update: updateProgress } =
    useSupabaseCrud<WarmupProgress>("instagram_warmup_progress");
  const { data: videos, create: createVideo, update: updateVideo, remove: removeVideo } =
    useSupabaseCrud<InstagramVideo>("instagram_videos");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState<InstagramAccount | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [formUsername, setFormUsername] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formJoinedAt, setFormJoinedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [formStatus, setFormStatus] = useState<"aquecimento" | "aquecida">("aquecimento");
  const [formObservations, setFormObservations] = useState("");

  // Helpers de dados por conta
  const videosByAccount = (accountId: string) => videos.filter(v => v.account_id === accountId);
  const progressByAccount = (accountId: string) => progress.filter(p => p.account_id === accountId);

  const pendingTasksToday = (account: InstagramAccount) => {
    if (account.status === "aquecida") return 0;
    const day = getCurrentDay(account.joined_at);
    const dayTasks = WARMUP_DAYS.find(d => d.day === day)?.tasks.length || 0;
    const doneToday = progressByAccount(account.id).filter(p => p.day_number === day && p.completed).length;
    return Math.max(dayTasks - doneToday, 0);
  };

  // Auto-conclusão do aquecimento quando todas as 38 tarefas forem marcadas
  useEffect(() => {
    accounts.forEach((acc) => {
      if (acc.status !== "aquecimento") return;
      const completedCount = progressByAccount(acc.id).filter(p => p.completed).length;
      if (completedCount >= TOTAL_TASKS) {
        updateAccount(acc.id, { status: "aquecida" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, accounts]);

  // ------------------------------------------------------------
  // Form de conta (criar/editar)
  // ------------------------------------------------------------
  const openNewAccount = () => {
    setEditingAccount(null);
    setFormUsername("");
    setFormEmail("");
    setFormPhone("");
    setFormJoinedAt(new Date().toISOString().slice(0, 10));
    setFormStatus("aquecimento");
    setFormObservations("");
    setShowAccountDialog(true);
  };

  const openEditAccount = (acc: InstagramAccount, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingAccount(acc);
    setFormUsername(acc.username);
    setFormEmail(acc.email || "");
    setFormPhone(acc.phone || "");
    setFormJoinedAt(acc.joined_at);
    setFormStatus(acc.status);
    setFormObservations(acc.observations || "");
    setShowAccountDialog(true);
  };

  const handleSaveAccount = async () => {
    const username = formUsername.trim().replace(/^@/, "");
    if (!username) return toast.error("Informe o @ da conta");

    const payload = {
      username,
      email: formEmail.trim() || null,
      phone: formPhone.trim() || null,
      joined_at: formJoinedAt,
      status: formStatus,
      observations: formObservations.trim() || null,
    };

    if (editingAccount) {
      await updateAccount(editingAccount.id, payload);
      toast.success("Conta atualizada!");
    } else {
      await createAccount(payload);
      toast.success("Conta cadastrada! Aquecimento iniciado no Dia 1.");
    }
    setShowAccountDialog(false);
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirm) return;
    await removeAccount(deleteConfirm);
    setDeleteConfirm(null);
    if (selectedId === deleteConfirm) setSelectedId(null);
  };

  // ------------------------------------------------------------
  // Tarefas de aquecimento
  // ------------------------------------------------------------
  const toggleTask = async (accountId: string, day: number, taskIndex: number) => {
    const existing = progress.find(
      p => p.account_id === accountId && p.day_number === day && p.task_index === taskIndex
    );
    if (existing) {
      await updateProgress(existing.id, {
        completed: !existing.completed,
        completed_at: !existing.completed ? new Date().toISOString() : null,
      });
    } else {
      await createProgress({
        account_id: accountId,
        day_number: day,
        task_index: taskIndex,
        completed: true,
        completed_at: new Date().toISOString(),
      });
    }
  };

  // ------------------------------------------------------------
  // Vídeos
  // ------------------------------------------------------------
  const handleAddVideo = async (accountId: string) => {
    await createVideo({ account_id: accountId, published: false });
  };
  const toggleVideoPublished = async (video: InstagramVideo) => {
    await updateVideo(video.id, { published: !video.published });
  };
  const handleRemoveVideo = async (id: string) => {
    await removeVideo(id);
  };

  const selectedAccount = useMemo(
    () => accounts.find(a => a.id === selectedId) || null,
    [accounts, selectedId]
  );

  // ============================================================
  // Página individual da conta
  // ============================================================
  if (selectedAccount) {
    const acc = selectedAccount;
    const day = getCurrentDay(acc.joined_at);
    const accProgress = progressByAccount(acc.id);
    const completedCount = accProgress.filter(p => p.completed).length;
    const progressPct = Math.round((completedCount / TOTAL_TASKS) * 100);
    const pendingToday = pendingTasksToday(acc);
    const accVideos = videosByAccount(acc.id);
    const pendingVideos = accVideos.filter(v => !v.published).length;
    const publishedVideos = accVideos.filter(v => v.published).length;

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <button onClick={() => setSelectedId(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <div className="flex items-center gap-2">
            <button onClick={(e) => openEditAccount(acc, e)} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary text-sm text-foreground hover:bg-accent transition-colors">
              <Pencil className="w-3.5 h-3.5" /> Editar
            </button>
            <button onClick={() => setDeleteConfirm(acc.id)} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary text-sm text-destructive hover:bg-accent transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </button>
          </div>
        </div>

        {/* Informações da conta */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-foreground">@{acc.username}</h1>
            <StatusBadge status={acc.status} day={acc.status === "aquecimento" ? day : undefined} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {acc.email && (
              <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5" /> {acc.email}</div>
            )}
            {acc.phone && (
              <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3.5 h-3.5" /> {acc.phone}</div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" /> Criada em {new Date(acc.joined_at + "T00:00:00").toLocaleDateString("pt-BR")}
            </div>
          </div>
          {acc.observations && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground pt-2 border-t border-border">
              <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {acc.observations}
            </div>
          )}
        </div>

        {/* Progresso do aquecimento */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Aquecimento</h2>
            {acc.status === "aquecimento" ? (
              <span className="text-xs text-muted-foreground">Dia {day} de 8</span>
            ) : (
              <span className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Concluído</span>
            )}
          </div>
          <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Tarefas concluídas: {completedCount}/{TOTAL_TASKS}</span>
            {pendingToday > 0 && (
              <span className="flex items-center gap-1 text-warning"><AlertTriangle className="w-3.5 h-3.5" /> {pendingToday} tarefas pendentes hoje</span>
            )}
          </div>
        </div>

        {/* Checklist por dia */}
        <div className="space-y-3">
          {WARMUP_DAYS.map(({ day: d, tasks }) => {
            const doneInDay = accProgress.filter(p => p.day_number === d && p.completed).length;
            return (
              <div key={d} className={cn("bg-card border rounded-lg p-4", d === day && acc.status === "aquecimento" ? "border-primary/50" : "border-border")}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-foreground">Dia {d}</h3>
                  <span className="text-xs text-muted-foreground">{doneInDay}/{tasks.length}</span>
                </div>
                <div className="space-y-1.5">
                  {tasks.map((task, idx) => {
                    const done = accProgress.some(p => p.day_number === d && p.task_index === idx && p.completed);
                    return (
                      <button
                        key={idx}
                        onClick={() => toggleTask(acc.id, d, idx)}
                        className="w-full flex items-center gap-2.5 text-left px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                      >
                        <span className={cn(
                          "flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors",
                          done ? "bg-primary border-primary" : "border-border"
                        )}>
                          {done && <Check className="w-3 h-3 text-primary-foreground" />}
                        </span>
                        <span className={cn("text-sm", done ? "text-muted-foreground line-through" : "text-foreground")}>{task}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Vídeos */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Video className="w-4 h-4" /> Vídeos</h2>
            <button onClick={() => handleAddVideo(acc.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Adicionar vídeo
            </button>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{accVideos.length} no total</span>
            <span className="text-warning">{pendingVideos} pendentes</span>
            <span className="text-emerald-500">{publishedVideos} publicados</span>
          </div>
          {accVideos.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              {accVideos.map((v, idx) => (
                <div key={v.id} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-accent transition-colors">
                  <span className="text-sm text-foreground">Vídeo {idx + 1}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleVideoPublished(v)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                        v.published ? "bg-emerald-500/10 text-emerald-500" : "bg-warning/10 text-warning"
                      )}
                    >
                      {v.published ? "Publicado" : "Pendente"}
                    </button>
                    <button onClick={() => handleRemoveVideo(v.id)} className="p-1 rounded hover:bg-accent">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <AccountDialog
          open={showAccountDialog}
          onOpenChange={setShowAccountDialog}
          editing={!!editingAccount}
          username={formUsername} setUsername={setFormUsername}
          email={formEmail} setEmail={setFormEmail}
          phone={formPhone} setPhone={setFormPhone}
          joinedAt={formJoinedAt} setJoinedAt={setFormJoinedAt}
          status={formStatus} setStatus={setFormStatus}
          observations={formObservations} setObservations={setFormObservations}
          onSave={handleSaveAccount}
        />
        <DeleteDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)} onConfirm={handleDeleteAccount} />
      </div>
    );
  }

  // ============================================================
  // Dashboard geral
  // ============================================================
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Instagram</h1>
          <p className="text-sm text-muted-foreground mt-1">Aquecimento e controle de contas</p>
        </div>
        <button onClick={openNewAccount} className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Nova Conta
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground animate-pulse">Carregando...</div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4"><Instagram className="w-8 h-8 text-muted-foreground" /></div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma conta cadastrada</h2>
          <p className="text-sm text-muted-foreground max-w-sm">Cadastre uma conta para começar o aquecimento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {accounts.map((acc) => {
            const day = getCurrentDay(acc.joined_at);
            const pending = pendingTasksToday(acc);
            const pendingVideos = videosByAccount(acc.id).filter(v => !v.published).length;
            return (
              <div
                key={acc.id}
                onClick={() => setSelectedId(acc.id)}
                className="bg-card border border-border rounded-lg p-4 hover:bg-card-hover transition-colors cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">@{acc.username}</h3>
                  <button onClick={(e) => openEditAccount(acc, e)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent transition-opacity">
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <StatusBadge status={acc.status} day={acc.status === "aquecimento" ? day : undefined} />
                <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                  <span>Vídeos pendentes: {pendingVideos}</span>
                </div>
                {pending > 0 && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-warning">
                    <AlertTriangle className="w-3.5 h-3.5" /> {pending} tarefas pendentes
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AccountDialog
        open={showAccountDialog}
        onOpenChange={setShowAccountDialog}
        editing={!!editingAccount}
        username={formUsername} setUsername={setFormUsername}
        email={formEmail} setEmail={setFormEmail}
        phone={formPhone} setPhone={setFormPhone}
        joinedAt={formJoinedAt} setJoinedAt={setFormJoinedAt}
        status={formStatus} setStatus={setFormStatus}
        observations={formObservations} setObservations={setFormObservations}
        onSave={handleSaveAccount}
      />
      <DeleteDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)} onConfirm={handleDeleteAccount} />
    </div>
  );
};

// ============================================================
// Componentes auxiliares
// ============================================================
function StatusBadge({ status, day }: { status: "aquecimento" | "aquecida"; day?: number }) {
  if (status === "aquecida") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" /> Aquecida
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-warning/10 text-warning border border-warning/20">
      <Flame className="w-3 h-3" /> Aquecimento{day ? ` · Dia ${day} de 8` : ""}
    </span>
  );
}

function AccountDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: boolean;
  username: string; setUsername: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  joinedAt: string; setJoinedAt: (v: string) => void;
  status: "aquecimento" | "aquecida"; setStatus: (v: "aquecimento" | "aquecida") => void;
  observations: string; setObservations: (v: string) => void;
  onSave: () => void;
}) {
  const {
    open, onOpenChange, editing,
    username, setUsername, email, setEmail, phone, setPhone,
    joinedAt, setJoinedAt, status, setStatus, observations, setObservations, onSave,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-foreground">{editing ? "Editar Conta" : "Nova Conta"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">@ da conta</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="usuario"
              className="w-full h-10 px-3 mt-1 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" autoFocus />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 mt-1 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Celular utilizado</label>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full h-10 px-3 mt-1 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Data de criação</label>
            <input type="date" value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)}
              className="w-full h-10 px-3 mt-1 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as "aquecimento" | "aquecida")}
              className="w-full h-10 px-3 mt-1 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="aquecimento">Aquecimento</option>
              <option value="aquecida">Aquecida</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Observações</label>
            <textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={3}
              className="w-full px-3 py-2 mt-1 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
          </div>
          <button onClick={onSave} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            {editing ? "Salvar alterações" : "Cadastrar Conta"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border">
        <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir esta conta? Todo o progresso de aquecimento e vídeos associados também serão removidos.</p>
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-md bg-secondary text-sm text-foreground">Cancelar</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium">Excluir</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default Notas;
