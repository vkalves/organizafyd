import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publisherRequest } from "./api";

type SharedAccount = { flow_id: string; flow_name: string; account_id: string; username: string };
type Invitation = { name: string; accounts: { id: string; username: string }[] };
type Target = { id: string; name: string };

export function FlowSharingDialog({ target, userId, onClose, onChanged }: {
  target: Target | null;
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [code, setCode] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const shares = useQuery({
    queryKey: ["ig-shared-flow-accounts", userId],
    queryFn: () => publisherRequest<SharedAccount[]>("list_shared_flow_accounts"),
    enabled: !target,
  });

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível atualizar o compartilhamento.");
    } finally {
      setBusy(false);
    }
  }

  function findFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      setSelected([]);
      setInvitation(null);
      const flow = await publisherRequest<Invitation>("preview_flow_invite", { code });
      setInvitation(flow);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target ? "Compartilhar fluxo" : "Participar de um fluxo"}</DialogTitle>
          <DialogDescription>
            {target
              ? "Envie o código para a pessoa escolher quais perfis o fluxo pode usar."
              : "Use um código de convite para liberar suas contas de Instagram em outro fluxo."}
          </DialogDescription>
        </DialogHeader>
        {target ? (
          <>
            <p className="text-sm font-medium">{target.name}</p>
            {code ? (
              <div className="space-y-2">
                <Label htmlFor="shared-flow-code">Código do fluxo</Label>
                <Input id="shared-flow-code" readOnly value={code} onFocus={(event) => event.target.select()} />
                <p className="text-xs text-muted-foreground">O código vale por 24 horas. Gerar outro substitui o anterior.</p>
                <Button disabled={busy} onClick={() => void perform(async () => {
                  await navigator.clipboard.writeText(code);
                  setMessage("Código copiado.");
                })}>Copiar código</Button>
              </div>
            ) : (
              <Button disabled={busy} onClick={() => void perform(async () => {
                const result = await publisherRequest<{ code: string }>("create_flow_invite", { id: target.id });
                setCode(result.code);
              })}>Gerar código</Button>
            )}
          </>
        ) : (
          <>
            <form className="space-y-2" onSubmit={findFlow}>
              <Label htmlFor="join-flow-code">Código do fluxo</Label>
              <Input id="join-flow-code" required value={code} autoComplete="off" onChange={(event) => {
                setCode(event.target.value);
                setInvitation(null);
                setSelected([]);
              }} />
              <Button type="submit" disabled={busy}>Buscar fluxo</Button>
            </form>
            {invitation && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{invitation.name}</p>
                {invitation.accounts.length ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      O fluxo poderá publicar nos perfis selecionados conforme a programação definida pelo dono.
                    </p>
                    <div className="max-h-40 space-y-2 overflow-y-auto">
                      {invitation.accounts.map((account) => (
                        <label key={account.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" disabled={busy} checked={selected.includes(account.id)}
                            onChange={(event) => setSelected((previous) => event.target.checked
                              ? [...previous, account.id]
                              : previous.filter((id) => id !== account.id))} />
                          @{account.username}
                        </label>
                      ))}
                    </div>
                    <Button disabled={busy || !selected.length} onClick={() => void perform(async () => {
                      await publisherRequest("accept_flow_invite", { code, account_ids: selected });
                      setSelected([]);
                      setInvitation(null);
                      setMessage("Contas sincronizadas com o fluxo.");
                      void shares.refetch();
                      onChanged();
                    })}>Autorizar e sincronizar contas</Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Você não tem novas contas de Instagram conectadas e disponíveis para este fluxo.</p>
                )}
              </div>
            )}
            {!!shares.data?.length && (
              <div className="max-h-44 space-y-2 overflow-y-auto">
                <h3 className="text-sm font-medium">Minhas contas compartilhadas</h3>
                {shares.data.map((share) => (
                  <div key={share.flow_id + share.account_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="break-all">{share.flow_name} · @{share.username}</span>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => {
                      await publisherRequest("revoke_shared_flow_account", { id: share.flow_id, account_id: share.account_id });
                      setMessage("Acesso retirado.");
                      void shares.refetch();
                      onChanged();
                    })}>Retirar acesso</Button>
                  </div>
                ))}
              </div>
            )}
            {shares.isError && <Button size="sm" variant="outline" onClick={() => void shares.refetch()}>Tentar carregar compartilhamentos novamente</Button>}
          </>
        )}
        {busy && <p role="status" className="text-sm text-muted-foreground">Aguarde…</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
