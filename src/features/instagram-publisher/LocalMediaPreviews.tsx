import { usePreviewVisibility } from "./usePreviewVisibility";
import { VideoPreview } from "./VideoPreview";
import { memo, useEffect, useState } from "react";

/** Preview the chosen files immediately, without waiting for cleaning or storage. */
export const LocalMediaPreviews = memo(function LocalMediaPreviews({
  files,
}: {
  files: File[];
}) {
  const [items, setItems] = useState<{ file: File; url: string }[]>([]);
  useEffect(() => {
    const next = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setItems(next);
    return () => next.forEach((item) => URL.revokeObjectURL(item.url));
  }, [files]);
  if (!items.length) return null;
  return (
    <section aria-label="Prévia dos arquivos escolhidos" className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        Processando envio ({items.length})
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(({ file, url }) => (
          <LocalFile key={url} file={file} url={url} />
        ))}
      </div>
    </section>
  );
});

function LocalFile({ file, url }: { file: File; url: string }) {
  const { ref, visible } = usePreviewVisibility();
  return (
    <figure
      ref={ref}
      className="overflow-hidden rounded-[9px] border border-border bg-background"
    >
      {file.type.startsWith("video/") ? (
        <VideoPreview
          src={url}
          visible={visible}
          label={`Prévia de ${file.name}`}
          className="h-28 w-full object-cover"
        />
      ) : (
        <img
          src={visible ? url : undefined}
          alt={`Prévia de ${file.name}`}
          loading="lazy"
          className="h-28 w-full object-cover"
        />
      )}
      <figcaption className="truncate px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {file.name}
      </figcaption>
    </figure>
  );
}
