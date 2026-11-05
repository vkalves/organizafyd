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
    <section aria-label="Prévia dos arquivos escolhidos" className="space-y-3">
      <h3 className="text-sm font-medium">Mídias selecionadas</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      className="overflow-hidden rounded-xl border border-white/15 bg-black/40"
    >
      {file.type.startsWith("video/") ? (
        <VideoPreview
          src={url}
          visible={visible}
          label={`Prévia de ${file.name}`}
          className="h-64 w-full object-contain"
        />
      ) : (
        <img
          src={visible ? url : undefined}
          alt={`Prévia de ${file.name}`}
          loading="lazy"
          className="h-64 w-full object-contain"
        />
      )}
      <figcaption className="truncate px-3 py-2 text-xs text-muted-foreground">
        {file.name}
      </figcaption>
    </figure>
  );
}
