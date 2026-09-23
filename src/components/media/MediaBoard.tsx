import { ImagePlus, Trash2, Video, Image as ImageIcon, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type MediaCardKind = "referencias" | "original";

export interface MediaItem {
  id: string;
  card: MediaCardKind;
  name: string;
  mime_type: string;
  storage_path: string;
  public_url: string;
  created_at: string;
}

function isVideo(mime: string) {
  return mime.startsWith("video/");
}

export function MediaBoard({
  title,
  items,
  canEdit,
  uploading,
  onAdd,
  onRemove,
}: {
  title: string;
  items: MediaItem[];
  canEdit: boolean;
  uploading?: boolean;
  onAdd?: (files: FileList) => void;
  onRemove?: (item: MediaItem) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [openItem, setOpenItem] = useState<MediaItem | null>(null);

  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {canEdit ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onAdd?.(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="flex min-h-9 items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" />
              {uploading ? "Enviando..." : "Adicionar"}
            </button>
          </>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <ImageIcon className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhum arquivo</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="group relative overflow-hidden rounded-md border border-border bg-secondary"
            >
              <button
                type="button"
                onClick={() => setOpenItem(item)}
                className="block aspect-square w-full"
                title={item.name}
              >
                {isVideo(item.mime_type) ? (
                  <div className="flex h-full w-full items-center justify-center bg-secondary">
                    <video
                      src={item.public_url}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                      <Video className="h-8 w-8 text-white" />
                    </span>
                  </div>
                ) : (
                  <img
                    src={item.public_url}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
              <div className="px-2 py-1.5">
                <p className="truncate text-[11px] text-muted-foreground">
                  {item.name}
                </p>
                {!canEdit ? (
                  <a
                    href={item.public_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-foreground hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Abrir arquivo original
                  </a>
                ) : null}
              </div>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => onRemove?.(item)}
                  className={cn(
                    "absolute right-1.5 top-1.5 rounded-md bg-background/80 p-1.5 text-destructive opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100",
                  )}
                  title="Remover"
                  aria-label={`Remover ${item.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!openItem} onOpenChange={() => setOpenItem(null)}>
        <DialogContent className="max-w-4xl border-border bg-card p-3 sm:p-4">
          <DialogTitle className="truncate text-sm text-foreground">
            {openItem?.name}
          </DialogTitle>
          {openItem && isVideo(openItem.mime_type) ? (
            <video
              src={openItem.public_url}
              controls
              autoPlay
              className="max-h-[75vh] w-full rounded-md bg-black"
            />
          ) : openItem ? (
            <img
              src={openItem.public_url}
              alt={openItem.name}
              className="max-h-[75vh] w-full rounded-md object-contain"
            />
          ) : null}
          {openItem && !canEdit ? (
            <a
              href={openItem.public_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir arquivo original
            </a>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
