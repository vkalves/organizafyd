import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { disconnectAccount } from "./account-api";
export function RemoveInstagramAccount({ account, onRemoved }: { account: { id: string; username: string }; onRemoved: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <AlertDialog open={open} onOpenChange={(value) => { if (!busy) { setError(""); setOpen(value); } }}>
    <AlertDialogTrigger asChild><button type="button" className="ig-accounts-text-button ig-accounts-remove"><Trash2 size={14} /> Remover conta</button></AlertDialogTrigger>
    <AlertDialogContent className="w-[calc(100%_-_2rem)] max-h-[90dvh] overflow-y-auto rounded-xl">
      <AlertDialogHeader>
        <AlertDialogTitle>Remover @{account.username} do DISPARA?</AlertDialogTitle>
        <AlertDialogDescription>Os agendamentos pendentes desta conta serão cancelados e ela será retirada dos fluxos. O histórico será preservado. Isso não exclui seu perfil no Instagram; você poderá conectá-lo novamente.</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
        <AlertDialogAction disabled={busy} className="ig-account-remove-confirm bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true); setError("");
          void disconnectAccount(account.id).then(async () => { setOpen(false); await onRemoved(account.id); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível remover a conta.")).finally(() => setBusy(false));
        }}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removendo…</> : "Remover conta"}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
