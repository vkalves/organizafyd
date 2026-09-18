import { Download, Globe, LogOut, Save, Settings, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { supabase } from "@/integrations/supabase/client";
import type { AppTableName } from "@/integrations/supabase/app-types";
import { toLocalDateInput } from "@/lib/date";
import { toast } from "sonner";

interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string | null;
  week_start: string | null;
}

const exportTables: AppTableName[] = [
  "tasks",
  "notes",
  "links",
  "folders",
  "funnels",
  "funnel_nodes",
  "funnel_edges",
  "transactions",
  "financial_accounts",
  "financial_categories",
  "financial_goals",
  "instagram_accounts",
  "instagram_warmup_progress",
  "instagram_videos",
];

const Config = () => {
  const { user, signOut } = useAuth();
  const { data: profiles, create, update, mutating } = useSupabaseCrud<Profile>("profiles");
  const profile = profiles[0];
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [weekStart, setWeekStart] = useState("monday");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || "");
      setTimezone(profile.timezone || "America/Sao_Paulo");
      setWeekStart(profile.week_start || "monday");
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user) return;
    const updates = { display_name: displayName.trim() || null, timezone, week_start: weekStart };
    if (profile) {
      await update(profile.id, updates);
    } else {
      await create({ user_id: user.id, ...updates });
    }
  };

  const handleExport = async () => {
    if (!user || exporting) return;
    setExporting(true);
    try {
      const results = await Promise.all(
        exportTables.map(async (table) => {
          const { data: rows, error } = await supabase.from(table).select("*").eq("user_id", user.id);
          if (error) throw new Error(`${table}: ${error.message}`);
          return [table, (rows || []) as unknown[]] as const;
        }),
      );
      const data: Record<string, unknown[]> = Object.fromEntries(results);
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), data }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `organizafy-backup-${toLocalDateInput()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Backup exportado com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível exportar o backup.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-shell max-w-3xl">
      <header className="page-header">
        <div>
          <p className="eyebrow"><Settings className="h-3.5 w-3.5" /> Preferências</p>
          <h1 className="page-title">Configurações</h1>
          <p className="page-description">Personalize seu perfil, o fuso horário e os seus dados.</p>
        </div>
      </header>

      <section className="surface-card space-y-5">
        <div>
          <h2 className="section-title"><User className="h-4 w-4" /> Perfil</h2>
          <p className="section-description">Essas informações aparecem na sua área de trabalho.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <User className="h-7 w-7" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium text-foreground">{profile?.display_name || "Usuário"}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="display-name">Nome de exibição</label>
          <input className="field" id="display-name" type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Como devemos chamar você?" />
        </div>
        <button type="button" onClick={handleSave} disabled={mutating} className="action-primary">
          <Save className="h-4 w-4" aria-hidden="true" />
          {mutating ? "Salvando…" : "Salvar perfil"}
        </button>
      </section>

      <section className="surface-card space-y-5">
        <div>
          <h2 className="section-title"><Globe className="h-4 w-4" /> Preferências regionais</h2>
          <p className="section-description">Defina como datas e semanas aparecem no Organizafy.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="form-field">
            <label htmlFor="timezone">Fuso horário</label>
            <select className="field" id="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              <option value="America/Sao_Paulo">Brasília (GMT-3)</option>
              <option value="America/Manaus">Manaus (GMT-4)</option>
              <option value="America/Fortaleza">Fortaleza (GMT-3)</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="week-start">Início da semana</label>
            <select className="field" id="week-start" value={weekStart} onChange={(event) => setWeekStart(event.target.value)}>
              <option value="monday">Segunda-feira</option>
              <option value="sunday">Domingo</option>
            </select>
          </div>
        </div>
      </section>

      <section className="surface-card space-y-4">
        <div>
          <h2 className="section-title"><Download className="h-4 w-4" /> Backup e exportação</h2>
          <p className="section-description">Baixe uma cópia dos seus dados para guardar ou migrar.</p>
        </div>
        <button type="button" onClick={handleExport} disabled={exporting} className="action-secondary">
          <Download className="h-4 w-4" aria-hidden="true" />
          {exporting ? "Preparando backup…" : "Exportar backup JSON"}
        </button>
      </section>

      <section className="surface-card border-destructive/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-foreground">Sessão</h2>
            <p className="section-description">Encerre o acesso neste dispositivo.</p>
          </div>
          <button type="button" onClick={signOut} className="action-danger">
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sair da conta
          </button>
        </div>
      </section>
    </div>
  );
};

export default Config;
