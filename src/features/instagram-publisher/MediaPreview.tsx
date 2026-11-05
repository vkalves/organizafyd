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
}: {
  url: string;
  label?: string;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const { ref, visible } = usePreviewVisibility();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const privateMedia = url.startsWith("storage://");
  const remote = /^https:\/\//i.test(url);
  const query = useQuery({
    queryKey: ["ig-media-preview", user?.id, url],
    queryFn: () => (privateMedia ? previewMedia(url) : Promise.resolve(url)),
    enabled: visible && !!user && (privateMedia || remote),
    staleTime: 240000,
    refetchInterval: privateMedia ? 240000 : false,
    retry: 1,
  });
  const src = query.data;
  const video = /\.mp4(?:[?#]|$)/i.test(url);
  return (
    <figure
      ref={ref}
      className={`overflow-hidden rounded-xl border border-white/10 bg-black/40 ${compact ? "w-full" : "w-full max-w-sm"}`}
    >
      {!visible && !src ? (
        <div className={compact ? "h-40" : "h-72 sm:h-96"} />
      ) : query.isLoading ? (
        <p
          role="status"
          className={`p-4 text-xs ${compact ? "h-40" : "h-72 sm:h-96"}`}
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
