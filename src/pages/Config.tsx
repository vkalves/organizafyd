import { User, Globe, Download, LogOut, Save, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { wipeInstagram } from "@/features/instagram/data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string | null;
  week_start: string | null;
}

const Config = () => {
  const { user, signOut } = useAuth();
  const cache = useQueryClient();
  const { data: profiles, update } = useSupabaseCrud<Profile>("profiles");
  const profile = profiles[0];
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [weekStart, setWeekStart] = useState("monday");
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || "");
      setTimezone(profile.timezone || "America/Sao_Paulo");
      setWeekStart(profile.week_start || "monday");
    }
  }, [profile]);

  const handleSave = async () => {
    if (!profile) return;
    await update(profile.id, { display_name: displayName, timezone, week_start: weekStart });
  };

  const handleExport = async () => {
    if (!user) return;
    const tables = ["tasks", "notes", "links", "funnels", "transactions", "financial_accounts", "financial_categories", "folders"] as const;
    const data: Record<string, any> = {};
    for (const table of tables) {
      const { data: rows } = await (supabase.from(table) as any).select("*").eq("user_id", user.id);
      data[table] = rows || [];
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `organify-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup exportado!");
  };

  return (
    <div className="mx-auto min-w-0 max-w-2xl space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie seu perfil e preferências</p>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><User className="w-4 h-4" /> Perfil</h2>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
            <User className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground font-medium">{profile?.display_name || "Usuário"}</p>
            <p className="break-all text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Nome</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <button onClick={handleSave} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto">
          <Save className="w-4 h-4" /> Salvar Perfil
        </button>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Globe className="w-4 h-4" /> Preferências</h2>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Fuso horário</label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
            className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
            <option value="America/Sao_Paulo">América/São Paulo (GMT-3)</option>
            <option value="America/Manaus">América/Manaus (GMT-4)</option>
            <option value="America/Fortaleza">América/Fortaleza (GMT-3)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Início da semana</label>
          <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)}
            className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
            <option value="monday">Segunda-feira</option>
            <option value="sunday">Domingo</option>
          </select>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Download className="w-4 h-4" /> Backup & Exportação</h2>
        <button onClick={handleExport} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent sm:w-auto">
          <Download className="w-4 h-4" /> Exportar JSON
        </button>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Trash2 className="w-4 h-4" /> Instagram
        </h2>
        <p className="text-sm text-muted-foreground">
          Apaga contas, conteúdos pendentes, prontos, ideias e o restante do
          Instagram. Não dá para desfazer.
        </p>
        <button
          type="button"
          onClick={() => setWipeOpen(true)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 sm:w-auto"
        >
          <Trash2 className="w-4 h-4" /> Zerar Instagram
        </button>
      </div>

      <button onClick={signOut} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 sm:w-auto">
        <LogOut className="w-4 h-4" /> Sair da Conta
      </button>
      <Dialog open={wipeOpen} onOpenChange={(open) => !wiping && setWipeOpen(open)}>
        <DialogContent className="w-[calc(100%_-_1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Zerar Instagram</DialogTitle>
            <DialogDescription>
              Apagar todas as contas, conteúdos, ideias e histórico do Instagram?
              Essa ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={wiping}
              onClick={() => setWipeOpen(false)}
              className="flex min-h-11 items-center rounded-md border border-border px-4 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={wiping || !user}
              onClick={async () => {
                if (!user) return;
                setWiping(true);
                try {
                  await wipeInstagram(user.id);
                  await cache.invalidateQueries({ queryKey: ["instagram"] });
                  toast.success("Instagram zerado");
                  setWipeOpen(false);
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Não foi possível zerar o Instagram.",
                  );
                } finally {
                  setWiping(false);
                }
              }}
              className="flex min-h-11 items-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground"
            >
              {wiping ? "Apagando…" : "Apagar tudo"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Config;
