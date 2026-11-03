import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Instagram, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useInstagramData } from '@/features/instagram/data';
import { listPosts, savePost, cancelPost } from '@/features/instagram-publisher/api';
import type { Format, Post } from '@/features/instagram-publisher/model';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
const labels = { draft: 'Rascunho', waiting_integration: 'Aguardando integração', cancelled: 'Cancelado' };
const field = 'w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm';
export default function InstagramPublisher() {
 const { user } = useAuth();
 const accountsQuery = useInstagramData();
 const accounts = accountsQuery.data?.accounts ?? [];
 const cache = useQueryClient();
 const key = ['instagram-publisher', user?.id];
 const query = useQuery({ queryKey: key, queryFn: () => listPosts(user!.id), enabled: !!user });
 const [id, setId] = useState<string>(() => crypto.randomUUID());
 const [accountId, setAccountId] = useState('');
 const [caption, setCaption] = useState('');
 const [format, setFormat] = useState<Format>('Feed');
 const [media, setMedia] = useState('');
 const [time, setTime] = useState('');
 const [busy, setBusy] = useState(false);
 const [filter, setFilter] = useState('all');
 function reset() { setId(crypto.randomUUID()); setCaption(''); setMedia(''); setTime(''); }
 async function perform(run: () => Promise<void>) {
  setBusy(true);
  try { await run(); await cache.invalidateQueries({ queryKey: key }); }
  catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível concluir.'); }
  finally { setBusy(false); }
 }
 function save(queue: boolean) {
  if (!user) return;
  void perform(async () => {
   await savePost({ id, user_id: user.id, account_id: accountId, caption, format,
    media_urls: media.split('\n').map(v => v.trim()).filter(Boolean),
    scheduled_at: time ? new Date(time).toISOString() : null,
    status: queue ? 'waiting_integration' : 'draft' });
   reset(); toast.success(queue ? 'Planejamento salvo. Nenhuma publicação será enviada nesta etapa.' : 'Rascunho salvo.');
  });
 }
 function edit(post: Post) {
  setId(post.id); setAccountId(post.account_id); setCaption(post.caption); setFormat(post.format); setMedia(post.media_urls.join('\n'));
  const date = post.scheduled_at ? new Date(post.scheduled_at) : null;
  setTime(date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16) : '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
 }
 return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
  <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-semibold"><Instagram /> Instagram Studio</h1><p className="text-muted-foreground">Prepare suas publicações e organize sua fila.</p></div><Button variant="outline" asChild><Link to="/instagram">Gerenciar contas</Link></Button></header>
  <div className="operation-panel rounded-2xl border border-amber-500/30 p-4" role="status"><strong>Estrutura em preparação</strong><p className="text-sm text-muted-foreground">A conexão com a Meta e o envio automático ainda não estão ativos. Os horários são planejamento; suas postagens não serão publicadas até a integração ser ativada e você confirmar os envios.</p></div>
  {accountsQuery.isError && <p role="alert">Não foi possível carregar as contas. <Button variant="outline" onClick={() => accountsQuery.refetch()}>Tentar novamente</Button></p>}
  {query.isError && <div role="alert" className="text-destructive">{query.error.message} <Button variant="outline" onClick={() => query.refetch()}>Tentar novamente</Button></div>}
  <div className="grid gap-6 lg:grid-cols-2"><section className="operation-panel space-y-4 rounded-2xl p-5"><div className="flex justify-between"><h2 className="text-lg font-semibold">Preparar postagem</h2><Button variant="ghost" disabled={busy} onClick={reset}><Plus className="mr-1 h-4 w-4" />Nova</Button></div>
   <div><Label htmlFor="ig-account">Conta</Label><select id="ig-account" className={field} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Selecione uma conta</option>{accounts.map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}</select>{!accounts.length && !accountsQuery.isLoading && <p className="text-sm text-muted-foreground">Cadastre uma conta em Gerenciar contas para começar.</p>}</div>
   <div><Label htmlFor="ig-format">Formato</Label><select id="ig-format" className={field} value={format} onChange={e => setFormat(e.target.value as Format)}>{['Feed','Reel','Story','Carrossel'].map(v => <option key={v}>{v}</option>)}</select></div>
   <div><Label htmlFor="ig-caption">Legenda</Label><Textarea id="ig-caption" rows={5} maxLength={2200} value={caption} onChange={e => setCaption(e.target.value)} /><p className="text-right text-xs text-muted-foreground">{caption.length}/2.200</p></div>
   <div><Label htmlFor="ig-media">Links HTTPS das mídias</Label><Textarea id="ig-media" rows={3} placeholder="https://… (um link por linha)" value={media} onChange={e => setMedia(e.target.value)} /><p className="text-xs text-muted-foreground">Uma mídia para Feed, Reel ou Story; de 2 a 10 para carrossel. Upload e validação dos arquivos serão integrados na próxima etapa.</p></div>
   <div><Label htmlFor="ig-time">Data e horário planejados</Label><Input id="ig-time" type="datetime-local" value={time} onChange={e => setTime(e.target.value)} /><p className="text-xs text-muted-foreground">Fuso: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p></div>
   <div className="flex flex-wrap gap-2"><Button disabled={busy || query.isError || !accountId} variant="outline" onClick={() => save(false)}>Salvar rascunho</Button><Button disabled={busy || query.isError || !accountId} onClick={() => save(true)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}Salvar planejamento</Button></div>
  </section><section className="operation-panel space-y-4 rounded-2xl p-5"><h2 className="text-lg font-semibold">Fila de preparação</h2><Label htmlFor="ig-filter">Status</Label><select id="ig-filter" className={field} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos</option>{Object.entries(labels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
   {query.isLoading && <p>Carregando postagens…</p>}
   {query.data?.filter(p => filter === 'all' || p.status === filter).map(post => <article key={post.id} className="space-y-2 rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><strong>@{accounts.find(a => a.id === post.account_id)?.username ?? 'Conta'}</strong><span className="text-xs text-muted-foreground">{labels[post.status]}</span></div><p className="whitespace-pre-wrap break-words text-sm">{post.caption || 'Sem legenda'}</p><p className="text-xs text-muted-foreground">{post.format} · {post.media_urls.length} mídia(s) · {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString('pt-BR') : 'Sem horário'}</p>{post.status !== 'cancelled' && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => edit(post)}>Editar</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void perform(async () => { await cancelPost(post.id, user!.id); if (id === post.id) reset(); })}>Cancelar</Button></div>}</article>)}
   {!query.isLoading && !query.isError && !query.data?.some(p => filter === 'all' || p.status === filter) && <p className="py-8 text-center text-muted-foreground">Nenhuma postagem neste filtro.</p>}<p className="text-xs text-muted-foreground">Exibindo até 200 postagens recentes.</p>
  </section></div>
 </div>;
}
