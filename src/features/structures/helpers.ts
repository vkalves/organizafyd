import type { StructureFolder, StructureItem } from "./types";

export const STRUCTURE_BUCKET = "structure-files";
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_STRUCTURE_IMAGE_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_FILE_EXTENSIONS = [
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif",
  "mp4", "webm", "mov", "pdf", "txt", "csv", "doc", "docx",
  "xls", "xlsx", "ppt", "pptx", "zip", "rar", "7z",
];

export const FILE_ACCEPT = ACCEPTED_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
export const ACCEPTED_FILE_LABEL = "JPG, PNG, WEBP, GIF, HEIC, MP4, WEBM, MOV, PDF, TXT, CSV, DOC, DOCX, XLS, XLSX, PPT, PPTX, ZIP, RAR e 7Z";

export const STRUCTURE_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#22c55e", "#eab308", "#64748b"];
export const STRUCTURE_ICONS = ["layers", "briefcase", "sparkles", "camera", "archive", "book-open"];
export const FOLDER_ICONS = ["folder", "image", "video", "file-text", "archive", "bookmark"];

export function isAcceptedFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ACCEPTED_FILE_EXTENSIONS.includes(extension);
}

export function safeFileName(name: string) {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 140) || "arquivo";
}

export function formatBytes(bytes?: number | null) {
  if (bytes == null) return "";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatRelativeDate(value: string) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diff / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function formatDayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Hoje";
  if (sameDay(date, yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function fileCategory(item: Pick<StructureItem, "mime_type" | "original_name">) {
  const mime = item.mime_type ?? "";
  const extension = item.original_name?.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(extension)) return "image";
  if (mime.startsWith("video/") || ["mp4", "webm", "mov"].includes(extension)) return "video";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (["zip", "rar", "7z"].includes(extension)) return "archive";
  return "document";
}

export function getDescendantIds(folders: StructureFolder[], folderId: string) {
  const result = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parent_id && result.has(folder.parent_id) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

export function getFolderPath(folders: StructureFolder[], folderId: string | null) {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: StructureFolder[] = [];
  let current = byId.get(folderId);
  let guard = 0;
  while (current && guard < 100) {
    path.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
    guard += 1;
  }
  return path;
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
