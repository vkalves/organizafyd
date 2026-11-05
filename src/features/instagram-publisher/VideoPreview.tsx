import { useEffect, useRef } from "react";
export function VideoPreview({
  src,
  visible,
  label,
  className,
  onError,
}: {
  src: string;
  visible: boolean;
  label: string;
  className: string;
  onError?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!visible && ref.current) {
      ref.current.pause();
      ref.current.load();
    }
  }, [visible]);
  return (
    <video
      ref={ref}
      src={visible ? src : undefined}
      controls
      muted
      playsInline
      preload={visible ? "metadata" : "none"}
      aria-label={label}
      onError={onError}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (video.duration > 0.1) video.currentTime = 0.1;
      }}
      className={className}
    />
  );
}
