import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Link2,
  Loader2,
  MoreVertical,
  Move,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAppLayout } from "@/contexts/AppLayoutContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileViewer } from "@/features/structures/FileViewer";
import {
  FolderEditorDialog,
  LinkEditorDialog,
  MoveDialog,
  StructureEditorDialog,
  TextEditorDialog,
  type FolderFormValue,
  type StructureFormValue,
} from "@/features/structures/StructureDialogs";
import { StructureIcon } from "@/features/structures/StructureIcon";
import { StructureItemCard } from "@/features/structures/StructureItemCard";
import {
  ACCEPTED_FILE_LABEL,
  FILE_ACCEPT,
  MAX_FILE_BYTES,
  STRUCTURE_BUCKET,
  fileCategory,
  formatDayLabel,
  formatRelativeDate,
  getDescendantIds,
  getFolderPath,
  isAcceptedFile,
  normalizeUrl,
  safeFileName,
} from "@/features/structures/helpers";
import { uploadStructureFile } from "@/features/structures/upload";
import type { FolderShare, SearchResult, Structure, StructureFolder, StructureItem, UploadTask } from "@/features/structures/types";
import type { TablesInsert } from "@/integrations/supabase/types";

type DeleteTarget =
  | { type: "structure"; structure: Structure }
  | { type: "folder"; folder: StructureFolder }
  | { type: "item"; item: StructureItem };

const Estruturas = () => {
  const { user, session } = useAuth();
  const { setMobileFocusMode } = useAppLayout();
  const isMobile = useIsMobile();
  const [structures, setStructures] = useState<Structure[]>([]);
  const [folders, setFolders] = useState<StructureFolder[]>([]);
  const [items, setItems] = useState<StructureItem[]>([]);
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loadingStructures, setLoadingStructures] = useState(true);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [structureImages, setStructureImages] = useState<Record<string, string>>({});
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [structureDialogOpen, setStructureDialogOpen] = useState(false);
  const [editingStructure, setEditingStructure] = useState<Structure | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<StructureFolder | null>(null);
  const [folderParentId, setFolderParentId] = useState<string | null>(null);
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StructureItem | null>(null);
  const [moveFolder, setMoveFolder] = useState<StructureFolder | null>(null);
  const [moveItem, setMoveItem] = useState<StructureItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [entityBusy, setEntityBusy] = useState(false);
  const [composer, setComposer] = useState("");
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [dragging, setDragging] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareFolderId, setShareFolderId] = useState<string | null>(null);
  const [share, setShare] = useState<FolderShare | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [rotateShareConfirm, setRotateShareConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const structuresScrollRef = useRef<HTMLDivElement>(null);
  const foldersScrollRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef({ structures: 0, folders: 0, content: new Map<string, number>() });

  const selectedStructure = structures.find((structure) => structure.id === selectedStructureId) ?? null;
  const currentFolder = folders.find((folder) => folder.id === currentFolderId) ?? null;
  const folderPath = useMemo(() => getFolderPath(folders, currentFolderId), [currentFolderId, folders]);
  const rootFolders = useMemo(() => folders.filter((folder) => folder.parent_id === null).sort(sortFolders), [folders]);
  const childFolders = useMemo(() => folders.filter((folder) => folder.parent_id === currentFolderId).sort(sortFolders), [currentFolderId, folders]);
  const currentItems = useMemo(() => items.filter((item) => item.folder_id === currentFolderId).sort((a, b) => a.created_at.localeCompare(b.created_at)), [currentFolderId, items]);

  useEffect(() => {
    setMobileFocusMode(isMobile && Boolean(selectedStructureId));
    return () => setMobileFocusMode(false);
  }, [isMobile, selectedStructureId, setMobileFocusMode]);

  const signStructureImages = useCallback(async (rows: Structure[]) => {
    const withImages = rows.filter((row) => row.image_path);
    if (!withImages.length) return setStructureImages({});
    const signed = await Promise.all(withImages.map(async (row) => {
      const { data } = await supabase.storage.from(STRUCTURE_BUCKET).createSignedUrl(row.image_path!, 3600);
      return data?.signedUrl ? [row.id, data.signedUrl] as const : null;
    }));
    setStructureImages(Object.fromEntries(signed.filter(Boolean) as Array<readonly [string, string]>));
  }, []);

  const signItemPreviews = useCallback(async (rows: StructureItem[]) => {
    const previewable = rows.filter((row) => row.kind === "file" && row.storage_path && ["image", "video"].includes(fileCategory(row)));
    if (!previewable.length) return setPreviewUrls({});
    const signed = await Promise.all(previewable.map(async (row) => {
      const { data } = await supabase.storage.from(STRUCTURE_BUCKET).createSignedUrl(row.storage_path!, 3600);
      return data?.signedUrl ? [row.id, data.signedUrl] as const : null;
    }));
    setPreviewUrls(Object.fromEntries(signed.filter(Boolean) as Array<readonly [string, string]>));
  }, []);

  const loadStructures = useCallback(async () => {
    if (!user) return;
    setLoadingStructures(true);
    setLoadError("");
    const { data, error } = await supabase.from("structures").select("*").eq("user_id", user.id).order("updated_at", { ascending: false });
    if (error) {
      setLoadError("Não foi possível carregar suas estruturas.");
      toast.error(error.message);
    } else {
      const rows = data ?? [];
      setStructures(rows);
      void signStructureImages(rows);
    }
    setLoadingStructures(false);
  }, [signStructureImages, user]);

  const loadStructure = useCallback(async (structureId: string) => {
    if (!user) return;
    setLoadingStructure(true);
    setLoadError("");
    const [folderResult, itemResult] = await Promise.all([
      supabase.from("structure_folders").select("*").eq("user_id", user.id).eq("structure_id", structureId).order("position").order("created_at"),
      supabase.from("structure_items").select("*").eq("user_id", user.id).eq("structure_id", structureId).order("created_at"),
    ]);
    if (folderResult.error || itemResult.error) {
      const message = folderResult.error?.message || itemResult.error?.message || "Erro desconhecido";
      setLoadError("Não foi possível abrir esta estrutura.");
      toast.error(message);
    } else {
      setFolders(folderResult.data ?? []);
      setItems(itemResult.data ?? []);
      void signItemPreviews(itemResult.data ?? []);
    }
    setLoadingStructure(false);
  }, [signItemPreviews, user]);

  useEffect(() => { void loadStructures(); }, [loadStructures]);

  useEffect(() => {
    const term = search.trim().replace(/[%_(),]/g, "");
    if (term.length < 2 || !user) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      const pattern = `%${term}%`;
      const [structureResult, folderResult, titleResult, bodyResult, urlResult, fileResult] = await Promise.all([
        supabase.from("structures").select("id, name, description").eq("user_id", user.id).ilike("name", pattern).limit(8),
        supabase.from("structure_folders").select("id, structure_id, name").eq("user_id", user.id).ilike("name", pattern).limit(10),
        supabase.from("structure_items").select("id, structure_id, folder_id, kind, title, original_name").eq("user_id", user.id).ilike("title", pattern).limit(10),
        supabase.from("structure_items").select("id, structure_id, folder_id, kind, title, original_name").eq("user_id", user.id).ilike("body", pattern).limit(10),
        supabase.from("structure_items").select("id, structure_id, folder_id, kind, title, original_name").eq("user_id", user.id).ilike("url", pattern).limit(10),
        supabase.from("structure_items").select("id, structure_id, folder_id, kind, title, original_name").eq("user_id", user.id).ilike("original_name", pattern).limit(10),
      ]);
      if (!active) return;
      const structureName = (id: string) => structures.find((entry) => entry.id === id)?.name || "Estrutura";
      const next: SearchResult[] = (structureResult.data ?? []).map((entry) => ({ type: "structure", id: entry.id, structureId: entry.id, title: entry.name, subtitle: entry.description || "Estrutura" }));
      next.push(...(folderResult.data ?? []).map((entry) => ({ type: "folder" as const, id: entry.id, structureId: entry.structure_id, folderId: entry.id, title: entry.name, subtitle: `Pasta em ${structureName(entry.structure_id)}` })));
      const itemMap = new Map<string, NonNullable<typeof titleResult.data>[number]>();
      for (const result of [titleResult, bodyResult, urlResult, fileResult]) for (const entry of result.data ?? []) itemMap.set(entry.id, entry);
      next.push(...Array.from(itemMap.values()).slice(0, 12).map((entry) => ({ type: "item" as const, id: entry.id, structureId: entry.structure_id, folderId: entry.folder_id, title: entry.title || entry.original_name || "Conteúdo", subtitle: `${entry.kind === "file" ? "Arquivo" : entry.kind === "link" ? "Link" : "Texto"} em ${structureName(entry.structure_id)}` })));
      setSearchResults(next.slice(0, 24));
      setSearching(false);
    }, 280);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [search, structures, user]);

  const selectStructure = (structureId: string) => {
    if (structuresScrollRef.current) scrollPositions.current.structures = structuresScrollRef.current.scrollTop;
    setSelectedStructureId(structureId);
    setCurrentFolderId(null);
    setFolders([]);
    setItems([]);
    setPreviewUrls({});
    void loadStructure(structureId);
    requestAnimationFrame(() => { if (foldersScrollRef.current) foldersScrollRef.current.scrollTop = scrollPositions.current.folders; });
  };

  const openFolder = (folderId: string) => {
    if (contentScrollRef.current && currentFolderId) scrollPositions.current.content.set(currentFolderId, contentScrollRef.current.scrollTop);
    setCurrentFolderId(folderId);
    requestAnimationFrame(() => { if (contentScrollRef.current) contentScrollRef.current.scrollTop = scrollPositions.current.content.get(folderId) ?? 0; });
  };

  const backFromFolders = () => {
    if (foldersScrollRef.current) scrollPositions.current.folders = foldersScrollRef.current.scrollTop;
    setSelectedStructureId(null);
    setCurrentFolderId(null);
    requestAnimationFrame(() => { if (structuresScrollRef.current) structuresScrollRef.current.scrollTop = scrollPositions.current.structures; });
  };

  const backFromContent = () => {
    if (!currentFolder) return;
    if (contentScrollRef.current) scrollPositions.current.content.set(currentFolder.id, contentScrollRef.current.scrollTop);
    if (currentFolder.parent_id) openFolder(currentFolder.parent_id);
    else {
      setCurrentFolderId(null);
      requestAnimationFrame(() => { if (foldersScrollRef.current) foldersScrollRef.current.scrollTop = scrollPositions.current.folders; });
    }
  };

  const openSearchResult = (result: SearchResult) => {
    setSearch("");
    setSearchResults([]);
    setSelectedStructureId(result.structureId);
    setFolders([]);
    setItems([]);
    setCurrentFolderId(result.type === "structure" ? null : result.folderId);
    void loadStructure(result.structureId);
  };

  const saveStructure = async (value: StructureFormValue) => {
    if (!user) return;
    setEntityBusy(true);
    try {
      let row: Structure;
      if (editingStructure) {
        row = editingStructure;
      } else {
        const { data, error } = await supabase.from("structures").insert({ user_id: user.id, name: value.name, description: value.description || null, icon: value.icon, color: value.color }).select().single();
        if (error) throw error;
        row = data;
      }

      let imagePath = value.removeImage ? null : row.image_path;
      if (value.image) {
        const nextPath = `${user.id}/structures/${row.id}/${crypto.randomUUID()}-${safeFileName(value.image.name)}`;
        const { error } = await supabase.storage.from(STRUCTURE_BUCKET).upload(nextPath, value.image, { contentType: value.image.type, upsert: false });
        if (error) throw error;
        imagePath = nextPath;
      }

      const { data: saved, error } = await supabase.from("structures").update({ name: value.name, description: value.description || null, icon: value.icon, color: value.color, image_path: imagePath }).eq("id", row.id).select().single();
      if (error) throw error;

      if (row.image_path && row.image_path !== imagePath) await supabase.storage.from(STRUCTURE_BUCKET).remove([row.image_path]);
      setStructures((previous) => [saved, ...previous.filter((entry) => entry.id !== saved.id)].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      void signStructureImages([saved]).then(() => loadStructures());
      setStructureDialogOpen(false);
      setEditingStructure(null);
      toast.success(editingStructure ? "Estrutura atualizada." : "Estrutura criada.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar a estrutura.");
    } finally {
      setEntityBusy(false);
    }
  };

  const saveFolder = async (value: FolderFormValue) => {
    if (!user || !selectedStructureId) return;
    setEntityBusy(true);
    try {
      if (editingFolder) {
        const { data, error } = await supabase.from("structure_folders").update(value).eq("id", editingFolder.id).select().single();
        if (error) throw error;
        setFolders((previous) => previous.map((folder) => folder.id === data.id ? data : folder));
        toast.success("Pasta atualizada.");
      } else {
        const { data, error } = await supabase.from("structure_folders").insert({ ...value, structure_id: selectedStructureId, parent_id: folderParentId, user_id: user.id }).select().single();
        if (error) throw error;
        setFolders((previous) => [...previous, data]);
        toast.success(folderParentId ? "Subpasta criada." : "Pasta criada.");
      }
      setFolderDialogOpen(false);
      setEditingFolder(null);
      setFolderParentId(null);
      touchSelectedStructure();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar a pasta.");
    } finally {
      setEntityBusy(false);
    }
  };

  const saveText = async (value: { title: string; body: string }) => {
    if (!user || !selectedStructureId || !currentFolderId) return;
    setEntityBusy(true);
    try {
      if (editingItem) {
        const { data, error } = await supabase.from("structure_items").update({ title: value.title || null, body: value.body }).eq("id", editingItem.id).select().single();
        if (error) throw error;
        setItems((previous) => previous.map((item) => item.id === data.id ? data : item));
      } else {
        const { data, error } = await supabase.from("structure_items").insert({ user_id: user.id, structure_id: selectedStructureId, folder_id: currentFolderId, kind: "text", title: value.title || null, body: value.body }).select().single();
        if (error) throw error;
        setItems((previous) => [...previous, data]);
      }
      setTextDialogOpen(false);
      setEditingItem(null);
      touchSelectedStructure();
      toast.success("Texto salvo.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o texto.");
    } finally { setEntityBusy(false); }
  };

  const saveLink = async (value: { title: string; url: string; body: string }) => {
    if (!user || !selectedStructureId || !currentFolderId) return;
    setEntityBusy(true);
    try {
      const url = normalizeUrl(value.url);
      if (editingItem) {
        const { data, error } = await supabase.from("structure_items").update({ title: value.title, url, body: value.body || null }).eq("id", editingItem.id).select().single();
        if (error) throw error;
        setItems((previous) => previous.map((item) => item.id === data.id ? data : item));
      } else {
        const { data, error } = await supabase.from("structure_items").insert({ user_id: user.id, structure_id: selectedStructureId, folder_id: currentFolderId, kind: "link", title: value.title, url, body: value.body || null }).select().single();
        if (error) throw error;
        setItems((previous) => [...previous, data]);
      }
      setLinkDialogOpen(false);
      setEditingItem(null);
      touchSelectedStructure();
      toast.success("Link salvo.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o link.");
    } finally { setEntityBusy(false); }
  };

  const sendComposer = async () => {
    const value = composer.trim();
    if (!value || !user || !selectedStructureId || !currentFolderId) return;
    setEntityBusy(true);
    try {
      const looksLikeLink = /^(https?:\/\/|www\.)\S+$/i.test(value);
      const payload: TablesInsert<"structure_items"> = looksLikeLink
        ? { user_id: user.id, structure_id: selectedStructureId, folder_id: currentFolderId, kind: "link", title: new URL(normalizeUrl(value)).hostname, url: normalizeUrl(value) }
        : { user_id: user.id, structure_id: selectedStructureId, folder_id: currentFolderId, kind: "text", body: value };
      const { data, error } = await supabase.from("structure_items").insert(payload).select().single();
      if (error) throw error;
      setItems((previous) => [...previous, data]);
      setComposer("");
      touchSelectedStructure();
      requestAnimationFrame(() => { if (contentScrollRef.current) contentScrollRef.current.scrollTop = contentScrollRef.current.scrollHeight; });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o conteúdo.");
    } finally { setEntityBusy(false); }
  };

  const touchSelectedStructure = useCallback(() => {
    if (!selectedStructureId) return;
    const now = new Date().toISOString();
    setStructures((previous) => previous.map((entry) => entry.id === selectedStructureId ? { ...entry, updated_at: now } : entry));
  }, [selectedStructureId]);

  const updateUploadTask = (id: string, updates: Partial<UploadTask>) => setUploadTasks((previous) => previous.map((task) => task.id === id ? { ...task, ...updates } : task));

  const processUpload = useCallback(async (task: UploadTask, retry = false) => {
    if (!session?.access_token || !user || !selectedStructureId || !currentFolderId) return;
    updateUploadTask(task.id, { status: "uploading", progress: 0, error: undefined });
    try {
      await uploadStructureFile({ path: task.storagePath, file: task.file, accessToken: session.access_token, upsert: retry, onProgress: (progress) => updateUploadTask(task.id, { progress }) });
      updateUploadTask(task.id, { status: "saving", progress: 100 });
      const { data, error } = await supabase.from("structure_items").insert({
        id: task.itemId,
        user_id: user.id,
        structure_id: selectedStructureId,
        folder_id: currentFolderId,
        kind: "file",
        title: task.file.name,
        storage_path: task.storagePath,
        original_name: task.file.name,
        mime_type: task.file.type || "application/octet-stream",
        size_bytes: task.file.size,
        upload_group: task.uploadGroup,
      }).select().single();
      if (error) {
        await supabase.storage.from(STRUCTURE_BUCKET).remove([task.storagePath]);
        throw error;
      }
      setItems((previous) => [...previous, data]);
      if (["image", "video"].includes(fileCategory(data))) {
        const { data: signed } = await supabase.storage.from(STRUCTURE_BUCKET).createSignedUrl(task.storagePath, 3600);
        if (signed?.signedUrl) setPreviewUrls((previous) => ({ ...previous, [data.id]: signed.signedUrl }));
      }
      updateUploadTask(task.id, { status: "done", progress: 100 });
      touchSelectedStructure();
      window.setTimeout(() => setUploadTasks((previous) => previous.filter((entry) => entry.id !== task.id)), 3000);
    } catch (cause) {
      updateUploadTask(task.id, { status: "error", error: cause instanceof Error ? cause.message : "Falha no envio." });
    }
  }, [currentFolderId, selectedStructureId, session?.access_token, touchSelectedStructure, user]);

  const enqueueFiles = (fileList: FileList | File[]) => {
    if (!user || !selectedStructureId || !currentFolderId) return;
    const filesToUpload = Array.from(fileList);
    const valid: File[] = [];
    for (const file of filesToUpload) {
      if (file.size > MAX_FILE_BYTES) toast.error(`${file.name}: o limite é 50 MB.`);
      else if (!isAcceptedFile(file)) toast.error(`${file.name}: formato não aceito.`);
      else valid.push(file);
    }
    if (!valid.length) return;
    const uploadGroup = crypto.randomUUID();
    const tasks = valid.map((file): UploadTask => {
      const itemId = crypto.randomUUID();
      return { id: crypto.randomUUID(), itemId, file, uploadGroup, storagePath: `${user.id}/${selectedStructureId}/${currentFolderId}/${itemId}/${safeFileName(file.name)}`, progress: 0, status: "queued" };
    });
    setUploadTasks((previous) => [...previous, ...tasks]);
    void Promise.allSettled(tasks.map((task) => processUpload(task))).then((results) => {
      const successes = results.filter((result) => result.status === "fulfilled").length;
      if (successes) toast.success(`${successes} ${successes === 1 ? "arquivo enviado" : "arquivos enviados"}.`);
    });
  };

  const retryUpload = (task: UploadTask) => void processUpload(task, true);

  const resolveOwnerFileUrl = useCallback(async (item: Pick<StructureItem, "id" | "kind" | "mime_type" | "original_name" | "size_bytes" | "title">, download: boolean) => {
    const fullItem = items.find((entry) => entry.id === item.id);
    if (!fullItem?.storage_path) throw new Error("Arquivo não encontrado.");
    const options = download && fullItem.original_name ? { download: fullItem.original_name } : undefined;
    const { data, error } = await supabase.storage.from(STRUCTURE_BUCKET).createSignedUrl(fullItem.storage_path, 300, options);
    if (error || !data?.signedUrl) throw error ?? new Error("Não foi possível abrir o arquivo.");
    return data.signedUrl;
  }, [items]);

  const downloadItem = async (item: StructureItem) => {
    try {
      const url = await resolveOwnerFileUrl(item, true);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.original_name || "arquivo";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível baixar."); }
  };

  const removeStoragePaths = async (paths: string[]) => {
    const unique = Array.from(new Set(paths.filter(Boolean)));
    for (let index = 0; index < unique.length; index += 100) {
      const { error } = await supabase.storage.from(STRUCTURE_BUCKET).remove(unique.slice(index, index + 100));
      if (error) throw error;
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setEntityBusy(true);
    try {
      if (deleteTarget.type === "item") {
        if (deleteTarget.item.storage_path) await removeStoragePaths([deleteTarget.item.storage_path]);
        const { error } = await supabase.from("structure_items").delete().eq("id", deleteTarget.item.id);
        if (error) throw error;
        setItems((previous) => previous.filter((item) => item.id !== deleteTarget.item.id));
      } else if (deleteTarget.type === "folder") {
        const descendantIds = getDescendantIds(folders, deleteTarget.folder.id);
        const affectedItems = items.filter((item) => descendantIds.has(item.folder_id));
        await removeStoragePaths(affectedItems.map((item) => item.storage_path || ""));
        const { error } = await supabase.from("structure_folders").delete().eq("id", deleteTarget.folder.id);
        if (error) throw error;
        setFolders((previous) => previous.filter((folder) => !descendantIds.has(folder.id)));
        setItems((previous) => previous.filter((item) => !descendantIds.has(item.folder_id)));
        if (currentFolderId && descendantIds.has(currentFolderId)) setCurrentFolderId(deleteTarget.folder.parent_id);
      } else {
        const structure = deleteTarget.structure;
        const { data: storedItems, error: itemError } = await supabase.from("structure_items").select("storage_path").eq("structure_id", structure.id);
        if (itemError) throw itemError;
        await removeStoragePaths([...(storedItems ?? []).map((item) => item.storage_path || ""), structure.image_path || ""]);
        const { error } = await supabase.from("structures").delete().eq("id", structure.id);
        if (error) throw error;
        setStructures((previous) => previous.filter((entry) => entry.id !== structure.id));
        if (selectedStructureId === structure.id) {
          setSelectedStructureId(null); setCurrentFolderId(null); setFolders([]); setItems([]);
        }
      }
      toast.success("Exclusão concluída.");
      setDeleteTarget(null);
      touchSelectedStructure();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível excluir.");
    } finally { setEntityBusy(false); }
  };

  const executeMoveFolder = async (parentId: string | null) => {
    if (!moveFolder) return;
    setEntityBusy(true);
    const { data, error } = await supabase.from("structure_folders").update({ parent_id: parentId }).eq("id", moveFolder.id).select().single();
    if (error) toast.error(error.message);
    else {
      setFolders((previous) => previous.map((folder) => folder.id === data.id ? data : folder));
      setMoveFolder(null);
      touchSelectedStructure();
      toast.success("Pasta movida.");
    }
    setEntityBusy(false);
  };

  const executeMoveItem = async (folderId: string | null) => {
    if (!moveItem || !folderId) return;
    setEntityBusy(true);
    const { data, error } = await supabase.from("structure_items").update({ folder_id: folderId }).eq("id", moveItem.id).select().single();
    if (error) toast.error(error.message);
    else {
      setItems((previous) => previous.map((item) => item.id === data.id ? data : item));
      setMoveItem(null);
      touchSelectedStructure();
      toast.success("Conteúdo movido.");
    }
    setEntityBusy(false);
  };

  const openShareDialog = async (folder: StructureFolder) => {
    if (folder.id !== currentFolderId) openFolder(folder.id);
    setShareFolderId(folder.id);
    setShareDialogOpen(true);
    setShare(null);
    setShareBusy(true);
    const { data, error } = await supabase.from("structure_folder_shares").select("*").eq("root_folder_id", folder.id).maybeSingle();
    if (error) toast.error(error.message);
    else setShare(data);
    setShareBusy(false);
  };

  const manageShare = async (action: "enable" | "disable" | "rotate" | "permissions", allowDownload = share?.allow_download ?? true) => {
    if (!shareFolderId) return;
    setShareBusy(true);
    const { data, error } = await supabase.rpc("manage_structure_folder_share", { p_folder_id: shareFolderId, p_action: action, p_allow_download: allowDownload });
    if (error) toast.error(error.message);
    else {
      setShare(data);
      toast.success(action === "disable" ? "Compartilhamento desativado." : action === "rotate" ? "Novo link gerado. O anterior foi invalidado." : "Compartilhamento atualizado.");
    }
    setShareBusy(false);
    setRotateShareConfirm(false);
  };

  const shareLink = share?.active ? `${window.location.origin}/shared/${share.token}` : "";
  const copyShareLink = async () => {
    await navigator.clipboard.writeText(shareLink);
    toast.success("Link copiado.");
  };

  const deleteDescription = useMemo(() => {
    if (!deleteTarget) return "";
    if (deleteTarget.type === "structure") return `Excluir “${deleteTarget.structure.name}”? Todas as pastas, subpastas, anotações, links, arquivos e links de compartilhamento internos serão excluídos permanentemente.`;
    if (deleteTarget.type === "folder") {
      const descendants = getDescendantIds(folders, deleteTarget.folder.id);
      const nested = Math.max(0, descendants.size - 1);
      const content = items.filter((item) => descendants.has(item.folder_id)).length;
      return `Excluir “${deleteTarget.folder.name}”? Isso também excluirá ${nested} ${nested === 1 ? "subpasta" : "subpastas"} e ${content} ${content === 1 ? "conteúdo interno" : "conteúdos internos"}.`;
    }
    return `Excluir “${deleteTarget.item.original_name || deleteTarget.item.title || "este conteúdo"}”?${deleteTarget.item.kind === "file" ? " O arquivo original também será removido do armazenamento." : ""}`;
  }, [deleteTarget, folders, items]);

  const dayGroups = useMemo(() => {
    const groups = new Map<string, StructureItem[]>();
    for (const item of currentItems) {
      const key = new Date(item.created_at).toDateString();
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.values());
  }, [currentItems]);

  const activeRootId = folderPath[0]?.id;

  return (
    <div className="structures-workspace mx-auto flex min-h-[calc(100dvh-8.25rem)] min-w-0 max-w-[1600px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl lg:h-[calc(100dvh-7.5rem)] lg:min-h-[38rem]">
      <section className={cn("min-w-0 flex-1 flex-col border-r border-border bg-sidebar md:flex md:max-w-[18rem] md:basis-[25%]", selectedStructureId ? "hidden" : "flex")} aria-label="Lista de estruturas">
        <div className="shrink-0 border-b border-border p-3">
          <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
            <div><h1 className="text-lg font-bold text-foreground">Estruturas</h1><p className="text-xs text-muted-foreground">Seus espaços organizados</p></div>
            <button type="button" onClick={() => { setEditingStructure(null); setStructureDialogOpen(true); }} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90" aria-label="Criar estrutura"><Plus className="h-5 w-5" /></button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tudo..." className="h-10 w-full rounded-lg border border-border bg-secondary pl-9 pr-9 text-sm text-foreground outline-none focus:border-muted-foreground" />
            {search && <button type="button" onClick={() => setSearch("")} className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" aria-label="Limpar busca"><X className="h-4 w-4" /></button>}
          </div>
          {search.trim().length >= 2 && (
            <div className="absolute z-30 mt-2 max-h-[min(28rem,60vh)] w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-2xl md:w-[17rem]">
              {searching ? <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando...</div> : searchResults.length ? searchResults.map((result) => (
                <button key={`${result.type}-${result.id}`} type="button" onClick={() => openSearchResult(result)} className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left hover:bg-accent">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">{result.type === "structure" ? <StructureIcon name="layers" className="h-4 w-4" /> : result.type === "folder" ? <FolderOpen className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />}</div>
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{result.title}</p><p className="truncate text-xs text-muted-foreground">{result.subtitle}</p></div>
                </button>
              )) : <p className="p-4 text-center text-sm text-muted-foreground">Nada encontrado.</p>}
            </div>
          )}
        </div>

        <div ref={structuresScrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {loadingStructures ? <ListSkeleton /> : loadError && !structures.length ? <ErrorState message={loadError} onRetry={() => void loadStructures()} /> : structures.length ? structures.map((structure) => (
            <div key={structure.id} role="button" tabIndex={0} onClick={() => selectStructure(structure.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectStructure(structure.id); } }} className={cn("group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-sidebar-accent", selectedStructureId === structure.id && "bg-sidebar-accent")}>
              <StructureAvatar structure={structure} imageUrl={structureImages[structure.id]} />
              <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold text-sidebar-accent-foreground">{structure.name}</p><span className="shrink-0 text-[10px] text-muted-foreground">{formatRelativeDate(structure.updated_at)}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{structure.description || "Toque para abrir as pastas"}</p></div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}><button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-100 hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100" aria-label={`Ações da estrutura ${structure.name}`}><MoreVertical className="h-4 w-4" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setEditingStructure(structure); setStructureDialogOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setDeleteTarget({ type: "structure", structure })} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
            </div>
          )) : <EmptyState icon={<FolderOpen className="h-7 w-7" />} title="Nenhuma estrutura" description="Crie seu primeiro espaço para organizar pastas e arquivos." action="Criar estrutura" onAction={() => { setEditingStructure(null); setStructureDialogOpen(true); }} />}
        </div>
      </section>

      <section className={cn("min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:max-w-[19rem] md:basis-[27%]", !selectedStructureId || currentFolderId ? "hidden" : "flex")} aria-label="Pastas da estrutura">
        {selectedStructure ? <>
          <header className="flex min-h-[4.6rem] shrink-0 items-center gap-2 border-b border-border px-3">
            <button type="button" onClick={backFromFolders} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground md:hidden" aria-label="Voltar para estruturas"><ArrowLeft className="h-5 w-5" /></button>
            <StructureAvatar structure={selectedStructure} imageUrl={structureImages[selectedStructure.id]} small />
            <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{selectedStructure.name}</h2><p className="text-xs text-muted-foreground">{folders.length} {folders.length === 1 ? "pasta" : "pastas"}</p></div>
            <button type="button" onClick={() => { setEditingFolder(null); setFolderParentId(null); setFolderDialogOpen(true); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Criar pasta"><FolderPlus className="h-5 w-5" /></button>
          </header>
          <div ref={foldersScrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
            {loadingStructure ? <ListSkeleton /> : loadError ? <ErrorState message={loadError} onRetry={() => void loadStructure(selectedStructure.id)} /> : rootFolders.length ? rootFolders.map((folder) => {
              const nestedCount = folders.filter((entry) => entry.parent_id === folder.id).length;
              const itemCount = items.filter((entry) => entry.folder_id === folder.id).length;
              const selected = activeRootId === folder.id;
              return <div key={folder.id} role="button" tabIndex={0} onClick={() => openFolder(folder.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFolder(folder.id); } }} className={cn("group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-accent/60", selected && "bg-accent")}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${folder.color}24`, color: folder.color }}><StructureIcon name={folder.icon} className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{folder.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{itemCount} itens{nestedCount ? ` · ${nestedCount} subpastas` : ""}</p></div>
                <FolderMenu folder={folder} onEdit={() => { setEditingFolder(folder); setFolderDialogOpen(true); }} onMove={() => setMoveFolder(folder)} onShare={() => void openShareDialog(folder)} onDelete={() => setDeleteTarget({ type: "folder", folder })} />
              </div>;
            }) : <EmptyState icon={<FolderPlus className="h-7 w-7" />} title="Sem pastas" description="Crie uma pasta como Postagens, Fotos prontas ou Documentos." action="Criar pasta" onAction={() => { setFolderParentId(null); setEditingFolder(null); setFolderDialogOpen(true); }} />}
          </div>
        </> : <PanelPlaceholder text="Selecione uma estrutura para ver suas pastas." />}
      </section>

      <section className={cn("relative min-w-0 flex-[1.8] flex-col bg-background md:flex", !currentFolderId ? "hidden" : "flex")} aria-label="Conteúdo da pasta">
        {currentFolder && selectedStructure ? <>
          <header className="flex min-h-[4.6rem] shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-3">
            <button type="button" onClick={backFromContent} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground md:hidden" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${currentFolder.color}24`, color: currentFolder.color }}><StructureIcon name={currentFolder.icon} className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="scrollbar-none flex items-center gap-1 overflow-x-auto whitespace-nowrap">
                {folderPath.map((folder, index) => <span key={folder.id} className="flex items-center gap-1"><button type="button" onClick={() => openFolder(folder.id)} className={cn("max-w-[9rem] truncate text-sm", index === folderPath.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>{folder.name}</button>{index < folderPath.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}</span>)}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{currentItems.length} {currentItems.length === 1 ? "item" : "itens"} · {childFolders.length} {childFolders.length === 1 ? "subpasta" : "subpastas"}</p>
            </div>
            <button type="button" onClick={() => void openShareDialog(currentFolder)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Compartilhar pasta"><Share2 className="h-4 w-4" /></button>
            <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Ações da pasta"><MoreVertical className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setEditingFolder(currentFolder); setFolderDialogOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Editar pasta</DropdownMenuItem><DropdownMenuItem onSelect={() => { setEditingFolder(null); setFolderParentId(currentFolder.id); setFolderDialogOpen(true); }}><FolderPlus className="mr-2 h-4 w-4" />Nova subpasta</DropdownMenuItem><DropdownMenuItem onSelect={() => setMoveFolder(currentFolder)}><Move className="mr-2 h-4 w-4" />Mover pasta</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setDeleteTarget({ type: "folder", folder: currentFolder })} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir pasta</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          </header>

          <div
            ref={contentScrollRef}
            onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
            onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) enqueueFiles(event.dataTransfer.files); }}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
          >
            {dragging && <div className="absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-info bg-info/10 backdrop-blur-sm"><div className="text-center text-info"><UploadCloud className="mx-auto h-10 w-10" /><p className="mt-2 text-sm font-semibold">Solte para enviar à pasta</p></div></div>}

            {childFolders.length > 0 && <div className="mb-5"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subpastas</p><button type="button" onClick={() => { setEditingFolder(null); setFolderParentId(currentFolder.id); setFolderDialogOpen(true); }} className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="h-3.5 w-3.5" />Nova</button></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{childFolders.map((folder) => <button key={folder.id} type="button" onClick={() => openFolder(folder.id)} className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3 text-left hover:bg-accent/45"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${folder.color}24`, color: folder.color }}><StructureIcon name={folder.icon} className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{folder.name}</p><p className="text-xs text-muted-foreground">Abrir subpasta</p></div><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>)}</div></div>}

            {loadingStructure ? <TimelineSkeleton /> : !currentItems.length && !childFolders.length ? <EmptyState icon={<FilePlus2 className="h-7 w-7" />} title="Pasta vazia" description="Adicione uma anotação, salve um link ou envie seus primeiros arquivos." /> : <div className="flex flex-col gap-4">{dayGroups.map((dayItems) => <div key={new Date(dayItems[0].created_at).toDateString()} className="flex flex-col gap-2.5"><div className="sticky top-0 z-10 flex justify-center py-1"><span className="rounded-full border border-border bg-card/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">{formatDayLabel(dayItems[0].created_at)}</span></div>{groupMessages(dayItems).map((group) => group.length > 1 ? <div key={group[0].id} className="grid w-full max-w-[min(42rem,94%)] self-end grid-cols-1 gap-1.5 rounded-2xl rounded-br-md bg-secondary/40 p-1.5 sm:grid-cols-2">{group.map((item) => <StructureItemCard key={item.id} item={item} compact previewUrl={previewUrls[item.id]} onOpenFile={() => setViewerId(item.id)} onDownload={() => downloadItem(item)} onMove={() => setMoveItem(item)} onDelete={() => setDeleteTarget({ type: "item", item })} />)}</div> : <StructureItemCard key={group[0].id} item={group[0]} previewUrl={previewUrls[group[0].id]} onOpenFile={() => setViewerId(group[0].id)} onDownload={() => downloadItem(group[0])} onEdit={group[0].kind === "text" ? () => { setEditingItem(group[0]); setTextDialogOpen(true); } : group[0].kind === "link" ? () => { setEditingItem(group[0]); setLinkDialogOpen(true); } : undefined} onMove={() => setMoveItem(group[0])} onDelete={() => setDeleteTarget({ type: "item", item: group[0] })} />)}</div>)}</div>}
          </div>

          {uploadTasks.length > 0 && <div className="max-h-44 shrink-0 overflow-y-auto border-t border-border bg-card px-3 py-2">{uploadTasks.map((task) => <div key={task.id} className="flex items-center gap-3 py-1.5"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">{task.status === "done" ? <Check className="h-4 w-4 text-success" /> : task.status === "error" ? <AlertCircle className="h-4 w-4 text-destructive" /> : <UploadCloud className="h-4 w-4 text-info" />}</div><div className="min-w-0 flex-1"><div className="mb-1 flex items-center justify-between gap-2"><p className="truncate text-xs font-medium">{task.file.name}</p><span className="shrink-0 text-[10px] text-muted-foreground">{task.status === "saving" ? "Salvando..." : task.status === "done" ? "Concluído" : task.status === "error" ? "Falhou" : `${task.progress}%`}</span></div><Progress value={task.progress} className={cn("h-1", task.status === "error" && "opacity-40")} />{task.error && <p className="mt-1 truncate text-[10px] text-destructive">{task.error}</p>}</div>{task.status === "error" && <button type="button" onClick={() => retryUpload(task)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-accent" aria-label={`Tentar enviar ${task.file.name} novamente`}><RefreshCw className="h-4 w-4" /></button>}</div>)}</div>}

          <div className="shrink-0 border-t border-border bg-card p-2 safe-bottom-padding sm:p-3">
            <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-secondary p-1.5 shadow-sm focus-within:border-muted-foreground">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Anexar arquivos"><Paperclip className="h-5 w-5" /></button>
              <input ref={fileInputRef} type="file" multiple accept={FILE_ACCEPT} className="sr-only" onChange={(event) => { if (event.target.files) enqueueFiles(event.target.files); event.target.value = ""; }} />
              <textarea rows={1} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendComposer(); } }} placeholder="Escreva uma anotação ou cole um link..." className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground" />
              <button type="button" onClick={() => { setEditingItem(null); setLinkDialogOpen(true); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Salvar link"><Link2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => void sendComposer()} disabled={!composer.trim() || entityBusy} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-35" aria-label="Salvar conteúdo">{entityBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
            </div>
            <p className="mt-1.5 hidden truncate px-2 text-[10px] text-muted-foreground sm:block">Arquivos de até 50 MB · {ACCEPTED_FILE_LABEL}</p>
          </div>
        </> : <PanelPlaceholder text="Abra uma pasta para ver o conteúdo." />}
      </section>

      <StructureEditorDialog open={structureDialogOpen} onOpenChange={setStructureDialogOpen} structure={editingStructure} busy={entityBusy} onSave={(value) => void saveStructure(value)} />
      <FolderEditorDialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen} folder={editingFolder} parentName={folderParentId ? folders.find((folder) => folder.id === folderParentId)?.name : undefined} busy={entityBusy} onSave={(value) => void saveFolder(value)} />
      <TextEditorDialog open={textDialogOpen} onOpenChange={setTextDialogOpen} item={editingItem} busy={entityBusy} onSave={(value) => void saveText(value)} />
      <LinkEditorDialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen} item={editingItem} busy={entityBusy} onSave={(value) => void saveLink(value)} />
      <MoveDialog open={!!moveFolder} onOpenChange={(open) => !open && setMoveFolder(null)} title="Mover pasta" folders={folders} currentFolderId={moveFolder?.parent_id} allowRoot excludedIds={moveFolder ? getDescendantIds(folders, moveFolder.id) : undefined} busy={entityBusy} onSave={(id) => void executeMoveFolder(id)} />
      <MoveDialog open={!!moveItem} onOpenChange={(open) => !open && setMoveItem(null)} title="Mover conteúdo" folders={folders} currentFolderId={moveItem?.folder_id} allowRoot={false} busy={entityBusy} onSave={(id) => void executeMoveItem(id)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !entityBusy && setDeleteTarget(null)}><AlertDialogContent className="border-border bg-card"><AlertDialogHeader><AlertDialogTitle>Confirmar exclusão</AlertDialogTitle><AlertDialogDescription className="leading-6">{deleteDescription}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={entityBusy}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={entityBusy} onClick={(event) => { event.preventDefault(); void executeDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{entityBusy ? "Excluindo..." : "Excluir definitivamente"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <Dialog open={shareDialogOpen} onOpenChange={(open) => !shareBusy && setShareDialogOpen(open)}><DialogContent className="safe-dialog-content border-border bg-card sm:max-w-lg"><DialogHeader><DialogTitle>Compartilhar pasta</DialogTitle></DialogHeader>{shareBusy && !share ? <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : <div className="space-y-5"><div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-secondary/50 p-4"><div><p className="text-sm font-medium">Qualquer pessoa com o link</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Visitantes podem visualizar esta pasta e suas subpastas sem entrar na conta.</p></div><Switch checked={share?.active ?? false} disabled={shareBusy} onCheckedChange={(checked) => void manageShare(checked ? "enable" : "disable")} /></div>{share?.active && <><div><label className="mb-1.5 block text-sm font-medium">Link público</label><div className="flex gap-2"><input readOnly value={shareLink} className="form-control flex-1 text-xs" /><button type="button" onClick={() => void copyShareLink()} className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"><Copy className="h-4 w-4" />Copiar</button></div></div><div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4"><div><p className="text-sm font-medium">Permitir downloads</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Desativar remove os botões e bloqueia a rota de download. Conteúdos exibidos ainda podem ser capturados.</p></div><Switch checked={share.allow_download} disabled={shareBusy} onCheckedChange={(checked) => void manageShare("permissions", checked)} /></div><button type="button" onClick={() => setRotateShareConfirm(true)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-4 w-4" />Gerar novo link</button></>}<p className="text-xs leading-5 text-muted-foreground">O link dá acesso somente a esta pasta e às subpastas internas. Visitantes não podem alterar nenhum conteúdo.</p></div>}</DialogContent></Dialog>

      <AlertDialog open={rotateShareConfirm} onOpenChange={setRotateShareConfirm}><AlertDialogContent className="border-border bg-card"><AlertDialogHeader><AlertDialogTitle>Gerar um novo link?</AlertDialogTitle><AlertDialogDescription>O link atual deixará de funcionar imediatamente. Pessoas que já o receberam precisarão do novo endereço.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void manageShare("rotate")}>Gerar novo link</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      {viewerId && <FileViewer items={currentItems} currentId={viewerId} onChange={setViewerId} onClose={() => setViewerId(null)} resolveUrl={resolveOwnerFileUrl} />}
    </div>
  );
};

function StructureAvatar({ structure, imageUrl, small = false }: { structure: Structure; imageUrl?: string; small?: boolean }) {
  return <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full", small ? "h-10 w-10" : "h-12 w-12")} style={{ backgroundColor: `${structure.color}2b`, color: structure.color }}>{imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : <StructureIcon name={structure.icon} className={small ? "h-4 w-4" : "h-5 w-5"} />}</div>;
}

function FolderMenu({ folder, onEdit, onMove, onShare, onDelete }: { folder: StructureFolder; onEdit: () => void; onMove: () => void; onShare: () => void; onDelete: () => void }) {
  return <DropdownMenu><DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}><button type="button" aria-label={`Ações da pasta ${folder.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-100 hover:bg-secondary hover:text-foreground md:opacity-0 md:group-hover:opacity-100"><MoreVertical className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={onEdit}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem><DropdownMenuItem onSelect={onMove}><Move className="mr-2 h-4 w-4" />Mover</DropdownMenuItem><DropdownMenuItem onSelect={onShare}><Share2 className="mr-2 h-4 w-4" />Compartilhar</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function EmptyState({ icon, title, description, action, onAction }: { icon: React.ReactNode; title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center"><div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">{icon}</div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{description}</p>{action && onAction && <button type="button" onClick={onAction} className="mt-4 flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" />{action}</button>}</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex min-h-52 flex-col items-center justify-center px-5 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><p className="mt-3 text-sm font-medium">{message}</p><button type="button" onClick={onRetry} className="mt-4 flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 text-sm"><RefreshCw className="h-4 w-4" />Tentar novamente</button></div>;
}

function PanelPlaceholder({ text }: { text: string }) {
  return <div className="flex h-full min-h-72 items-center justify-center p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function ListSkeleton() {
  return <div className="space-y-2 p-1">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-3 p-2"><Skeleton className="h-11 w-11 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>;
}

function TimelineSkeleton() {
  return <div className="flex flex-col gap-3">{["w-2/3", "w-4/5", "w-1/2"].map((width, index) => <Skeleton key={index} className={cn("h-24 self-end rounded-2xl", width)} />)}</div>;
}

function sortFolders(a: StructureFolder, b: StructureFolder) {
  return a.position - b.position || a.created_at.localeCompare(b.created_at);
}

function groupMessages(items: StructureItem[]) {
  const groups: StructureItem[][] = [];
  for (const item of items) {
    const previous = groups.at(-1);
    if (item.kind === "file" && item.upload_group && previous?.[0]?.upload_group === item.upload_group) previous.push(item);
    else groups.push([item]);
  }
  return groups;
}

export default Estruturas;
