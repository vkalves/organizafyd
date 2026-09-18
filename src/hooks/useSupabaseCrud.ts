import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { AppTableName } from "@/integrations/supabase/app-types";

type CrudRow = { id: string };
type MutationOptions = { silent?: boolean };

export function useSupabaseCrud<T extends CrudRow>(table: AppTableName, orderBy = "created_at") {
  const { user } = useAuth();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: rows, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", user.id)
      .order(orderBy, { ascending: false });
    if (error) toast.error(`Erro ao carregar: ${error.message}`);
    else setData((rows || []) as unknown as T[]);
    setLoading(false);
  }, [user, table, orderBy]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const create = async (item: Partial<T>, options: MutationOptions = {}) => {
    if (!user) return null;
    setMutating(true);
    const { data: row, error } = await supabase
      .from(table)
      .insert({ ...item, user_id: user.id } as never)
      .select()
      .single();
    setMutating(false);
    if (error) {
      toast.error(`Erro ao criar: ${error.message}`);
      return null;
    }
    if (!options.silent) toast.success("Criado com sucesso!");
    setData((prev) => [row as unknown as T, ...prev]);
    return row as unknown as T;
  };

  const update = async (id: string, updates: Partial<T>, options: MutationOptions = {}) => {
    if (!user) return null;
    setMutating(true);
    const { data: row, error } = await supabase
      .from(table)
      .update(updates as never)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();
    setMutating(false);
    if (error) {
      toast.error(`Erro ao atualizar: ${error.message}`);
      return null;
    }
    if (!options.silent) toast.success("Atualizado!");
    setData((prev) => prev.map((record) => (record.id === id ? (row as unknown as T) : record)));
    return row as unknown as T;
  };

  const remove = async (id: string, options: MutationOptions = {}) => {
    if (!user) return false;
    setMutating(true);
    const { error } = await supabase.from(table).delete().eq("id", id).eq("user_id", user.id);
    setMutating(false);
    if (error) {
      toast.error(`Erro ao excluir: ${error.message}`);
      return false;
    }
    if (!options.silent) toast.success("Excluído!");
    setData((prev) => prev.filter((record) => record.id !== id));
    return true;
  };

  return { data, loading, mutating, create, update, remove, refetch: fetchData };
}
