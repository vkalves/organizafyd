import { FolderDown, Share2, Users } from "lucide-react";
import "./library-sharing.css";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { publisherRequest } from "./api";
import { importSharedMedia } from "./library-sharing-api";
import { importSharedLibrary } from "./library-sharing-batch";
import type { Media } from "./flows-api";

type Shares = {
  outgoing: { recipient_id: string; recipient: { handle: string } }[];
  incoming: { owner_id: string; owner: { handle: string } }[];
};
export function LibrarySharingDialog({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<"share" | "receive">("share");
  const [handle, setHandle] = useState("");
  const [recipient, setRecipient] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [imported, setImported] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [importingAll, setImportingAll] = useState(false);
  const identity = useQuery({ queryKey: ["ig-library-identity", userId], queryFn: () => publisherRequest<{ handle: string } | null>("library_identity") });
  const shares = useQuery({ queryKey: ["ig-library-shares", userId], queryFn: () => publisherRequest<Shares>("library_shares") });
  const media = useQuery({ queryKey: ["ig-library-shared-media", userId, ownerId, offset], queryFn: () => publisherRequest<Pick<Media, "id" | "folder" | "caption" | "kind">[]>("library_browse", { owner_id: ownerId, offset }), enabled: !!ownerId });
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (failure) {
      const text = failure instanceof Error ? failure.message : "Falha ao atualizar compartilhamento.";
      setError(text);
    } finally { setBusy(false); }
  }
  function saveHandle(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      await publisherRequest("library_set_handle", { handle });
      await identity.refetch(); setHandle(""); setMessage("Seu @ foi salvo.");
    });
  }
  function importAll() {
    void perform(async () => {
      setImportingAll(true);
      setBatchProgress(null);
      try {
        const result = await importSharedLibrary(ownerId, userId, {
          alreadyImported: imported,
          onImported: (id) => setImported((previous) => [...previous, id]),
          onProgress: setBatchProgress,
        });
        if (result.imported) onChanged();
        setMessage(`${result.imported} mídia(s) importada(s). ${result.skipped} já importada(s) nesta sessão.`);
        if (result.failures.length) setError(`${result.failures.length} mídia(s) não foram importadas. ${result.failures[0].message} Você pode tentar novamente; as cópias concluídas nesta sessão serão ignoradas.`);
      } finally {
        setImportingAll(false);
        setBatchProgress(null);
      }
    });
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="library-sharing-dialog max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle><span className="library-sharing-icon"><Users size={20} /></span> Sua biblioteca, conectada</DialogTitle>
        <DialogDescription>Compartilhe por @ ou traga conteúdos de outra biblioteca para os seus fluxos.</DialogDescription>
      </DialogHeader>
      <div className="library-sharing-identity">
        <div><span className="text-xs text-muted-foreground">Seu endereço na biblioteca</span><p className="font-medium">{identity.data ? `@${identity.data.handle}` : "Defina seu @ para começar"}</p></div>
        <details><summary>{identity.data ? "Editar meu @" : "Criar meu @"}</summary>
      <form onSubmit={saveHandle} className="space-y-2">
        <Label htmlFor="library-handle">Meu @ {identity.data ? `atual: @${identity.data.handle}` : ""}</Label>
        <Input id="library-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@seu_usuario" required minLength={3} maxLength={31} autoCapitalize="none" />
        <Button disabled={busy || identity.isPending || identity.isError}>Salvar meu @</Button>
      </form>
        </details>
      </div>
      <div role="tablist" aria-label="Compartilhamento de biblioteca" className="library-sharing-tabs">
        <button type="button" role="tab" id="library-share-tab" aria-controls="library-share-panel" aria-selected={tab === "share"} tabIndex={tab === "share" ? 0 : -1} disabled={busy} onClick={() => setTab("share")} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { setTab("receive"); document.getElementById("library-receive-tab")?.focus(); } }}><Share2 size={16} /> Compartilhar <span>{shares.data?.outgoing.length ?? 0}</span></button>
        <button type="button" role="tab" id="library-receive-tab" aria-controls="library-receive-panel" aria-selected={tab === "receive"} tabIndex={tab === "receive" ? 0 : -1} disabled={busy} onClick={() => setTab("receive")} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { setTab("share"); document.getElementById("library-share-tab")?.focus(); } }}><FolderDown size={16} /> Recebidas <span>{shares.data?.incoming.length ?? 0}</span></button>
      </div>
      <div role="tabpanel" id="library-share-panel" aria-labelledby="library-share-tab" hidden={tab !== "share"} className="library-sharing-panel">
      <p className="text-xs text-muted-foreground">Quem receber acesso poderá importar cópias, sem alterar seus originais. As cópias ocupam espaço na conta de destino e continuam lá após a retirada do acesso.</p>
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault(); void perform(async () => {
          await publisherRequest("library_grant", { handle: recipient });
          await shares.refetch(); setRecipient(""); setMessage("Biblioteca compartilhada.");
        });
      }}>
        <Label htmlFor="library-recipient">Compartilhar toda a minha biblioteca com</Label>
        <Input id="library-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="@outro_usuario" required autoCapitalize="none" />
        <Button disabled={busy || !identity.data}>Liberar acesso</Button>
      </form>
      <div className="space-y-2"><h3 className="text-sm font-medium">Pessoas com acesso à minha biblioteca</h3>
        {shares.data?.outgoing.length === 0 && <p className="text-sm text-muted-foreground">Nenhum acesso liberado.</p>}
        {shares.data?.outgoing.map((share) => <div key={share.recipient_id} className="flex items-center justify-between gap-2">
          <span>@{share.recipient.handle}</span><Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
            await publisherRequest("library_revoke", { recipient_id: share.recipient_id }); await shares.refetch(); setMessage("Acesso retirado. Cópias já importadas foram mantidas.");
          })}>Retirar acesso</Button>
        </div>)}
      </div>
      </div>
      <div role="tabpanel" id="library-receive-panel" aria-labelledby="library-receive-tab" hidden={tab !== "receive"} className="library-sharing-panel">
      <p className="text-xs text-muted-foreground">Importe para sua biblioteca e selecione as mídias em qualquer fluxo. Os arquivos originais ficam com o proprietário.</p>
      <div className="space-y-2"><Label htmlFor="shared-library">Bibliotecas compartilhadas comigo</Label>
        <select id="shared-library" className="w-full rounded border bg-background p-2" disabled={busy} value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setOffset(0); }}>
          <option value="">Selecione uma biblioteca</option>
          {shares.data?.incoming.map((share) => <option key={share.owner_id} value={share.owner_id}>@{share.owner.handle}</option>)}
        </select>
        {ownerId && <div className="space-y-2">
          <Button disabled={busy || media.isPending || media.isError} onClick={importAll}>Importar todas as mídias</Button>
          <p className="text-xs text-muted-foreground">Importa todas as páginas desta biblioteca. Mantenha esta janela aberta até concluir.</p>
          {importingAll && <div className="space-y-2"><p role="status">{batchProgress ? `Importando mídias: ${batchProgress.completed} de ${batchProgress.total}` : "Buscando todas as mídias…"}</p>{batchProgress && <progress aria-label="Progresso da importação" className="w-full" value={batchProgress.completed} max={batchProgress.total || 1} />}</div>}
        </div>}
        {shares.data?.incoming.length === 0 && <p className="text-sm text-muted-foreground">Peça ao dono da biblioteca para liberar acesso ao seu @.</p>}
        {ownerId && media.isPending && <p role="status">Carregando mídias…</p>}
        {ownerId && media.data?.length === 0 && <p>Nenhuma mídia nesta página.</p>}
        {media.data?.map((item, index) => <div key={item.id} className="flex items-center justify-between gap-2 border-b py-2">
          <div className="min-w-0 text-sm"><p>{item.folder || "Sem pasta"} · {item.kind === "cover" ? "Capa" : item.kind === "stories" ? "Story" : "Post"} {offset + index + 1}</p><p className="truncate text-muted-foreground">{item.caption || "Sem legenda"}</p></div>
          <Button disabled={busy || imported.includes(item.id)} onClick={() => void perform(async () => {
            await importSharedMedia(ownerId, item.id, userId); setImported((previous) => [...previous, item.id]); onChanged(); setMessage("Mídia copiada. Ela já está disponível na sua biblioteca para criar fluxos.");
          })}>{imported.includes(item.id) ? "Importada" : "Importar"}</Button>
        </div>)}
        {ownerId && <div className="flex gap-2"><Button variant="outline" disabled={busy || offset === 0} onClick={() => setOffset((n) => n - 50)}>Anterior</Button><Button variant="outline" disabled={busy || media.isFetching || media.data?.length !== 50} onClick={() => setOffset((n) => n + 50)}>Próxima</Button></div>}
      </div>
      </div>
      {(identity.isError || shares.isError || media.isError) && <div role="alert"><p>Não foi possível carregar os compartilhamentos. O acesso pode ter sido retirado.</p><Button variant="outline" onClick={() => { void identity.refetch(); void shares.refetch(); if (ownerId) void media.refetch(); }}>Tentar novamente</Button></div>}
      {busy && !importingAll && <p role="status">Aguarde…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
