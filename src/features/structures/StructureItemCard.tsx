import { useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  MoreVertical,
  Move,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fileCategory, formatBytes } from "./helpers";
import { FileTypeIcon } from "./StructureIcon";
import type { StructureItem } from "./types";

type CardItem = Omit<StructureItem, "storage_path" | "structure_id" | "user_id"> & { storage_path?: string | null };

interface StructureItemCardProps {
  item: CardItem;
  previewUrl?: string;
  readonly?: boolean;
  allowDownload?: boolean;
  compact?: boolean;
  onOpenFile?: () => void;
  onDownload?: () => Promise<void> | void;
  onEdit?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
}

export function StructureItemCard({
  item,
  previewUrl,
  readonly = false,
  allowDownload = true,
  compact = false,
  onOpenFile,
  onDownload,
  onEdit,
  onMove,
  onDelete,
}: StructureItemCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado.`);
  };

  const download = async () => {
    if (!onDownload || downloading) return;
    setDownloading(true);
    try { await onDownload(); } finally { setDownloading(false); }
  };

  if (item.kind === "text") {
    return (
      <article className="group relative max-w-[min(42rem,92%)] self-end rounded-2xl rounded-br-md border border-border/70 bg-secondary px-4 py-3 shadow-sm">
        {item.title && <h3 className="mb-1 pr-8 text-sm font-semibold text-foreground">{item.title}</h3>}
        <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-foreground">{item.body}</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">{new Date(item.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
          <button type="button" onClick={() => void copy(item.body || "", "Texto")} className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <Copy className="h-3.5 w-3.5" /> Copiar
          </button>
        </div>
        {!readonly && <ItemMenu onEdit={onEdit} onMove={onMove} onDelete={onDelete} />}
      </article>
    );
  }

  if (item.kind === "link") {
    return (
      <article className="group relative max-w-[min(42rem,92%)] self-end rounded-2xl rounded-br-md border border-info/20 bg-secondary px-4 py-3 shadow-sm">
        <div className="flex items-start gap-3 pr-8">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/15 text-info"><Link2 className="h-4 w-4" /></div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{item.title || "Link"}</h3>
            {item.body && <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.body}</p>}
            <a href={item.url || "#"} target="_blank" rel="noreferrer" className="mt-2 flex min-h-9 max-w-full items-center gap-1.5 truncate text-sm text-info hover:underline">
              <span className="truncate">{item.url}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">{new Date(item.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
          <button type="button" onClick={() => void copy(item.url || "", "Link")} className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <Copy className="h-3.5 w-3.5" /> Copiar
          </button>
        </div>
        {!readonly && <ItemMenu onEdit={onEdit} onMove={onMove} onDelete={onDelete} />}
      </article>
    );
  }

  const category = fileCategory(item);
  const visualPreview = previewUrl && !previewFailed && (category === "image" || category === "video");

  return (
    <article className={cn(
      "group relative overflow-hidden rounded-xl border border-border/70 bg-secondary shadow-sm",
      compact ? "min-w-0" : "w-full max-w-[min(42rem,94%)] self-end",
    )}>
      <button type="button" onClick={onOpenFile} className={cn("flex w-full min-w-0 items-center gap-3 p-2.5 text-left transition-colors hover:bg-accent/55", visualPreview && !compact && "items-stretch")}>
        {visualPreview ? (
          <div className={cn("relative shrink-0 overflow-hidden rounded-lg bg-black/35", compact ? "h-14 w-14" : "h-24 w-24 sm:h-28 sm:w-32")}>
            {category === "image" ? (
              <img src={previewUrl} alt="" loading="lazy" onError={() => setPreviewFailed(true)} className="h-full w-full object-cover" />
            ) : (
              <video src={previewUrl} muted playsInline preload="metadata" onError={() => setPreviewFailed(true)} className="h-full w-full object-cover" />
            )}
          </div>
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"><FileTypeIcon category={category} /></div>
        )}
        <div className="min-w-0 flex-1 self-center pr-7">
          <p className="break-words text-sm font-medium leading-5 text-foreground">{item.original_name || item.title || "Arquivo"}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
            {item.original_name?.split(".").pop() || "arquivo"}{item.size_bytes != null ? ` · ${formatBytes(item.size_bytes)}` : ""}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{new Date(item.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      </button>

      {(allowDownload || !readonly) && (
        <div className="flex border-t border-border/60">
          {allowDownload && (
            <button type="button" onClick={() => void download()} disabled={downloading} className="flex min-h-10 flex-1 items-center justify-center gap-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Baixar original
            </button>
          )}
        </div>
      )}
      {!readonly && <ItemMenu onMove={onMove} onDelete={onDelete} />}
    </article>
  );
}

function ItemMenu({ onEdit, onMove, onDelete }: Pick<StructureItemCardProps, "onEdit" | "onMove" | "onDelete">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-100 shadow-sm backdrop-blur hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100" aria-label="Ações do item">
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onEdit && <DropdownMenuItem onSelect={onEdit}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
        {onMove && <DropdownMenuItem onSelect={onMove}><Move className="mr-2 h-4 w-4" />Mover</DropdownMenuItem>}
        {(onEdit || onMove) && onDelete && <DropdownMenuSeparator />}
        {onDelete && <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
