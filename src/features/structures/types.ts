import type { Tables } from "@/integrations/supabase/types";

export type Structure = Tables<"structures">;
export type StructureFolder = Tables<"structure_folders">;
export type StructureItem = Tables<"structure_items">;
export type FolderShare = Tables<"structure_folder_shares">;

export type UploadStatus = "queued" | "uploading" | "saving" | "done" | "error";

export interface UploadTask {
  id: string;
  itemId: string;
  file: File;
  storagePath: string;
  uploadGroup: string;
  progress: number;
  status: UploadStatus;
  error?: string;
}

export type SearchResult =
  | { type: "structure"; id: string; structureId: string; title: string; subtitle: string }
  | { type: "folder"; id: string; structureId: string; folderId: string; title: string; subtitle: string }
  | { type: "item"; id: string; structureId: string; folderId: string; title: string; subtitle: string };

export interface SharedFolderPayload {
  structure: Pick<Structure, "id" | "name" | "icon" | "color" | "updated_at">;
  root_folder: Pick<StructureFolder, "id" | "structure_id" | "name" | "icon" | "color">;
  current_folder: Omit<StructureFolder, "structure_id" | "user_id" | "position">;
  breadcrumbs: Array<{ id: string; name: string }>;
  folders: Array<Pick<StructureFolder, "id" | "parent_id" | "name" | "icon" | "color" | "created_at" | "updated_at">>;
  items: Array<Omit<StructureItem, "storage_path" | "structure_id" | "user_id">>;
  allow_download: boolean;
  updated_at: string;
}
