import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
interface Props {
  children: ReactNode;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label: string;
}
export function MediaDropZone({
  children,
  onFiles,
  disabled = false,
  label,
}: Props) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  function hasFiles(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }
  return (
    <div
      role="region"
      aria-label={label}
      className={`x-media-dropzone ${active && !disabled ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current += 1;
        if (!disabled) setActive(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        event.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setActive(false);
      }}
      onDrop={(event) => {
        // Always consume a drop here so the browser cannot replace the app with a file.
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setActive(false);
        if (disabled) return;
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      <p className="x-media-drop-hint">
        <Upload size={14} />
        {disabled
          ? "Aguarde o processamento para adicionar arquivos."
          : "Arraste e solte fotos ou um vídeo aqui. As fotos ficam juntas nesta postagem."}
      </p>
      {active && !disabled && (
        <div className="x-media-drop-overlay" aria-hidden="true">
          <Upload size={28} />
          <strong>Solte para adicionar à postagem</strong>
          <span>Até 4 fotos ou 1 vídeo</span>
        </div>
      )}
    </div>
  );
}
