import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { validatePost, type Post } from './model';
type Schema = { public: { Tables: { instagram_publication_drafts: {
  Row: { [K in keyof Post]: Post[K] }; Insert: Partial<Post>; Update: Partial<Post>; Relationships: [];
} }; Views: Record<string, never>; Functions: Record<string, never> } };
const db = supabase as unknown as SupabaseClient<Schema>;
export async function listPosts(userId: string) {
  const { data, error } = await db.from('instagram_publication_drafts').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(error.code === '42P01' || error.code === 'PGRST205' ? 'A estrutura do Instagram ainda precisa ser instalada no banco de dados.' : 'Não foi possível carregar as postagens. Tente novamente.');
  return data as Post[];
}
export async function savePost(post: Omit<Post, 'created_at' | 'updated_at'>) {
  validatePost(post, post.status === 'waiting_integration');
  const { error } = await db.from('instagram_publication_drafts').upsert(post);
  if (error) throw new Error('Não foi possível salvar a postagem. Verifique a conexão e a instalação do banco.');
}
export async function cancelPost(id: string, userId: string) {
  const { data, error } = await db.from('instagram_publication_drafts').update({ status: 'cancelled' }).eq('id', id).eq('user_id', userId).neq('status', 'cancelled').select('id');
  if (error || !data?.length) throw new Error('Não foi possível cancelar. Atualize a lista e tente novamente.');
}
