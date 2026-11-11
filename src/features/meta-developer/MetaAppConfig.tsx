import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Plus, Save, ShieldCheck } from "lucide-react";
import { loginRequest } from "@/features/instagram-publisher/login";
import type { MetaApp, MetaConfig } from "./meta-apps";
export function MetaAppConfig({ app, onSaved, onCancel }: {
  app?: MetaApp; onSaved: (config: MetaConfig) => void; onCancel?: () => void;
}) {
  const [name, setName] = useState(app?.name || "");
  const [appId, setAppId] = useState(app?.appId || "");
  const [configId, setConfigId] = useState(app?.configId || "");
  const [secret, setSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await loginRequest<MetaConfig>("save_app", { ...(app ? { id: app.id } : {}), name, appId, configId, appSecret: secret });
      setSecret(""); setVisible(false);
      if (!app) { setName(""); setAppId(""); setConfigId(""); }
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally { setBusy(false); }
  }
  return <form className="meta-app-form" onSubmit={save}>
    <div className="meta-app-form-heading"><div><h3>{app ? `Editar ${app.name}` : "Adicionar outro app Meta"}</h3>
      <p>Copie as credenciais e, para Login Unificado, o Config ID do Meta for Developers.</p></div><Plus size={20} /></div>
    <fieldset disabled={busy} className="meta-fields">
      <label className="meta-wide" htmlFor="meta-app-name"><span>1. Nome interno</span>
        <input id="meta-app-name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: App Instagram 01" />
        <small>Um nome para você identificar este app no painel.</small></label>
      <label htmlFor="meta-app-id"><span>2. Meta App ID <b>obrigatório</b></span>
        <input id="meta-app-id" inputMode="numeric" pattern="[0-9]{5,40}" required autoComplete="off" value={appId} onChange={e => setAppId(e.target.value)} placeholder="Ex.: 123456789012345" />
        <small>Para Instagram Login, use o ID do produto Instagram.</small></label>
      <label htmlFor="meta-app-secret"><span>3. Meta App Secret <b>{app ? "protegido" : "obrigatório"}</b></span>
        <div className="meta-secret-input"><input id="meta-app-secret" type={visible ? "text" : "password"} autoComplete="new-password" required={!app || appId.trim() !== app.appId} pattern="[a-fA-F0-9]{32}" value={secret} onChange={e => setSecret(e.target.value)} placeholder={app ? "Deixe vazio para manter" : "Cole aqui o App Secret"} />
          <button type="button" onClick={() => setVisible(v => !v)} aria-label={visible ? "Ocultar secret" : "Mostrar secret"}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
        <small>O Secret fica oculto e não será exibido novamente.</small></label>
      <label className="meta-wide" htmlFor="meta-config-id"><span>Config ID (Login Unificado) <b>opcional</b></span>
        <input id="meta-config-id" inputMode="numeric" pattern="[0-9]{5,40}" autoComplete="off" value={configId} onChange={e => setConfigId(e.target.value)} placeholder="Deixe vazio para usar Instagram Login" />
        <small>Encontre em Login do Facebook para Empresas → Configurações. Deixe vazio para apps com Instagram Login.</small></label>
      <div className="meta-wide meta-form-actions"><button type="submit" className="button button-primary">{app ? <Save size={16} /> : <Plus size={16} />}{busy ? "Salvando…" : app ? "Salvar alterações" : "Adicionar app Meta"}</button>
        {onCancel && <button className="button button-secondary" type="button" onClick={onCancel}>Cancelar edição</button>}</div>
    </fieldset>
    {error && <p role="alert" className="meta-error">{error}</p>}
    <p className="meta-private"><ShieldCheck size={14} /> Os apps e chaves cadastrados aqui são privados da sua conta.</p>
  </form>;
}
