import { useEffect, useRef, useState } from "react";
import { Instagram, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loginRequest } from "@/features/instagram-publisher/login";
export default function InstagramConnect() {
  const [params] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)),
  );
  const [manager, setManager] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(true);
  const started = useRef(false);
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
          const result = await loginRequest<{ username: string }>("finish", {
            code: params.get("code"),
            state,
            verifier,
          });
          setSuccess(result.username);
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
                Na tela da Meta, escolha o portfólio correto e apenas um perfil
                do Instagram. Confira o @ antes de autorizar. Você pode revogar
                o acesso posteriormente nas configurações do Instagram.
              </p>
            </>
          )
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
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
