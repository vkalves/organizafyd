import { loginRequest } from "./login";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
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

export function ConnectAccount({
  onConnected: _onConnected,
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
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
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
          Conexão direta aguardando ativação no servidor.
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
          Gerar link de convite
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

