import { loginRequest } from "./login";
import { useEffect, useState } from "react";
import { Loader2, Plus, CheckCircle2 } from "lucide-react";
import { publisherRequest } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
type Profile = { id: string; username: string };
export function ConnectAccount({
  onConnected,
  className,
  variant = "outline",
  size = "sm",
}: {
  onConnected: (id: string) => Promise<void>;
  className?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Conectar conta
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conectar Instagram</DialogTitle>
            <DialogDescription>
              Autorize seu perfil ou envie um link para o responsável pela
              conta.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <div className="space-y-5">
              <DirectLogin />
              <details>
                <summary className="cursor-pointer text-sm">
                  Conexão manual via Facebook (avançado)
                </summary>
                <ConnectionForm
                  onConnected={onConnected}
                  onClose={() => setOpen(false)}
                />
              </details>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function ConnectionForm({
  onConnected,
  onClose,
}: {
  onConnected: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [token, setToken] = useState("");
  const [graphId, setGraphId] = useState("");
  const [manual, setManual] = useState(false);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  function clearResults() {
    setProfiles(null);
    setSelected("");
    setError("");
  }
  async function search() {
    setBusy(true);
    setError("");
    setProfiles(null);
    setSelected("");
    try {
      const data = await publisherRequest<{ profiles: Profile[] }>("discover", {
        token: token.trim(),
        ...(manual && graphId.trim() ? { graph_id: graphId.trim() } : {}),
      });
      setProfiles(data.profiles);
      if (data.profiles.length === 1) setSelected(data.profiles[0].id);
      if (!data.profiles.length) setManual(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na busca.");
      setManual(true);
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const data = await publisherRequest<{
        account_id: string;
        username: string;
      }>("connect", { token: token.trim(), graph_id: selected });
      setToken("");
      setSuccess(data.username);
      await onConnected(data.account_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na conexão.");
    } finally {
      setBusy(false);
    }
  }
  if (success)
    return (
      <div className="space-y-4 py-4 text-center" role="status">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
        <h3 className="font-semibold">@{success} conectado</h3>
        <p className="text-sm text-muted-foreground">
          O perfil já está selecionado para preparar sua próxima postagem.
        </p>
        <Button onClick={onClose}>Preparar postagem</Button>
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/30 p-3 text-sm">
        Use uma conta profissional (Empresa ou Criador) vinculada a uma Página
        do Facebook e um token com permissão de publicação.
      </div>
      <div className="space-y-2">
        <Label htmlFor="connect-token">1. Token de acesso da Meta</Label>
        <Input
          id="connect-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
          disabled={busy}
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            clearResults();
          }}
          placeholder="Cole o token aqui"
        />
        <p className="text-xs text-muted-foreground">
          O token será salvo protegido no servidor ao confirmar a conexão.
        </p>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer">Onde consigo o token?</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Abra o{" "}
            <a
              className="underline"
              href="https://developers.facebook.com/tools/explorer/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Explorador da Graph API da Meta
            </a>{" "}
            e selecione seu aplicativo.
          </li>
          <li>
            Gere um token de usuário com instagram_basic,
            instagram_content_publish, pages_read_engagement e pages_show_list.
            Autorize a Página e o Instagram desejados.
          </li>
          <li>
            Cole o token acima. Se a conta não aparecer, informe o ID do
            Instagram na opção abaixo.
          </li>
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          Esta conexão usa a API com Facebook Login. O aplicativo precisa estar
          autorizado pela Meta para acessar a conta. Tokens temporários precisam
          ser renovados quando expirarem.
        </p>
      </details>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={manual}
          disabled={busy}
          onChange={(e) => {
            setManual(e.target.checked);
            clearResults();
          }}
        />
        Já tenho o ID do Instagram / minha conta não apareceu
      </label>
      {manual && (
        <div className="space-y-2">
          <Label htmlFor="connect-id">ID da conta do Instagram</Label>
          <Input
            id="connect-id"
            inputMode="numeric"
            maxLength={30}
            disabled={busy}
            value={graphId}
            onChange={(e) => {
              setGraphId(e.target.value);
              clearResults();
            }}
            placeholder="Ex.: 178414…"
          />
          <p className="text-xs text-muted-foreground">
            Use o ID do perfil profissional, não o ID do aplicativo ou da
            Página.
          </p>
        </div>
      )}
      <Button
        variant="outline"
        disabled={
          busy ||
          !token.trim() ||
          (manual && !/^\d{5,30}$/.test(graphId.trim()))
        }
        onClick={() => void search()}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Buscar conta
      </Button>
      {profiles && profiles.length === 0 && (
        <p role="status" className="text-sm">
          Nenhum perfil encontrado. Confira as permissões e o vínculo com a
          Página, ou preencha o ID acima.
        </p>
      )}
      {!!profiles?.length && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">
            2. Confirme o perfil
          </legend>
          {profiles.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border p-3"
            >
              <input
                type="radio"
                name="instagram-profile"
                value={p.id}
                checked={selected === p.id}
                disabled={busy}
                onChange={() => setSelected(p.id)}
              />
              <span className="min-w-0 break-words">
                <strong>@{p.username}</strong>
                <span className="block text-xs text-muted-foreground">
                  ID: {p.id}
                </span>
              </span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Se este perfil já estiver conectado ao seu usuário, o acesso será
            atualizado sem duplicar a conta. Uma automação pausada continuará
            pausada.
          </p>
          <Button disabled={busy || !selected} onClick={() => void connect()}>
            {busy ? "Validando…" : "Confirmar conexão"}
          </Button>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function DirectLogin() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    loginRequest<{ ready: boolean }>("config")
      .then((d) => setReady(d.ready))
      .catch((e) => setError(e.message));
  }, []);
  async function create(open: boolean) {
    setBusy(true);
    setError("");
    try {
      const d = await loginRequest<{ url: string }>("invite");
      if (open) window.location.assign(d.url);
      else setUrl(d.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na conexão");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3">
      <p className="text-sm">
        A pessoa entra na própria conta e autoriza a publicação. O acesso é
        salvo automaticamente.
      </p>
      {ready === false && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          Conexão direta aguardando ativação pelo administrador do aplicativo
          Meta.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!ready || busy} onClick={() => void create(true)}>
          Conectar meu Instagram
        </Button>
        <Button
          variant="outline"
          disabled={!ready || busy}
          onClick={() => void create(false)}
        >
          Gerar link para cliente
        </Button>
      </div>
      {url && (
        <div className="space-y-2">
          <Label htmlFor="ig-invite-link">Link de autorização</Label>
          <Input
            id="ig-invite-link"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard
                .writeText(url)
                .catch(() => setError("Selecione e copie o link acima."));
            }}
          >
            Copiar link
          </Button>
          <p className="text-xs text-muted-foreground">
            Válido por 24 horas, para uma autorização. Gerar outro link invalida
            o anterior ainda não utilizado.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
