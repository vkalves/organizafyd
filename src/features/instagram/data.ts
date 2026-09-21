import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Rows, Table } from "./model";
// Extend the generated schema locally until Supabase types are regenerated after migration.
type InstagramDatabase = {
  public: {
    Tables: {
      [K in Table as `instagram_${K}`]: {
        Row: { [P in keyof Rows[K]]: Rows[K][P] };
        Insert: { [P in keyof Rows[K]]?: Rows[K][P] };
        Update: { [P in keyof Rows[K]]?: Rows[K][P] };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
const db = supabase as unknown as SupabaseClient<InstagramDatabase>;
export function useInstagramData() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["instagram", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) throw new Error("Entre na sua conta.");
      const read = async <K extends Table>(table: K): Promise<Rows[K][]> => {
        const rows: Rows[K][] = [];
        // Supabase caps responses: paginate instead of silently losing records after 1,000.
        for (let offset = 0; ; offset += 500) {
          const result = await db
            .from(`instagram_${table}` as `instagram_${Table}`)
            .select("*")
            .eq("user_id", user.id)
            .order("id")
            .range(offset, offset + 499);
          if (result.error) throw result.error;
          const page = result.data as unknown as Rows[K][];
          rows.push(...page);
          if (page.length < 500) return rows;
        }
      };
      const [
        projects,
        accounts,
        labels,
        account_labels,
        contents,
        tasks,
        metrics,
        history,
      ] = await Promise.all([
        read("projects"),
        read("accounts"),
        read("labels"),
        read("account_labels"),
        read("contents"),
        read("tasks"),
        read("metrics"),
        read("history"),
      ]);
      let ideas: Rows["ideas"][] = [];
      try {
        ideas = await read("ideas");
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "42P01" && code !== "PGRST205") throw error;
      }
      return {
        projects,
        accounts,
        labels,
        account_labels,
        contents,
        tasks,
        metrics,
        history,
        ideas,
      };
    },
  });
  const mutation = useMutation({
    mutationFn: async ({
      table,
      id,
      values,
      remove,
      quiet,
    }: {
      table: Exclude<Table, "history">;
      id?: string;
      values?: Record<string, unknown>;
      remove?: boolean;
      quiet?: boolean;
    }) => {
      if (!user) throw new Error("Sessão encerrada. Entre novamente.");
      const clean = { ...values };
      delete clean.id;
      delete clean.user_id;
      delete clean.created_at;
      delete clean.updated_at;
      delete clean.quantity;
      delete clean.device;
      const target = db.from(`instagram_${table}` as `instagram_${Table}`);
      const result = remove
        ? await target
            .delete()
            .eq("id", id!)
            .eq("user_id", user.id)
            .select("id")
            .single()
        : id
          ? await target
              .update(clean)
              .eq("id", id)
              .eq("user_id", user.id)
              .select()
              .single()
          : await target
              .insert({ ...clean, user_id: user.id })
              .select()
              .single();
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_data, vars) => {
      await cache.invalidateQueries({ queryKey: ["instagram", user?.id] });
      if (!vars.quiet) toast.success("Salvo com sucesso");
    },
    onError: (e: { message?: string; code?: string }) =>
      toast.error(
        e.code === "23505"
          ? "Este registro já existe. Edite o registro existente."
          : e.message || "Não foi possível salvar. Tente novamente.",
      ),
  });
  return { ...query, save: mutation.mutateAsync, saving: mutation.isPending };
}
export type InstagramData = NonNullable<
  ReturnType<typeof useInstagramData>["data"]
>;
