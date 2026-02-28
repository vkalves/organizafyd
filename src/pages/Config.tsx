import { Settings, User, Globe, Download, Upload, LogOut, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const { data: profiles, update } = useSupabaseCrud<Profile>("profiles");
  const profile = profiles[0];
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [weekStart, setWeekStart] = useState("monday");

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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie seu perfil e preferências</p>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><User className="w-4 h-4" /> Perfil</h2>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
            <User className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm text-foreground font-medium">{profile?.display_name || "Usuário"}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Nome</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Save className="w-4 h-4" /> Salvar Perfil
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
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

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Download className="w-4 h-4" /> Backup & Exportação</h2>
        <button onClick={handleExport} className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-sm text-foreground hover:bg-accent transition-colors">
          <Download className="w-4 h-4" /> Exportar JSON
        </button>
      </div>

      <button onClick={signOut} className="flex items-center gap-2 px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors">
        <LogOut className="w-4 h-4" /> Sair da Conta
      </button>
    </div>
  );
};

export default Config;
