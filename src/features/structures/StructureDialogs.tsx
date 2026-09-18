import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FOLDER_ICONS, getFolderPath, MAX_STRUCTURE_IMAGE_BYTES, STRUCTURE_COLORS, STRUCTURE_ICONS } from "./helpers";
import { StructureIcon } from "./StructureIcon";
import type { Structure, StructureFolder, StructureItem } from "./types";

export interface StructureFormValue {
  name: string;
  description: string;
  icon: string;
  color: string;
  image: File | null;
  removeImage: boolean;
}

export function StructureEditorDialog({
  open,
  onOpenChange,
  structure,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  structure: Structure | null;
  busy: boolean;
  onSave: (value: StructureFormValue) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("layers");
  const [color, setColor] = useState(STRUCTURE_COLORS[0]);
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(structure?.name ?? "");
    setDescription(structure?.description ?? "");
    setIcon(structure?.icon ?? "layers");
    setColor(structure?.color ?? STRUCTURE_COLORS[0]);
    setImage(null);
    setRemoveImage(false);
    setImageError("");
  }, [open, structure]);

  const chooseImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setImageError("Escolha uma imagem.");
    if (file.size > MAX_STRUCTURE_IMAGE_BYTES) return setImageError("A imagem pode ter no máximo 5 MB.");
    setImageError("");
    setImage(file);
    setRemoveImage(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="safe-dialog-content overflow-y-auto border-border bg-card sm:max-w-lg">
        <DialogHeader><DialogTitle>{structure ? "Editar estrutura" : "Nova estrutura"}</DialogTitle></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), description: description.trim(), icon, color, image, removeImage }); }} className="space-y-5">
          <Field label="Nome">
            <input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Projeto A" className="form-control" />
          </Field>
          <Field label="Descrição (opcional)">
            <textarea maxLength={300} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="O que você organiza aqui?" className="form-control min-h-20 resize-none py-2.5" />
          </Field>
          <Field label="Ícone">
            <div className="grid grid-cols-6 gap-2">
              {STRUCTURE_ICONS.map((value) => (
                <button key={value} type="button" onClick={() => setIcon(value)} className={cn("flex h-11 items-center justify-center rounded-lg border bg-secondary", icon === value ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")} aria-label={`Usar ícone ${value}`}>
                  <StructureIcon name={value} className="h-5 w-5" />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Cor">
            <div className="flex flex-wrap gap-2">
              {STRUCTURE_COLORS.map((value) => (
                <button key={value} type="button" onClick={() => setColor(value)} className={cn("h-9 w-9 rounded-full border-2", color === value ? "border-foreground" : "border-transparent")} style={{ backgroundColor: value }} aria-label={`Usar cor ${value}`} />
              ))}
            </div>
          </Field>
          <Field label="Imagem (opcional)">
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-secondary/40 px-3 text-sm text-muted-foreground hover:border-muted-foreground hover:text-foreground">
              <ImagePlus className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{image?.name || "Escolher imagem de até 5 MB"}</span>
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => chooseImage(event.target.files?.[0])} />
            </label>
            {imageError && <p className="mt-1.5 text-xs text-destructive">{imageError}</p>}
            {structure?.image_path && !image && (
              <label className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                Remover imagem atual
                <Switch checked={removeImage} onCheckedChange={setRemoveImage} />
              </label>
            )}
          </Field>
          <button type="submit" disabled={busy || !name.trim()} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Salvando..." : structure ? "Salvar alterações" : "Criar estrutura"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface FolderFormValue { name: string; icon: string; color: string }

export function FolderEditorDialog({ open, onOpenChange, folder, parentName, busy, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: StructureFolder | null;
  parentName?: string;
  busy: boolean;
  onSave: (value: FolderFormValue) => void;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("folder");
  const [color, setColor] = useState(STRUCTURE_COLORS[0]);

  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? "");
    setIcon(folder?.icon ?? "folder");
    setColor(folder?.color ?? STRUCTURE_COLORS[0]);
  }, [open, folder]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="safe-dialog-content border-border bg-card sm:max-w-md">
        <DialogHeader><DialogTitle>{folder ? "Editar pasta" : parentName ? "Nova subpasta" : "Nova pasta"}</DialogTitle></DialogHeader>
        {parentName && !folder && <p className="-mt-2 text-sm text-muted-foreground">Será criada dentro de “{parentName}”.</p>}
        <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), icon, color }); }} className="space-y-5">
          <Field label="Nome da pasta"><input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Postagens" className="form-control" /></Field>
          <Field label="Ícone">
            <div className="grid grid-cols-6 gap-2">
              {FOLDER_ICONS.map((value) => (
                <button key={value} type="button" onClick={() => setIcon(value)} className={cn("flex h-11 items-center justify-center rounded-lg border bg-secondary", icon === value ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")} aria-label={`Usar ícone ${value}`}>
                  <StructureIcon name={value} className="h-5 w-5" />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Cor">
            <div className="flex flex-wrap gap-2">{STRUCTURE_COLORS.map((value) => <button key={value} type="button" onClick={() => setColor(value)} className={cn("h-9 w-9 rounded-full border-2", color === value ? "border-foreground" : "border-transparent")} style={{ backgroundColor: value }} aria-label={`Usar cor ${value}`} />)}</div>
          </Field>
          <button type="submit" disabled={busy || !name.trim()} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Salvando..." : folder ? "Salvar alterações" : "Criar pasta"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TextEditorDialog({ open, onOpenChange, item, busy, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: StructureItem | null;
  busy: boolean;
  onSave: (value: { title: string; body: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => { if (open) { setTitle(item?.title ?? ""); setBody(item?.body ?? ""); } }, [item, open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="safe-dialog-content border-border bg-card sm:max-w-lg">
        <DialogHeader><DialogTitle>{item ? "Editar texto" : "Nova anotação"}</DialogTitle></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); if (body.trim()) onSave({ title: title.trim(), body: body.trim() }); }} className="space-y-4">
          <Field label="Título (opcional)"><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="form-control" /></Field>
          <Field label="Texto"><textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} className="form-control min-h-40 resize-y py-3" /></Field>
          <button type="submit" disabled={busy || !body.trim()} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Salvando..." : "Salvar texto"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LinkEditorDialog({ open, onOpenChange, item, busy, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: StructureItem | null;
  busy: boolean;
  onSave: (value: { title: string; url: string; body: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => { if (open) { setTitle(item?.title ?? ""); setUrl(item?.url ?? ""); setBody(item?.body ?? ""); } }, [item, open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="safe-dialog-content border-border bg-card sm:max-w-lg">
        <DialogHeader><DialogTitle>{item ? "Editar link" : "Salvar link"}</DialogTitle></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); if (title.trim() && url.trim()) onSave({ title: title.trim(), url: url.trim(), body: body.trim() }); }} className="space-y-4">
          <Field label="Título"><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="Nome do link" className="form-control" /></Field>
          <Field label="Endereço"><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." className="form-control" /></Field>
          <Field label="Descrição (opcional)"><textarea value={body} onChange={(event) => setBody(event.target.value)} className="form-control min-h-20 resize-none py-3" /></Field>
          <button type="submit" disabled={busy || !title.trim() || !url.trim()} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Salvando..." : "Salvar link"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({ open, onOpenChange, title, folders, currentFolderId, allowRoot, excludedIds, busy, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  folders: StructureFolder[];
  currentFolderId?: string | null;
  allowRoot: boolean;
  excludedIds?: Set<string>;
  busy: boolean;
  onSave: (folderId: string | null) => void;
}) {
  const destinations = useMemo(() => folders.filter((folder) => !excludedIds?.has(folder.id)).map((folder) => ({ folder, path: getFolderPath(folders, folder.id).map((part) => part.name).join(" / ") })), [excludedIds, folders]);
  const [destination, setDestination] = useState<string>("");
  useEffect(() => { if (open) setDestination(allowRoot ? "__root__" : destinations.find((entry) => entry.folder.id !== currentFolderId)?.folder.id ?? ""); }, [allowRoot, currentFolderId, destinations, open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="safe-dialog-content border-border bg-card sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Field label="Destino">
          <select value={destination} onChange={(event) => setDestination(event.target.value)} className="form-control">
            {allowRoot && <option value="__root__">Início da estrutura</option>}
            {destinations.map(({ folder, path }) => <option key={folder.id} value={folder.id} disabled={folder.id === currentFolderId}>{path}</option>)}
          </select>
        </Field>
        <button type="button" disabled={busy || !destination || destination === currentFolderId} onClick={() => onSave(destination === "__root__" ? null : destination)} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Movendo..." : "Mover"}</button>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>{children}</label>;
}
