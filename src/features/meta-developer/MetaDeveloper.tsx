import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Code2, Copy, ExternalLink, Instagram, Layers, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { loginRequest } from "@/features/instagram-publisher/login";
import { openBrowserLogin } from "@/features/instagram-publisher/browser-login";
import { MetaAppConfig } from "./MetaAppConfig";
import type { MetaApp, MetaConfig } from "./meta-apps";
import "./meta-developer.css";
const instagramScopes = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"];
export default function MetaDeveloper({ onConnected: _onConnected }: { onConnected: (id: string) => Promise<void> }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const queryKey = ["meta-apps", user?.id];
  const config = useQuery({ queryKey, queryFn: () => loginRequest<MetaConfig>("apps"), enabled: !!user, retry: false });
  const apps = config.data?.apps || [];
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState<MetaApp | undefined>();
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<MetaApp | undefined>();
  const active = apps.find(app => app.id === selectedId && app.active) || apps.find(app => app.active);
  const callback = config.data?.callback?.startsWith("https://") ? config.data.callback : "";
  function saved(data: MetaConfig) {
    client.setQueryData(queryKey, data); setEditing(undefined); setError("");
    setMessage("App salvo com segurança. A conexão está disponível.");
  }
  async function mutate(action: "toggle_app" | "delete_app", app: MetaApp) {
    setPending(app.id); setError(""); setMessage("");
    try {
      const data = await loginRequest<MetaConfig>(action, { id: app.id });
      client.setQueryData(queryKey, data); setDeleting(undefined);
      if (editing?.id === app.id && action === "delete_app") setEditing(undefined);
      setMessage(action === "delete_app" ? "App excluído." : "Status do app atualizado.");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar o app."); }
    finally { setPending(""); }
  }
  async function connect() {
    if (!active) return;
    setPending("connect"); setError(""); setMessage("");
    try {
      await openBrowserLogin(async () => {
        const data = await loginRequest<{ url: string }>("invite", { app_id: active.id });
        const url = new URL(data.url);
        const params = new URLSearchParams(url.hash.slice(1)); params.set("direct", "1");
        url.hash = params.toString(); return url.toString();
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível iniciar a conexão."); }
    finally { setPending(""); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(callback); setMessage("Endereço de retorno copiado."); }
    catch { setError("Não foi possível copiar. Selecione o endereço e copie manualmente."); }
  }
  return <section className="meta-connect-page" aria-label="Meta Developer">
    <header className="meta-connect-heading"><div className="meta-connect-mark"><Code2 size={24} /></div><div>
      <span className="eyebrow">INTEGRAÇÕES · AVANÇA</span><h1 className="page-title">Meta Developer</h1><p className="page-subtitle">Conecte seu Instagram pela API oficial da Meta.</p>
    </div></header>
    <div className="meta-connect-top">
      <section className="panel meta-connect-hero"><div><span className="eyebrow">COMECE POR AQUI</span><h2>Conectar Instagram</h2><p>A autorização acontece na tela oficial da Meta.</p></div>
        <div className="meta-connect-start"><label htmlFor="meta-active-app">App para esta conexão</label>
          <select id="meta-active-app" value={active?.id || ""} onChange={e => setSelectedId(e.target.value)} disabled={!apps.some(a => a.active) || !!pending}>
            {!active && <option value="">Cadastre um app para começar</option>}
            {apps.filter(a => a.active).map(app => <option key={app.id} value={app.id}>{app.name} · {app.configId ? "Login Unificado" : "Instagram Login"}</option>)}
          </select>
          <button type="button" className="button button-primary" disabled={!active || !!pending || config.isFetching} onClick={() => void connect()}>{pending === "connect" ? <Loader2 size={17} className="animate-spin" /> : <Instagram size={17} />}Conectar pelo Instagram</button>
        </div>
        <p className="meta-hint">Apps com Config ID usam o Login Unificado. Apps sem Config ID usam o Instagram Login. Ambos exigem uma conta profissional.</p>
        <div className="meta-ready" role="status"><span className={active ? "meta-status-dot ready" : "meta-status-dot"} />{config.isPending ? "Consultando seus apps…" : active ? <span><strong>{active.name}</strong> está pronto para iniciar a autorização com <strong>{active.configId ? "Login Unificado" : "Instagram Login"}</strong>.</span> : "Adicione seu primeiro app abaixo para liberar a conexão."}</div>
      </section>
      <aside className="panel meta-overview"><ShieldCheck size={23} /><span className="eyebrow">SUA INTEGRAÇÃO</span><h2>Seu app. Suas contas.</h2><p>Credenciais protegidas e autorização oficial. Sua senha do Instagram é informada somente à Meta.</p><div className="meta-overview-numbers"><div><strong>{apps.length}</strong><span>apps cadastrados</span></div><div><strong>{apps.reduce((n, a) => n + a.accountCount, 0)}</strong><span>contas vinculadas</span></div></div><Link className="button button-secondary" to="/avanca/instagram">Ver contas conectadas <ExternalLink size={14} /></Link></aside>
    </div>
    {config.isError && <div className="meta-feedback meta-error" role="alert"><span>Não foi possível consultar seus apps.</span><button type="button" className="button button-secondary" onClick={() => void config.refetch()}><RefreshCw size={14} />Tentar novamente</button></div>}
    {error && <p role="alert" className="meta-feedback meta-error">{error}</p>}
    {message && <p role="status" className="meta-feedback meta-success"><CheckCircle2 size={17} />{message}</p>}
    <section className="panel meta-apps-panel"><div className="panel-header"><div><h2 className="panel-title"><Layers size={18} /> Apps Meta Developer</h2><p className="panel-copy">Use um app diferente para novas autorizações. O App Secret nunca é exibido depois de salvo.</p></div><button type="button" className="icon-button" aria-label="Atualizar apps" disabled={config.isFetching} onClick={() => void config.refetch()}><RefreshCw size={16} /></button></div>
      <div className="notice"><strong>Como funciona:</strong> selecione o app desejado antes de conectar uma conta. Cada app precisa ter seu próprio produto, redirect URI e permissões configurados no Meta for Developers. Adicionar apps não contorna os limites da Meta.</div>
      <div className="meta-app-list">{apps.map(app => <article key={app.id} className={`meta-app-card ${app.active ? "" : "meta-app-card-disabled"}`}>
        <div className="meta-app-card-main"><div className="meta-app-icon"><Instagram size={19} /></div><div><strong>{app.name}</strong><span>App ID: <code>{app.appId}</code></span><small>{app.configId ? "Login Unificado" : "Instagram Login"}</small></div></div>
        <div className="meta-app-card-actions"><span className={`setup-status ${app.active ? "setup-ok" : "setup-pending"}`}>{app.active ? "Ativo" : "Desativado"}</span><span className="meta-app-account-count">{app.accountCount} {app.accountCount === 1 ? "conta" : "contas"}</span>
          <button type="button" className="button button-secondary" disabled={!!pending} onClick={() => void mutate("toggle_app", app)}>{app.active ? "Desativar" : "Ativar"}</button>
          <button type="button" className="button button-secondary" disabled={!!pending} onClick={() => { setEditing(app); setMessage(""); }}><Pencil size={13} />Editar Config ID</button>
          <button type="button" className="button button-danger" aria-label={`Excluir ${app.name}`} disabled={!!pending} onClick={() => setDeleting(app)}><Trash2 size={13} />Excluir</button></div>
      </article>)}</div>
      {!config.isPending && !config.isError && !apps.length && <div className="meta-empty"><Plus size={22} /><strong>Seu primeiro app começa aqui</strong><p>Cadastre as credenciais abaixo. Seus apps ficam disponíveis em todos os seus dispositivos.</p></div>}
      {deleting && <div className="notice meta-delete-confirm" role="alert"><p>Excluir <strong>{deleting.name}</strong>? As credenciais deste app serão removidas. Apps com contas vinculadas devem ser desativados.</p><button type="button" className="button button-danger" disabled={!!pending} onClick={() => void mutate("delete_app", deleting)}>Confirmar exclusão</button><button type="button" className="button button-secondary" disabled={!!pending} onClick={() => setDeleting(undefined)}>Cancelar</button></div>}
      <div className="meta-callbacks">{["Callback do Login Unificado", "Callback do Instagram Login"].map(label => <div className="meta-callback" key={label}><label htmlFor={label.endsWith("Instagram Login") ? "ig-callback" : "fb-callback"}>{label}</label><div><input id={label.endsWith("Instagram Login") ? "ig-callback" : "fb-callback"} readOnly value={callback} placeholder="Aguardando o endereço do servidor" onFocus={e => e.currentTarget.select()} /><button type="button" className="icon-button" disabled={!callback} aria-label={`Copiar ${label}`} onClick={() => void copy()}><Copy size={15} /></button></div></div>)}</div>
      {config.data && <MetaAppConfig key={editing?.id || "new"} app={editing} onSaved={saved} onCancel={editing ? () => setEditing(undefined) : undefined} />}
    </section>
    <div className="meta-bottom-grid"><section className="panel meta-steps"><div className="panel-header"><div><h2 className="panel-title">2. Faça em 3 passos</h2><p className="panel-copy">Depois de salvar as credenciais, siga esta ordem.</p></div></div>
      <div className="meta-step"><span>1</span><div><h3>Abra o Meta Developer</h3><p>Para Instagram Login, configure o produto e use o ID e a chave secreta do produto Instagram.</p><a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="button button-secondary">Abrir Meta Developer <ExternalLink size={14} /></a></div></div>
      <div className="meta-step"><span>2</span><div><h3>Prepare a conta</h3><p>A conta precisa ser Business ou Creator. O Instagram Login funciona sem vínculo com uma Página do Facebook.</p></div></div>
      <div className="meta-step"><span>3</span><div><h3>Cadastre o retorno e conecte</h3><p>Na Meta, coloque exatamente o callback acima em <strong>Valid OAuth Redirect URIs</strong>. Depois, selecione seu app e clique em Conectar pelo Instagram.</p></div></div>
    </section><aside className="meta-side-panels"><section className="panel meta-status-panel"><h2>Status atual</h2><p>Nada sensível é exibido aqui.</p><div className="meta-ready"><span className={active ? "meta-status-dot ready" : "meta-status-dot"} /><span>{active ? `App ativo: ${active.name}.` : "Nenhum app ativo."}</span></div><p>Esta área usa somente os apps Meta cadastrados por você.</p></section>
      <section className="panel meta-permissions"><h2>Permissões</h2><p>Permissões oficiais usadas para conectar e publicar.</p><div>{(active?.configId ? ["instagram_basic", "instagram_content_publish", "instagram_manage_insights"] : instagramScopes).map(scope => <code key={scope}>{scope}</code>)}</div><small>A conta precisa ser profissional. Para atender clientes externos, conclua as aprovações exigidas pela Meta.</small></section></aside></div>
    <section className="panel meta-after"><h2>Depois de conectar: automação</h2><p>O fluxo para publicar usa a API oficial da Meta.</p><div className="meta-after-grid">{[["Conecte a conta", "Autorize na tela oficial e confira se o perfil aparece conectado."], ["Crie um Reel", "Selecione a conta, envie seu vídeo e escolha publicar ou agendar."], ["A fila trabalha sozinha", "O servidor envia o conteúdo à Meta e acompanha o processamento."], ["Acompanhe o resultado", "Confira agendamentos e publicações. Acesso expirado pede reconexão."]].map(([title, text], i) => <div key={title}><span>{i + 1}</span><h3>{title}</h3><p>{text}</p></div>)}</div><Link to="/avanca/instagram" className="button button-secondary">Gerenciar apps e contas <ExternalLink size={14} /></Link></section>
  </section>;
}
