import { useEffect, useState } from "react";
import { Eye, EyeOff, Save } from "lucide-react";
import { loginRequest } from "@/features/instagram-publisher/login";

export type MetaConfig = {
  ready: boolean; callback: string; canManage?: boolean;
  appId?: string; configId?: string; secretConfigured?: boolean;
};
export function MetaAppConfig({ config, onSaved }: {
  config: MetaConfig; onSaved: (config: MetaConfig) => void;
}) {
  const [appId, setAppId] = useState(config.appId || "");
  const [configId, setConfigId] = useState(config.configId || "");
  const [secret, setSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    setAppId(config.appId || ""); setConfigId(config.configId || "");
  }, [config.appId, config.configId]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess(false);
    try {
      const result = await loginRequest<MetaConfig>("save_config", { appId, configId, appSecret: secret });
      setSecret(""); setVisible(false); onSaved(result); setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally { setBusy(false); }
  }
  return <form className="meta-app-config" onSubmit={save}>
    <h3>Configure a Meta aqui</h3>
    <p>Use as credenciais do app com Facebook Login for Business. A configuração vale para toda a Avança.</p>
    <fieldset disabled={busy}>
      <label htmlFor="meta-app-id">Meta App ID</label>
      <input id="meta-app-id" inputMode="numeric" pattern="[0-9]{5,40}" required autoComplete="off" value={appId} onChange={e => setAppId(e.target.value)} />
      <label htmlFor="meta-config-id">ID da configuração de login</label>
      <input id="meta-config-id" inputMode="numeric" pattern="[0-9]{5,40}" required autoComplete="off" value={configId} onChange={e => setConfigId(e.target.value)} />
      <label htmlFor="meta-app-secret">Meta App Secret</label>
      <div className="meta-app-secret">
        <input id="meta-app-secret" type={visible ? "text" : "password"} autoComplete="new-password" required={!config.secretConfigured || appId.trim() !== config.appId} pattern="[a-fA-F0-9]{32}" value={secret} onChange={e => setSecret(e.target.value)} placeholder={config.secretConfigured ? "Já configurado · deixe vazio para manter" : "Cole a chave secreta do aplicativo"} />
        <button type="button" onClick={() => setVisible(v => !v)} aria-label={visible ? "Ocultar secret" : "Mostrar secret"}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </div>
      <small>O Secret é enviado por conexão segura e armazenado criptografado no Vault. Depois de salvo, não é devolvido ao navegador.</small>
      <button type="submit" className="button button-primary"><Save size={16} /> {busy ? "Salvando…" : "Salvar configuração"}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {success && <p role="status">Configuração salva. Você já pode conectar uma conta.</p>}
  </form>;
}
