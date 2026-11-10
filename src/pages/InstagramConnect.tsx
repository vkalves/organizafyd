import { useEffect, useRef, useState } from "react";
import { Instagram, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loginRequest } from "@/features/instagram-publisher/login";
type AccountChoice = { id: string; username: string };
type FinishResult = { username: string } | { selection: string; accounts: AccountChoice[] };
export default function InstagramConnect() {
  const [params] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)),
  );
  const [manager, setManager] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(true);
  const started = useRef(false);
  const [choice, setChoice] = useState<{ selection: string; verifier: string; accounts: AccountChoice[] } | null>(null);
  const [accountId, setAccountId] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    async function load() {
      try {
        if (params.has("error"))
          throw new Error(
            "Autorização cancelada. Solicite um novo link para tentar novamente.",
          );
        if (params.has("code")) {
          const state = params.get("state") || "";
          const key = "ig-login:" + state;
          const verifier = sessionStorage.getItem(key);
          sessionStorage.removeItem(key);
          if (!verifier)
            throw new Error(
              "Abra a autorização no mesmo navegador em que iniciou a conexão. Solicite um novo link.",
            );
          const result = await loginRequest<FinishResult>("finish", {
            code: params.get("code"),
            state,
            verifier,
            allow_selection: true,
          });
          if ("selection" in result) {
            setChoice({ ...result, verifier });
          } else {
            setSuccess(result.username);
          }
        } else {
          const info = await loginRequest<{ manager: string }>("invite_info", {
            invite: params.get("invite"),
          });
          setManager(info.manager);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha na conexão.");
      } finally {
        setBusy(false);
      }
    }
    void load();
  }, [params]);
  async function authorize() {
    setBusy(true);
    setError("");
    try {
      const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      const result = await loginRequest<{ url: string; state: string }>(
        "start",
        { invite: params.get("invite"), verifier },
      );
      sessionStorage.setItem("ig-login:" + result.state, verifier);
      window.location.assign(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na conexão.");
      setBusy(false);
    }
  }
  async function confirmAccount() {
    if (!choice || !accountId || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await loginRequest<{ username: string }>("select_account", {
        selection: choice.selection,
        verifier: choice.verifier,
        account_id: accountId,
      });
      setSuccess(result.username);
      setChoice(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na conexão. Solicite um novo link.");
    } finally { setBusy(false); }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="panel panel-body w-full max-w-md space-y-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-secondary text-foreground">
          <Instagram className="h-5 w-5" />
        </div>
        <h1 className="page-title">Conectar Instagram</h1>
        {busy && (
          <p role="status" className="flex gap-2">
            <Loader2 className="animate-spin" />
            Aguarde…
          </p>
        )}
        {choice && !success && (
          <form onSubmit={event => { event.preventDefault(); void confirmAccount(); }} className="space-y-4">
            <fieldset disabled={busy} className="space-y-3">
              <legend className="font-semibold">Qual Instagram deseja conectar?</legend>
              <p className="text-sm text-muted-foreground">A Meta autorizou mais de um perfil. Escolha uma conta para adicionar ao DISPARA.</p>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {choice.accounts.map(account => (
                  <label key={account.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:bg-secondary">
                    <input type="radio" name="instagram-account" value={account.id} checked={accountId === account.id} onChange={() => setAccountId(account.id)} className="h-4 w-4 shrink-0 accent-foreground" />
                    <span className="break-all">@{account.username}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={busy || !accountId} className="w-full">Conectar perfil escolhido</Button>
            <p className="text-xs text-muted-foreground">Somente o perfil escolhido será adicionado. Esta escolha expira em 10 minutos.</p>
          </form>
        )}
        {success ? (
          <div role="status">
            <h2 className="font-semibold">@{success} conectado!</h2>
            <p>
              O responsável já pode agendar publicações autorizadas. Use o botão abaixo para voltar às suas contas.
            </p>
            <Button asChild className="mt-4"><a href="/dispara/instagram">Voltar ao DISPARA</a></Button>
          </div>
        ) : (
          manager && (
            <>
              <p>
                Você está conectando seu Instagram à conta de{" "}
                <strong className="break-all">{manager}</strong> no DISPARA.
              </p>
              <p className="text-sm text-muted-foreground">
                Ao autorizar, esse responsável poderá agendar e publicar
                conteúdo no perfil escolhido. Use uma conta profissional. Sua
                senha é informada somente à Meta.
              </p>
              <Button disabled={busy} onClick={() => void authorize()}>
                Autorizar no Instagram
              </Button>
              <p className="text-xs text-muted-foreground">
                Na tela da Meta, escolha o portfólio correto. Se houver vários
                perfis autorizados, você escolherá qual conectar ao voltar ao
                DISPARA. Confira o @ antes de confirmar.
              </p>
            </>
          )
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!success && (error || choice) && <a href="/dispara/instagram" className="block text-sm underline">Voltar e gerar um novo link</a>}
        <div className="flex gap-4 text-xs">
          <a href="/privacidade" className="underline">
            Privacidade
          </a>
          <a href="/termos" className="underline">
            Termos
          </a>
        </div>
      </section>
    </main>
  );
}
