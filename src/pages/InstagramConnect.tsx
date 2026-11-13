import { useEffect, useRef, useState } from "react";
import { Instagram, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loginRequest } from "@/features/instagram-publisher/login";
import {
  clearBrowserAuthorization, readBrowserAuthorization, readPendingAuthorization,
  rememberBrowserAuthorization, rememberPendingAuthorization, type BrowserAuthorization,
} from "@/features/instagram-publisher/browser-authorization";

type AccountChoice = { id: string; username: string };
type FinishResult = { username: string } | { selection: string; accounts: AccountChoice[] };
type RecoveryResult = {
  status: "pending" | "processing" | "selection_required" | "completed" | "restart_required";
  result?: FinishResult;
};
async function beginAuthorization(invite: string | null, expectedUsername?: string) {
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(v => v.toString(16).padStart(2, "0")).join("");
  const result = await loginRequest<{ url: string; state: string }>("start", { invite, verifier });
  rememberBrowserAuthorization(result.state, verifier, expectedUsername);
  window.location.assign(result.url);
}
export default function InstagramConnect() {
  const [params] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const [provider, setProvider] = useState("instagram");
  const [manager, setManager] = useState("");
  const [expectedUsername, setExpectedUsername] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(true);
  const [recoverable, setRecoverable] = useState(false);
  const [authorization, setAuthorization] = useState<BrowserAuthorization | null>(null);
  const [choice, setChoice] = useState<{ selection: string; accounts: AccountChoice[] } | null>(null);
  const [accountId, setAccountId] = useState("");
  const started = useRef(false);

  function applyResult(result: FinishResult, proof: BrowserAuthorization) {
    setRecoverable(false);
    setError("");
    if ("selection" in result) {
      rememberPendingAuthorization(proof, result.selection);
      setAuthorization({ ...proof, selection: result.selection });
      setChoice(result);
    } else {
      clearBrowserAuthorization(proof.state);
      setSuccess(result.username);
      setChoice(null);
      setAuthorization(null);
    }
  }
  async function recover(proof: BrowserAuthorization, originalError?: string) {
    const values = proof.selection
      ? { selection: proof.selection, verifier: proof.verifier }
      : { state: proof.state, verifier: proof.verifier };
    try {
      const recovery = await loginRequest<RecoveryResult>("recovery_status", values);
      if ((recovery.status === "completed" || recovery.status === "selection_required") && recovery.result) {
        applyResult(recovery.result, proof);
        return;
      }
      if (recovery.status === "restart_required" || recovery.status === "pending") {
        clearBrowserAuthorization(proof.state);
        setAuthorization(null);
        setRecoverable(false);
        setChoice(null);
        setError(originalError || "A autorização não foi concluída. Gere um novo link e autorize novamente; o código anterior não será reenviado.");
        return;
      }
      setRecoverable(true);
      setError("A autorização ainda está sendo processada. Verifique o resultado antes de iniciar outra conexão.");
    } catch {
      setRecoverable(true);
      setError(originalError || "Não foi possível consultar o resultado. A autorização anterior não será repetida. Verifique novamente quando a conexão voltar.");
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    async function load() {
      try {
        if (params.has("error")) throw new Error("Autorização cancelada. Solicite um novo link para tentar novamente.");
        if (params.has("code")) {
          const proof = readBrowserAuthorization(params.get("state") || "");
          if (!proof) throw new Error("A validação da conexão expirou ou está em outro navegador. Gere um novo link e conclua a autorização no navegador em que você o abriu.");
          rememberPendingAuthorization(proof);
          setAuthorization(proof);
          setExpectedUsername(proof.expectedUsername || "");
          try {
            const result = await loginRequest<FinishResult>("finish", {
              code: params.get("code"), state: proof.state, verifier: proof.verifier, allow_selection: true,
            });
            applyResult(result, proof);
          } catch (e) {
            await recover(proof, e instanceof Error ? e.message : undefined);
          }
        } else if (params.has("invite")) {
          const info = await loginRequest<{ manager: string; provider?: string; expected_username?: string }>("invite_info", { invite: params.get("invite") });
          setProvider(info.provider || "instagram");
          setExpectedUsername(info.expected_username || "");
          if (params.get("direct") === "1") await beginAuthorization(params.get("invite"), info.expected_username);
          else setManager(info.manager);
        } else {
          const pending = readPendingAuthorization();
          if (!pending) throw new Error("Abra um link de conexão válido na Avança para começar.");
          setAuthorization(pending);
          setExpectedUsername(pending.expectedUsername || "");
          await recover(pending);
        }
      } catch (e) { setError(e instanceof Error ? e.message : "Falha na conexão."); }
      finally { setBusy(false); }
    }
    void load();
  // Authorization is intentionally initialized once per page, including StrictMode remounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  async function authorize() {
    if (busy) return;
    setBusy(true); setError("");
    try { await beginAuthorization(params.get("invite"), expectedUsername || undefined); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha na conexão."); setBusy(false); }
  }
  async function confirmAccount() {
    if (!choice || !authorization || !accountId || busy) return;
    setBusy(true); setError("");
    try {
      const result = await loginRequest<{ username: string }>("select_account", {
        selection: choice.selection, verifier: authorization.verifier, account_id: accountId,
      });
      applyResult(result, authorization);
    } catch (e) {
      await recover({ ...authorization, selection: choice.selection }, e instanceof Error ? e.message : undefined);
    } finally { setBusy(false); }
  }
  async function checkResult() {
    if (!authorization || busy) return;
    setBusy(true); setError("");
    try { await recover(authorization); } finally { setBusy(false); }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="panel panel-body w-full max-w-md space-y-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-secondary text-foreground"><Instagram className="h-5 w-5" /></div>
        <h1 className="page-title">Conectar Instagram</h1>
        {expectedUsername && <p className="rounded-lg border border-border p-3 text-sm">Conta esperada: <strong className="break-all">@{expectedUsername}</strong>. Use a mesma conta no aplicativo Android e neste navegador.</p>}
        {busy && <p role="status" className="flex gap-2"><Loader2 className="animate-spin" />Aguarde…</p>}
        {choice && !success && !recoverable && (
          <form onSubmit={event => { event.preventDefault(); void confirmAccount(); }} className="space-y-4">
            <fieldset disabled={busy} className="space-y-3">
              <legend className="font-semibold">Qual Instagram deseja conectar?</legend>
              <p className="text-sm text-muted-foreground">A Meta autorizou mais de um perfil. Escolha uma conta para adicionar à Avança.</p>
              <div className="max-h-64 space-y-2 overflow-y-auto">{choice.accounts.map(account => (
                <label key={account.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:bg-secondary">
                  <input type="radio" name="instagram-account" value={account.id} checked={accountId === account.id} onChange={() => setAccountId(account.id)} className="h-4 w-4 shrink-0 accent-foreground" />
                  <span className="break-all">@{account.username}</span>
                </label>
              ))}</div>
            </fieldset>
            <Button type="submit" disabled={busy || !accountId} className="w-full">Conectar perfil escolhido</Button>
            <p className="text-xs text-muted-foreground">Somente o perfil escolhido será adicionado. Esta escolha expira em 10 minutos.</p>
          </form>
        )}
        {success ? (
          <div role="status"><h2 className="font-semibold">@{success} conectado!</h2><p>O responsável já pode agendar publicações autorizadas. Use o botão abaixo para voltar às suas contas.</p><Button asChild className="mt-4"><a href="/avanca/instagram">Voltar à Avança</a></Button></div>
        ) : manager && (
          <><p>Você está conectando seu Instagram à conta de <strong className="break-all">{manager}</strong> na Avança.</p><p className="text-sm text-muted-foreground">Ao autorizar, esse responsável poderá agendar e publicar conteúdo no perfil escolhido. Use uma conta profissional. Sua senha é informada somente à Meta.</p><Button disabled={busy} onClick={() => void authorize()}>Autorizar no Instagram</Button><p className="text-xs text-muted-foreground">{provider === "facebook" ? "Na tela da Meta, escolha o portfólio correto. Se houver vários perfis, escolha qual conectar ao voltar à Avança." : "Entre no Instagram profissional que deseja conectar e autorize o acesso ao perfil e à publicação. Não é necessário vincular uma Página do Facebook."}</p></>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {recoverable && !success && <Button disabled={busy} onClick={() => void checkResult()} className="w-full">Verificar resultado</Button>}
        {!success && (error || choice) && <a href="/avanca/instagram" className="block text-sm underline">Voltar e gerar um novo link</a>}
        <div className="flex gap-4 text-xs"><a href="/privacidade" className="underline">Privacidade</a><a href="/termos" className="underline">Termos</a></div>
      </section>
    </main>
  );
}
