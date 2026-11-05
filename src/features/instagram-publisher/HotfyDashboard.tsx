import type { ReactNode } from 'react';
import { Bell, CalendarClock, CheckCircle2, Clapperboard, Inbox, Instagram, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Post } from './model';
import type { Connection } from './api';
import { healthLabels, healthDetails, type MonitorData, type HealthState } from './monitor';
export type InstagramView = 'flows' | 'dashboard' | 'compose' | 'queue' | 'accounts' | 'alerts' | 'analytics';
export function publishedToday(post: Post, now = new Date()) {
 if (post.status !== 'published' || !post.published_at) return false;
 const date = new Date(post.published_at);
 return date.toDateString() === now.toDateString();
}
export function HotfyDashboard({ accounts, connections, posts, monitor, loading, failed, monitorFailed, view, go, connect, markRead, reading }: {
 accounts: { id: string; username: string }[]; connections: Connection[]; posts: Post[]; monitor?: MonitorData;
 loading: boolean; failed: boolean; monitorFailed: boolean; view: InstagramView; go: (view: InstagramView, format?: 'Reel' | 'Story') => void;
 connect: ReactNode; markRead: (id: string) => void; reading: boolean;
}) {
 const pending = posts.filter(p => ['scheduled', 'processing'].includes(p.status));
 const next = [...pending].sort((a,b) => Date.parse(a.scheduled_at || '') - Date.parse(b.scheduled_at || ''))[0];
 const name = (id: string) => '@' + (accounts.find(a => a.id === id)?.username.replace(/^@/, '') || 'perfil');
 const state = (id: string): HealthState => monitor?.health.find(h => h.account_id === id)?.state ?? (connections.find(c => c.account_id === id)?.reconnect_required ? 'reconnect' : 'unknown');
 const alerts = monitor?.alerts ?? [];
 const active = alerts.filter(a => !a.resolved_at);
 const ranking = accounts.map(a => ({ ...a, published: posts.filter(p => p.account_id === a.id && p.status === 'published').length, today: posts.filter(p => p.account_id === a.id && publishedToday(p)).length, pending: pending.filter(p => p.account_id === a.id).length })).sort((a,b) => b.published - a.published);
 const stats = [
  ['Contas conectadas', accounts.length, 'perfis profissionais', 'accounts'],
  ['Reels agendados', pending.filter(p => p.format === 'Reel').length, 'na fila de publicação', 'queue'],
  ['Publicados hoje', posts.filter(p => publishedToday(p)).length, 'confirmados pela Meta', 'queue'],
  ['Contas com alerta', new Set(active.map(a => a.account_id)).size, 'precisam de atenção', 'alerts'],
 ] as const;
 return <div className="ig-hotfy-content">
  {view === 'dashboard' && <>
   <div className="ig-pulse" aria-label="Indicadores do Instagram">{stats.map(([title,value,detail,target]) => <button key={title} onClick={() => go(target)} className="ig-stat"><span>{title}</span><strong>{loading || failed || (target === 'alerts' && (!monitor || monitorFailed)) ? '—' : value}</strong><small>{detail}</small></button>)}</div>
   {!!active.length && <div role="status" className="ig-warning"><AlertTriangle size={20} /><div><strong>{active.length} alerta(s) de conta</strong><p>Há perfis que precisam da sua atenção.</p></div><Button variant="outline" onClick={() => go('alerts')}>Ver alertas</Button></div>}
   <div className="ig-dashboard-cols">
    <section className="operation-panel ig-panel"><div className="ig-panel-head"><div><h2>Próxima publicação</h2><p>O que está a caminho.</p></div><Button variant="outline" size="sm" onClick={() => go('queue')}>Ver agenda</Button></div>
     {loading ? <p role="status">Carregando sua fila…</p> : failed ? <p>Não foi possível consultar a próxima publicação.</p> : next ? <div className="ig-next"><div className="ig-media-icon"><Clapperboard /></div><div><strong>{name(next.account_id)}</strong><p className="ig-caption">{next.caption || 'Sem legenda'}</p><small>{next.format} · {next.scheduled_at ? new Date(next.scheduled_at).toLocaleString('pt-BR') : 'Sem horário'}</small></div><span className="ig-pill">{next.status === 'processing' ? 'Processando' : 'Agendado'}</span></div> : <div className="ig-empty"><CalendarClock /><strong>Nada agendado ainda</strong><p>Ao agendar uma publicação, ela aparece aqui com o horário e o perfil de destino.</p></div>}
    </section>
    <section className="operation-panel ig-panel ig-ready"><h2>Pronto para publicar?</h2><p>Conecte seu perfil pelo login oficial e prepare o próximo conteúdo.</p><div className="ig-actions">{connect}<Button variant="outline" onClick={() => go('compose','Reel')}><Clapperboard size={16} />Enviar um Reel</Button></div></section>
   </div>
   <section className="operation-panel ig-panel"><div className="ig-panel-head"><div><h2>Ranking das suas contas</h2><p>Organizado pelas publicações confirmadas no histórico recente.</p></div></div>
    {loading ? <p>Carregando contas…</p> : failed ? <p>Histórico indisponível. Tente atualizar os dados.</p> : ranking.length ? <div className="ig-table-scroll"><table className="ig-table"><thead><tr><th>Posição</th><th>Perfil</th><th>Publicados</th><th>Na fila</th><th>Posts de hoje</th></tr></thead><tbody>{ranking.map((a,i) => <tr key={a.id}><td><span className="ig-rank">{i+1}</span></td><td><strong>{name(a.id)}</strong></td><td>{a.published}</td><td>{a.pending}</td><td>{a.today}</td></tr>)}</tbody></table></div> : <div className="ig-empty"><Inbox /><p>Conecte uma conta para começar a acompanhar suas publicações.</p></div>}
    <p className="ig-footnote">Publicações: até 200 registros recentes. “Hoje” usa o horário deste dispositivo. Alcance e cliques ainda não estão disponíveis nesta integração.</p>
   </section>
  </>}
  {(view === 'dashboard' || view === 'accounts') && <section className="operation-panel ig-panel"><div className="ig-panel-head"><div><h2>Performance por conta</h2><p>Publicações, fila e situação de cada perfil conectado.</p></div><ShieldCheck className="text-muted-foreground" /></div>
   {loading ? <p>Carregando perfis…</p> : failed ? <p>Não foi possível carregar os perfis.</p> : accounts.length ? <div className="ig-table-scroll"><table className="ig-table"><thead><tr><th>Conta</th><th>Posts</th><th>Na fila</th><th>Status</th><th>Última verificação</th></tr></thead><tbody>{ranking.map(a => { const health = monitor?.health.find(h => h.account_id === a.id); const status = state(a.id); const paused = connections.find(c => c.account_id === a.id)?.paused; return <tr key={a.id}><td><span className="ig-account"><Instagram size={17}/><strong>{name(a.id)}</strong></span></td><td>{a.published}</td><td>{a.pending}</td><td><span className={`ig-pill ${status === 'healthy' ? 'ok' : status !== 'unknown' ? 'warn' : ''}`}>{monitorFailed ? 'Monitor indisponível' : healthLabels[status]}</span>{paused && <small className="block mt-2">Publicação pausada</small>}</td><td>{health?.checked_at ? new Date(health.checked_at).toLocaleString('pt-BR') : 'Aguardando'}</td></tr>; })}</tbody></table></div> : <div className="ig-empty"><Instagram /><strong>Nenhuma conta para mostrar</strong><p>Conecte um perfil do Instagram para acompanhar cada conta.</p>{connect}</div>}
   <p className="ig-footnote">Monitoramento automático em segundo plano. Perfil inacessível pode significar restrição, conta desativada ou falta de acesso; confirme no aplicativo do Instagram.</p>
   {view === 'accounts' && <div className="ig-actions">{connect}<Button variant="outline" onClick={() => go('compose')}>Gerenciar conexão e publicação</Button></div>}
  </section>}
  {view === 'alerts' && <section className="operation-panel ig-panel"><div className="ig-panel-head"><div><h2>Central de alertas</h2><p>Problemas detectados e histórico de recuperação das contas.</p></div><Bell /></div>
   {monitorFailed ? <p role="alert">Monitoramento indisponível no momento. Os status anteriores não confirmam a situação atual.</p> : !monitor ? <p role="status">Carregando alertas…</p> : !alerts.length ? <div className="ig-empty"><CheckCircle2 /><strong>Nenhum alerta registrado</strong><p>Quando uma conexão apresentar problemas, o aviso aparecerá aqui e no sino do site.</p></div> : <div className="ig-alert-list">{alerts.map(a => <article key={a.id} className={`ig-alert ${a.resolved_at ? 'resolved' : ''}`}><div><span className="ig-pill">{a.resolved_at ? 'Resolvido' : a.read_at ? 'Lido · ainda ativo' : 'Novo alerta'}</span><h3>{name(a.account_id)} · {healthLabels[a.state]}</h3><p>{healthDetails[a.state]}</p><small>{new Date(a.created_at).toLocaleString('pt-BR')}{a.resolved_at && ` · Resolvido em ${new Date(a.resolved_at).toLocaleString('pt-BR')}`}</small></div>{!a.read_at && <Button size="sm" variant="outline" disabled={reading} onClick={() => markRead(a.id)}>Marcar como lido</Button>}</article>)}</div>}
   <div className="ig-actions">{connect}</div>
  </section>}
 </div>;
}
