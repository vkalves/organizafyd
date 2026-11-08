import { User, Globe, Download, LogOut, Save, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { wipeInstagram } from "@/features/instagram/data";
import { GoogleCalendarSettings } from "@/features/google-calendar/GoogleCalendarSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    const data: Record<string, unknown> = {};
    for (const table of tables) {
      const { data: rows } = await supabase.from(table).select("*").eq("user_id", user.id);
      data[table] = rows || [];
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `organizafy-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup exportado!");
  };

  return (
    <div className="mx-auto min-w-0 max-w-2xl space-y-4">
      <header className="page-header">
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">Perfil, preferências, integrações e dados da conta.</p>
        </div>
      </header>

      {/* Perfil + Preferências em um único painel */}
      <section className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2.5">
            <User className="h-4 w-4 text-muted-foreground" />
            <h2 className="section-title">Perfil e preferências</h2>
          </div>
        </div>
        <div className="panel-body space-y-4">
          <div className="flex items-center gap-3.5 pb-1">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-secondary">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {profile?.display_name || "Usuário"}
              </p>
              <p className="break-all text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="cfg-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Nome de exibição
              </label>
              <Input
                id="cfg-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Seu nome"
              />
            </div>

            <div>
              <label htmlFor="cfg-tz" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Globe className="h-3.5 w-3.5" /> Fuso horário
              </label>
              <select
                id="cfg-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-10 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground focus:border-foreground/35 focus:outline-none"
              >
                <option value="America/Sao_Paulo">América/São Paulo (GMT-3)</option>
                <option value="America/Manaus">América/Manaus (GMT-4)</option>
                <option value="America/Fortaleza">América/Fortaleza (GMT-3)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cfg-week" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Início da semana
              </label>
              <select
                id="cfg-week"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="flex h-10 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground focus:border-foreground/35 focus:outline-none"
              >
                <option value="monday">Segunda-feira</option>
                <option value="sunday">Domingo</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={handleSave}>
              <Save className="h-4 w-4" /> Salvar alterações
            </Button>
          </div>
        </div>
      </section>

      <GoogleCalendarSettings />

      {/* Backup & Exportação */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="section-title">Backup dos dados</h2>
            <p className="section-subtitle">Baixe uma cópia de todas as suas tarefas e notas em JSON.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" /> Exportar JSON
          </Button>
        </div>
        <div className="pb-4" />
      </section>

      {/* Zona de atenção */}
      <section className="panel border-destructive/25">
        <div className="panel-head">
          <div>
            <h2 className="section-title">Zona de atenção</h2>
            <p className="section-subtitle">
              Ações sensíveis da conta e redefinição dos dados do Instagram.
            </p>
          </div>
        </div>
        <div className="panel-body flex flex-wrap items-center justify-between gap-3 border-t border-border mt-3 pt-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Zerar dados do Instagram</p>
            <p className="text-xs text-muted-foreground">
              Apaga contas, conteúdos e histórico do módulo Instagram.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setWipeOpen(true)}>
            <Trash2 className="h-4 w-4" /> Zerar Instagram
          </Button>
        </div>
        <div className="px-5 pb-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium text-foreground">Encerrar sessão</p>
            <p className="text-xs text-muted-foreground">Sair da sua conta neste dispositivo.</p>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sair da conta
          </Button>
        </div>
      </section>

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
            <Button
              type="button"
              variant="outline"
              disabled={wiping}
              onClick={() => setWipeOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
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
            >
              {wiping ? "Apagando…" : "Apagar tudo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Config;
