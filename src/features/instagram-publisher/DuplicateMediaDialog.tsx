import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteMedia } from "./flows-api";
import { scanDuplicateMedia, type DuplicateScan } from "./duplicate-media";

export function DuplicateMediaDialog({ userId, onClose, onDeleted }: {
  userId: string;
  onClose: () => void;
  onDeleted: (ids: string[]) => void;
}) {
  const [phase, setPhase] = useState<"ready" | "scanning" | "review" | "deleting" | "done">("ready");
  const [scan, setScan] = useState<DuplicateScan | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const busy = phase === "scanning" || phase === "deleting";

  async function analyze() {
    setPhase("scanning"); setError(""); setMessage(""); setScan(null); setProgress({ completed: 0, total: 0 });
    const active = new AbortController(); controller.current = active;
    try {
      setScan(await scanDuplicateMedia(userId, { signal: active.signal, onProgress: (completed, total) => setProgress({ completed, total }) }));
      setPhase("review");
    } catch (failure) {
      if (active.signal.aborted) setMessage("Análise cancelada. Nenhum arquivo foi excluído.");
      else setError(failure instanceof Error ? failure.message : "Não foi possível analisar a biblioteca.");
      setPhase("ready");
    } finally { controller.current = null; }
  }

  async function remove() {
    if (!scan || busy) return;
    setPhase("deleting"); setError(""); setProgress({ completed: 0, total: scan.duplicates.length });
    const deleted: string[] = []; const failures: string[] = [];
    for (const [index, item] of scan.duplicates.entries()) {
      try {
        // Recheck references immediately before each deletion using the same
        // protection as manual deletion; newly used media must be preserved.
        await deleteMedia(item.id, item.url, userId);
        deleted.push(item.id);
      } catch (failure) { failures.push(failure instanceof Error ? failure.message : "Não foi possível excluir esta mídia."); }
      setProgress({ completed: index + 1, total: scan.duplicates.length });
    }
    if (deleted.length) onDeleted(deleted);
    setMessage(`${deleted.length} arquivo(s) repetido(s) removido(s).`);
    if (failures.length) setError(`${failures.length} arquivo(s) não foram removidos. ${failures[0]}`);
    setPhase("done");
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>Remover arquivos repetidos</DialogTitle>
        <DialogDescription>Analisa toda a sua biblioteca, incluindo todas as pastas, posts, stories e capas. Compara o conteúdo exato dos arquivos e mantém uma cópia de cada. Mídias em uso serão preservadas.</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">A análise baixa um arquivo por vez e pode demorar em bibliotecas grandes. Arquivos com conteúdo diferente, mesmo visualmente parecidos, não serão excluídos.</p>
      {phase === "scanning" && <p role="status">{progress.total ? `Analisando arquivos: ${progress.completed} de ${progress.total}. Verificando também o uso nos fluxos…` : "Carregando biblioteca…"}</p>}
      {phase === "deleting" && <p role="status">Removendo repetidos: {progress.completed} de {progress.total}</p>}
      {phase === "review" && scan && <div className="space-y-2 text-sm">
        <p>{scan.total} arquivo(s) analisado(s). {scan.groups} grupo(s) com conteúdo repetido.</p>
        <p>{scan.duplicates.length} cópia(s) repetida(s) podem ser excluídas. {scan.protected} cópia(s) adicional(is) em uso serão preservadas.</p>
        {scan.failures.length > 0 && <p role="alert">{scan.failures.length} arquivo(s) ou grupo(s) não puderam ser verificados e foram preservados. {scan.failures[0].message}</p>}
        {!!scan.duplicates.length && <>
          <p>A exclusão é permanente. As cópias podem estar em pastas diferentes e ter legendas distintas. A cópia em uso será mantida; se nenhuma estiver em uso, será mantida a mais antiga.</p>
          <ul aria-label="Cópias repetidas para excluir" className="max-h-40 overflow-y-auto rounded border p-2">
            {scan.duplicates.map((item) => <li key={item.id} className="border-b py-2 last:border-0">{item.folder || "Sem pasta"} · {item.kind === "cover" ? "Capa" : item.kind === "stories" ? "Story" : "Post"} · {item.caption || "Sem legenda"}</li>)}
          </ul>
        </>}
      </div>}
      {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {phase === "scanning" && <Button variant="outline" onClick={() => controller.current?.abort()}>Cancelar análise</Button>}
        {!busy && <Button variant="outline" onClick={onClose}>Fechar</Button>}
        {!busy && <Button onClick={() => void analyze()}>{phase === "ready" ? "Analisar biblioteca" : "Analisar novamente"}</Button>}
        {phase === "review" && !!scan?.duplicates.length && <Button variant="destructive" onClick={() => void remove()}>Excluir {scan.duplicates.length} cópia(s) repetida(s)</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
