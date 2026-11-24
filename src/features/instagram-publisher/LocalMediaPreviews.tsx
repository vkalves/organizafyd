import { usePreviewVisibility } from "./usePreviewVisibility";
import { VideoPreview } from "./VideoPreview";
import {
  getFilePoster,
  setFilePoster,
  subscribeFilePoster,
  videoPoster,
} from "./video-poster";
import { memo, useEffect, useRef, useState } from "react";

const PREVIEW_LIMIT = 8;
/** A bounded preview window keeps large batches from opening dozens of decoders. */
export const LocalMediaPreviews = memo(function LocalMediaPreviews({ files }: { files: File[] }) {
  const ids = useRef(new WeakMap<File, number>());
  const nextId = useRef(0);
  if (!files.length) return null;
  return (
    <section aria-label="Prévia dos arquivos escolhidos" className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Processando envio ({files.length})</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {files.slice(0, PREVIEW_LIMIT).map((file) => {
          if (!ids.current.has(file)) ids.current.set(file, nextId.current++);
          return <LocalFile key={ids.current.get(file)} file={file} />;
        })}
      </div>
      {files.length > PREVIEW_LIMIT && (
        <p className="text-xs text-muted-foreground">
          +{files.length - PREVIEW_LIMIT} arquivos na fila. As prévias aparecem conforme o envio avança.
        </p>
      )}
    </section>
  );
});

function LocalFile({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  const [poster, setPoster] = useState<string | undefined>(() => getFilePoster(file));
  const { ref, visible } = usePreviewVisibility();
  const isVideo =
    file.type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(file.name);

  useEffect(() => {
    const local = URL.createObjectURL(file);
    setUrl(local);
    return () => URL.revokeObjectURL(local);
  }, [file]);

  useEffect(() => {
    if (!isVideo) return;
    return subscribeFilePoster(file, (extracted) => {
      setPoster(extracted);
    });
  }, [file, isVideo]);

  useEffect(() => {
    if (!isVideo || !visible || !url || getFilePoster(file)) return;
    let active = true;
    const controller = new AbortController();
    void videoPoster(url, controller.signal)
      .then((extracted) => {
        if (active) {
          setFilePoster(file, extracted);
          setPoster(extracted);
        }
      })
      .catch(() => {
        // HEVC videos on Windows Chrome will receive their poster from FFmpeg WASM via subscribeFilePoster.
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [file, isVideo, visible, url]);

  return (
    <figure ref={ref} className="overflow-hidden rounded-xl border border-border bg-background">
      {isVideo ? (
        <div className="relative h-28 w-full overflow-hidden bg-secondary/40">
          <VideoPreview
            src={url}
            poster={poster}
            visible={visible}
            label={`Prévia de ${file.name}`}
            className="h-28 w-full object-cover"
          />
          {poster && (
            <img
              src={poster}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>
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
