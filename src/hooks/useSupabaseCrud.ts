import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type TableName = "tasks" | "notes" | "links" | "funnels" | "funnel_nodes" | "funnel_edges" | "transactions" | "financial_accounts" | "financial_categories" | "financial_goals" | "folders" | "profiles";

export function useSupabaseCrud<T extends Record<string, any>>(table: TableName, orderBy = "created_at") {
  const { user } = useAuth();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: rows, error } = await (supabase.from(table) as any)
      .select("*")
      .eq("user_id", user.id)
      .order(orderBy, { ascending: false });
    if (error) toast.error(`Erro ao carregar: ${error.message}`);
    else setData((rows || []) as T[]);
    setLoading(false);
  }, [user, table, orderBy]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const create = async (item: Partial<T>) => {
    if (!user) return null;
    const { data: row, error } = await (supabase.from(table) as any)
      .insert({ ...item, user_id: user.id })
      .select()
      .single();
    if (error) {
      toast.error(`Erro ao criar: ${error.message}`);
      return null;
    }
    toast.success("Criado com sucesso!");
    setData((prev) => [row as T, ...prev]);
    return row as T;
  };

  const update = async (id: string, updates: Partial<T>) => {
    const { data: row, error } = await (supabase.from(table) as any)
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      toast.error(`Erro ao atualizar: ${error.message}`);
      return null;
    }
    toast.success("Atualizado!");
    setData((prev) => prev.map((r: any) => (r.id === id ? (row as T) : r)));
    return row as T;
  };

  const remove = async (id: string) => {
    const { error } = await (supabase.from(table) as any).delete().eq("id", id);
    if (error) {
      toast.error(`Erro ao excluir: ${error.message}`);
      return false;
    }
    toast.success("Excluído!");
    setData((prev) => prev.filter((r: any) => r.id !== id));
    return true;
  };

  return { data, loading, create, update, remove, refetch: fetchData };
}
