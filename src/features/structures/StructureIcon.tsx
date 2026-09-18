import {
  Archive,
  BookOpen,
  Bookmark,
  BriefcaseBusiness,
  Camera,
  FileArchive,
  FileText,
  Folder,
  Image,
  Layers3,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const icons: Record<string, LucideIcon> = {
  layers: Layers3,
  briefcase: BriefcaseBusiness,
  sparkles: Sparkles,
  camera: Camera,
  archive: Archive,
  "book-open": BookOpen,
  folder: Folder,
  image: Image,
  video: Video,
  "file-text": FileText,
  bookmark: Bookmark,
};

export function StructureIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = icons[name ?? ""] ?? Folder;
  return <Icon className={className} aria-hidden="true" />;
}

export function FileTypeIcon({ category, className }: { category: string; className?: string }) {
  const Icon = category === "image" ? Image : category === "video" ? Video : category === "archive" ? FileArchive : FileText;
  return <Icon className={cn("h-5 w-5", className)} aria-hidden="true" />;
}
