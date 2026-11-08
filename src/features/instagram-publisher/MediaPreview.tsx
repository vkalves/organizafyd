import { usePreviewVisibility } from "./usePreviewVisibility";
import { VideoPreview } from "./VideoPreview";
import { useQuery } from "@tanstack/react-query";
import { memo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { previewMedia } from "./flows-api";

export const MediaPreview = memo(function MediaPreview({
  url,
  label = "Mídia selecionada",
  compact = false,
  minimal = false,
}: {
  url: string;
  label?: string;
  compact?: boolean;
  minimal?: boolean;
}) {
  const { user } = useAuth();
  const { ref, visible } = usePreviewVisibility();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const privateMedia = url.startsWith("storage://");
  const remote = /^https:\/\//i.test(url);
  const query = useQuery({
    queryKey: ["ig-media-preview", user?.id, url],
    queryFn: async () =>
      privateMedia ? ((await previewMedia(url)) ?? null) : url,
    enabled: visible && !!user && (privateMedia || remote),
    staleTime: 240000,
    refetchInterval: privateMedia ? 240000 : false,
    retry: 1,
  });
  const src = query.data;
  const video = /\.mp4(?:[?#]|$)/i.test(url);

  if (minimal) {
    return (
      <div
        ref={ref}
        className="relative h-full w-full overflow-hidden bg-secondary/40"
      >
        {!visible && !src ? (
          <div className="h-full w-full" />
        ) : query.isLoading ? (
          <div
            role="status"
            className="flex h-full w-full items-center justify-center p-2 text-[11px] text-muted-foreground"
          >
            …
          </div>
        ) : query.isError || !src || failedUrl === src ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-muted-foreground">
            <span>Sem prévia</span>
          </div>
        ) : video ? (
          <VideoPreview
            src={src}
            visible={visible}
            label={label}
            controls={false}
            onError={() => setFailedUrl(src)}
            className="pointer-events-none h-full w-full object-cover"
          />
        ) : (
          <img
            src={src}
            alt={label}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(src)}
            className="pointer-events-none h-full w-full object-cover"
          />
        )}
      </div>
    );
  }

  return (
    <figure
      ref={ref}
      className={`overflow-hidden rounded-[10px] border border-border bg-background ${compact ? "w-full" : "w-full max-w-sm"}`}
    >
      {!visible && !src ? (
        <div className={compact ? "h-40" : "h-72 sm:h-96"} />
      ) : query.isLoading ? (
        <p
          role="status"
          className={`p-4 text-xs text-muted-foreground ${compact ? "h-40" : "h-72 sm:h-96"}`}
        >
          Carregando prévia…
        </p>
      ) : query.isError || !src || failedUrl === src ? (
        <p
          className={`p-4 text-xs text-muted-foreground ${compact ? "h-40" : "h-72 sm:h-96"}`}
        >
          Prévia indisponível.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setFailedUrl(null);
              void query.refetch();
            }}
          >
            Tentar novamente
          </button>
        </p>
      ) : video ? (
        <VideoPreview
          src={src}
          visible={visible}
          label={label}
          onError={() => setFailedUrl(src)}
          className={`w-full object-contain ${compact ? "h-40" : "h-72 sm:h-96"}`}
        />
      ) : (
        <img
          src={src}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(src)}
          className={`w-full object-contain ${compact ? "h-40" : "h-72 sm:h-96"}`}
        />
      )}
      <figcaption className="px-3 py-2 text-xs text-muted-foreground">
        {label}
      </figcaption>
    </figure>
  );
});
