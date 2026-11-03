import { useState } from "react";
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
}: {
  onConnected: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Conectar conta
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conectar Instagram</DialogTitle>
            <DialogDescription>
              Cole seu token, encontre o perfil e confirme a conexão.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <ConnectionForm
              onConnected={onConnected}
              onClose={() => setOpen(false)}
            />
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
