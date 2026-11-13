import { importReelFile, parseReelUrl } from "./reel-import";
import { LocalMediaPreviews } from "./LocalMediaPreviews";
import { MediaPreview } from "./MediaPreview";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Upload,
  Link2,
  RefreshCw,
  Eye,
  Plus,
  X,
  Copy,
  AlertTriangle,
  FolderPlus,
  Folder,
  ChevronDown,
  Check,
  Ban,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import {
  addMedia,
  loadFlowData,
  savePrefs,
  setMedia,
  createFlow,
  addFlowAccounts,
  cancelFlow,
  controlFlow,
  deleteFlow,
  previewMedia,
  deleteMedia,
  type Flow,
  type Media,
  type UploadItemState,
} from "./flows-api";
import type { Connection } from "./api";
import type { Post } from "./model";
import type { FlowInput } from "../../../supabase/functions/instagram-publisher/flow";
import {
  isValidTimeZone,
  parseSlots,
  slotInstants,
} from "../../../supabase/functions/instagram-publisher/schedule";
import { playConfirmation, unlockAudio } from "./sound";
import { FlowSharingDialog } from "./FlowSharingDialog";
import { LibrarySharingDialog } from "./LibrarySharingDialog";
import { DuplicateMediaDialog } from "./DuplicateMediaDialog";
import { SharedFlowProgress } from "./SharedFlowProgress";
import "./flows.css";

type UploadSource = { file: File; reelUrl?: never } | { file?: never; reelUrl: string };

type WorkspaceTab = "composer" | "campaigns";
type CampaignFilter = "all" | "active" | "paused" | "done";
type CaptionTool =
  | "none"
  | "saved"
  | "per-media"
  | "variations"
  | "folders"
  | "cover";

const selectField =
  "h-8 rounded-[8px] border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function Flows({
  accounts,
  connections,
  posts,
  onCreated,
}: {
  accounts: { id: string; username: string }[];
  connections: Connection[];
  posts: Post[];
  onCreated: () => Promise<unknown>;
}) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const key = ["ig-flows", user?.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => loadFlowData(user!.id),
    enabled: !!user,
    refetchInterval: 30000,
  });

  // Navegação de contexto principal (uma tarefa principal por tela)
  const [sharing, setSharing] = useState<{ id: string; name: string } | "join" | null>(null);
  const [librarySharing, setLibrarySharing] = useState(false);
  const [duplicateCleanup, setDuplicateCleanup] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceTab>("composer");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const [campaignSearch, setCampaignSearch] = useState("");

  // Inspetor individual de mídia (prévia + pasta + legenda individual sob demanda)
  const [inspector, setInspector] = useState<{
    mediaId: string;
    url: string;
    video: boolean;
    captionDraft: string;
  } | null>(null);
  const [mediaToDelete, setMediaToDelete] = useState<Media[]>([]);
  const [deleteProgress, setDeleteProgress] = useState(0);

  // Estado de upload e biblioteca
  const [uploadItems, setUploadItems] = useState<UploadItemState[]>([]);
  const [chosenFiles, setChosenFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [reelImportOpen, setReelImportOpen] = useState(false);
  const [reelUrl, setReelUrl] = useState("");
  const [reelError, setReelError] = useState("");
  const [kind, setKind] = useState<"posts" | "stories">("posts");
  const [selected, setSelected] = useState<string[]>([]);
  const [folder, setFolder] = useState("*");
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [syncFlowId, setSyncFlowId] = useState<string | null>(null);
  const [syncAccountIds, setSyncAccountIds] = useState<string[]>([]);

  // Estado do configurador de fluxo
  const [accountIds, setAccounts] = useState<string[]>([]);
  const [showAccountHistory, setShowAccountHistory] = useState(false);
  const [name, setName] = useState("");
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [start, setStart] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"gap" | "slots">("gap");
  const [gap, setGap] = useState(1);
  const [unit, setUnit] = useState(60);
  const [slotDraft, setSlotDraft] = useState("09:00\n12:30\n18:00\n21:00");
  const [slotTime, setSlotTime] = useState("");
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    }
  ).supportedValuesOf;
  const zones = useMemo(
    () =>
      supportedValuesOf
        ? [...new Set(["UTC", timeZone, ...supportedValuesOf("timeZone")])].sort()
        : [timeZone],
    [supportedValuesOf, timeZone],
  );

  const [distribution, setDistribution] = useState<"all" | "split">("all");
  const [random, setRandom] = useState(true);
  const [format, setFormat] = useState<FlowInput["format"]>("auto");
  const [repeat, setRepeat] = useState<"once" | "loop">("once");
  const [avoidReuse, setAvoidReuse] = useState(true);
  const [batchRest, setBatchRest] = useState(false);
  const [batchSize, setBatchSize] = useState(3);
  const [restMinutes, setRestMinutes] = useState(20);

  // Legendas e recursos opcionais (apenas 1 subpainel aberto por vez)
  const [caption, setCaption] = useState("");
  const [variations, setVariations] = useState("");
  const [folderDrafts, setFolderDrafts] = useState<Record<string, string>>({});
  const [coverId, setCoverId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<CaptionTool>("none");

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const submitting = useRef(false);
  const uploading = useRef(false);
  const pendingUploads = useRef<(UploadSource & {
    name: string;
    userId: string;
    kind: Media["kind"];
    folder: string;
    index: number;
  })[]>([]);
  const nextUploadIndex = useRef(0);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [flowId, setFlowId] = useState(() => crypto.randomUUID());

  const media = query.data?.media ?? [];
  const prefs = query.data?.prefs;
  const flows = query.data?.flows ?? [];
  const report = query.data?.report;
  const syncFlow = flows.find(flow => flow.id === syncFlowId);
  const syncCandidates = accounts.filter(account =>
    !syncFlow?.settings.accountIds.includes(account.id) &&
    connections.some(c => c.account_id === account.id && !c.paused && !c.reconnect_required));

  const visible = media.filter(
    (m) => m.kind === kind && (folder === "*" || m.folder === folder),
  );
  const selectedVisible = visible.filter(m => selected.includes(m.id));
  const destinationFolders = [...new Set([...(prefs?.folders ?? []), ...media.map(m => m.folder).filter(Boolean)])];
  const picked = media.filter(
    (m) => selected.includes(m.id) && m.kind === kind,
  );
  const available = accountIds.filter((id) =>
    connections.some(
      (c) => c.account_id === id && !c.paused && !c.reconnect_required,
    ),
  );
  const activeAccountsCount = accounts.filter((a) =>
    connections.some(
      (c) => c.account_id === a.id && !c.paused && !c.reconnect_required,
    ),
  ).length;

  const captionFolders = [
    ...new Set(["", ...(prefs?.folders ?? []), ...picked.map((m) => m.folder)]),
  ];
  const folderPools = Object.fromEntries(
    captionFolders.map((f) => [
      f,
      (folderDrafts[f] ?? (prefs?.folder_captions?.[f] ?? []).join("\n---\n"))
        .split("\n---\n")
        .map((v) => v.trim())
        .filter(Boolean),
    ]),
  );
  const total =
    distribution === "all" ? picked.length * available.length : picked.length;

  const inspectedMedia = inspector
    ? media.find((m) => m.id === inspector.mediaId) ?? null
    : null;

  // Métricas resumidas de campanhas para navegação inteligente
  const campaignStats = useMemo(() => {
    let active = 0;
    let paused = 0;
    let done = 0;
    let needsAttention = 0;
    let totalPending = 0;

    for (const flow of flows) {
      const state = flow.state || "active";
      if (state === "active") active += 1;
      else if (state === "paused") paused += 1;
      else done += 1;

      const summary = report?.flows.find((item) => item.id === flow.id);
      const jobs = posts.filter((p) => p.flow_id === flow.id);
      const pendingCount =
        summary?.pending ?? jobs.filter((p) => p.status === "scheduled").length;
      const reviewCount =
        summary?.review ??
        jobs.filter((p) => p.status === "failed" || p.status === "uncertain")
          .length;

      totalPending += pendingCount;
      if (flow.last_error || reviewCount > 0) needsAttention += 1;
    }

    return { active, paused, done, needsAttention, totalPending };
  }, [flows, posts, report]);

  const filteredFlows = useMemo(() => {
    const term = campaignSearch.trim().toLowerCase();
    return flows.filter((flow) => {
      const state = flow.state || "active";
      if (campaignFilter === "active" && state !== "active") return false;
      if (campaignFilter === "paused" && state !== "paused") return false;
      if (
        campaignFilter === "done" &&
        state !== "completed" &&
        state !== "stopped"
      )
        return false;
      if (term && !(flow.name || "campanha sem nome").toLowerCase().includes(term))
        return false;
      return true;
    });
  }, [flows, campaignFilter, campaignSearch]);

  async function perform(run: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await run();
      await cache.invalidateQueries({ queryKey: key });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível concluir.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
      setProgress("");
    }
  }

  function moveSelectedMedia(destination: string) {
    const targets = selectedVisible.map(m => m.id);
    if (!targets.length || busy || uploadInProgress) return;
    void perform(async () => {
      const moved: string[] = [];
      let failed = 0;
      for (let offset = 0; offset < targets.length; offset += 4) {
        const batch = targets.slice(offset, offset + 4);
        const results = await Promise.allSettled(batch.map(id => setMedia(id, { folder: destination })));
        results.forEach((result, index) => {
          if (result.status === "fulfilled") moved.push(batch[index]);
          else failed++;
        });
      }
      cache.setQueryData<Awaited<ReturnType<typeof loadFlowData>>>(key, previous => previous ? {
        ...previous, media: previous.media.map(m => moved.includes(m.id) ? { ...m, folder: destination } : m),
      } : previous);
      setSelected(previous => previous.filter(id => !moved.includes(id)));
      if (moved.length) toast.success(`${moved.length} mídia(s) movida(s) para ${destination || "Sem pasta"}.`);
      if (failed) toast.error(`${failed} mídia(s) não foram movidas. Elas continuam selecionadas para tentar novamente.`);
    });
  }

  function confirmDeleteMedia() {
    const targets = mediaToDelete;
    if (!user || !targets.length || uploadInProgress) return;
    void perform(async () => {
      setDeleteProgress(0);
      const deleted = new Set<string>();
      const failures: string[] = [];
      for (const [index, target] of targets.entries()) {
        try {
          await deleteMedia(target.id, target.url, user.id);
          deleted.add(target.id);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : "Não foi possível excluir esta mídia.");
        }
        setDeleteProgress(index + 1);
      }
      cache.setQueryData<Awaited<ReturnType<typeof loadFlowData>>>(key, previous => previous ? {
        ...previous, media: previous.media.filter(item => !deleted.has(item.id)),
      } : previous);
      setSelected(current => current.filter(id => !deleted.has(id)));
      if (inspector && deleted.has(inspector.mediaId)) setInspector(null);
      setMediaToDelete([]);
      if (deleted.size) toast.success(`${deleted.size} mídia(s) excluída(s).`);
      if (failures.length) toast.error(`${failures.length} mídia(s) não foram excluídas e permanecem na biblioteca. ${failures[0]}`);
    });
  }

  async function upload(files: File[], target: Media["kind"] = kind, sourceUrl?: string) {
    if (!user || (!files.length && !sourceUrl) || submitting.current) return;
    if (target === "cover" && (files.length !== 1 || !files[0].type.startsWith("image/"))) {
      toast.error("Escolha uma imagem JPG ou PNG para a capa.");
      return;
    }
    const sources: UploadSource[] = sourceUrl ? [{ reelUrl: sourceUrl }] : files.map(file => ({ file }));
    const jobs = sources.map(source => ({
      ...source,
      name: source.file?.name ?? `Reel ${parseReelUrl(source.reelUrl).shortcode}`,
      userId: user.id,
      kind: target,
      folder: folder === "*" ? "" : folder,
      index: nextUploadIndex.current++,
    }));
    pendingUploads.current.push(...jobs);
    if (files.length) setChosenFiles(previous => [...previous, ...files]);
    setUploadItems(previous => [...previous, ...jobs.map(job => ({
      index: job.index, name: job.name, status: "pending" as const, message: "Na fila",
    }))]);
    unlockAudio();
    // New selections append to the same queue while the current file is running.
    if (uploading.current) return;
    uploading.current = true;
    setUploadInProgress(true);
    let savedCount = 0;
    let errorCount = 0;
    try {
      while (pendingUploads.current.length) {
        const job = pendingUploads.current.shift()!;
        try {
          if (job.reelUrl) {
            setUploadItems(previous => previous.map(entry => entry.index === job.index
              ? { ...entry, status: "processing", message: "Baixando Reel do Instagram…" } : entry));
          }
          const file = job.file ?? await importReelFile(job.reelUrl!);
          const result = await addMedia(
            [file], job.userId, job.kind, job.folder, setProgress,
            {
              onItem: item => setUploadItems(previous => previous.map(entry =>
                entry.index === job.index ? { ...item, index: job.index } : entry,
              )),
              onSaved: saved => {
                if (saved.url.endsWith(".mp4")) playConfirmation("uploaded");
                cache.setQueryData<Awaited<ReturnType<typeof loadFlowData>>>(key, previous =>
                  previous ? { ...previous, media: [...previous.media.filter(m => m.id !== saved.id), saved] } : previous,
                );
                if (job.kind === "cover") setCoverId(saved.id);
              },
            },
          );
          savedCount += result.ids.length;
          errorCount += result.errors.length;
          if (job.kind !== "cover") setSelected(previous => [...new Set([...previous, ...result.ids])]);
        } catch (error) {
          errorCount++;
          const message = error instanceof Error ? error.message : "Não foi possível processar o arquivo.";
          setUploadItems(previous => previous.map(entry => entry.index === job.index
            ? { ...entry, status: "error", message } : entry));
        } finally {
          // Release previews as each file leaves the queue instead of holding the whole batch.
          if (job.file) setChosenFiles(previous => previous.slice(1));
        }
      }
      if (savedCount) toast.success(`${savedCount} mídia(s) pronta(s) para publicar.`);
      if (errorCount) toast.error(`${errorCount} arquivo(s) não foram enviados. Confira os detalhes na lista.`);
    } finally {
      // Do not await a refresh between draining the queue and releasing the runner:
      // a selection arriving in that gap would otherwise remain stuck in the queue.
      uploading.current = false;
      setUploadInProgress(false);
      setProgress("");
      void cache.invalidateQueries({ queryKey: key });
    }
  }

  function readSlots(draft: string) {
    return draft
      .split(/[\n,;]+/)
      .map((slot) => slot.trim())
      .filter(Boolean);
  }

  function normalizedSlots(draft: string) {
    return parseSlots(readSlots(draft)).map(
      (minutes) =>
        `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    );
  }

  const parsedSlotTags = readSlots(slotDraft);

  function addSlotChip(value: string) {
    const clean = value.trim();
    if (!clean) return;
    const next = [...new Set([...parsedSlotTags, clean])].sort();
    setSlotDraft(next.join("\n"));
    setSlotTime("");
  }

  function removeSlotChip(value: string) {
    const next = parsedSlotTags.filter((item) => item !== value);
    setSlotDraft(next.join("\n"));
  }

  function reuseFlow(flow: Flow) {
    const s = flow.settings;
    const targetKind = s.kind === "stories" ? "stories" : "posts";
    setKind(targetKind);
    setName(flow.name || "");
    setSelected(
      (s.mediaIds ?? []).filter((id) =>
        media.some((m) => m.id === id && m.kind === targetKind),
      ),
    );
    setAccounts(
      (s.accountIds ?? []).filter((id) => accounts.some((a) => a.id === id)),
    );
    setDistribution(s.distribution ?? "all");
    setRandom(s.random ?? true);
    setFormat(s.format ?? "auto");
    setCaption(s.caption ?? "");
    setVariations((s.variations ?? []).join("\n---\n"));

    if (s.schedule === "slots" && s.slots?.length) {
      setScheduleMode("slots");
      setSlotDraft(s.slots.join("\n"));
      if (s.timeZone) setTimeZone(s.timeZone);
    } else {
      setScheduleMode("gap");
      if (s.gapMinutes && s.gapMinutes >= 60 && s.gapMinutes % 60 === 0) {
        setUnit(60);
        setGap(s.gapMinutes / 60);
      } else {
        setUnit(1);
        setGap(s.gapMinutes || 60);
      }
    }

    setRepeat(s.repeat ?? "once");
    const hasRest = Boolean(
      s.restMinutes && s.restMinutes > 0 && s.batchSize && s.batchSize < 500,
    );
    setBatchRest(hasRest);
    if (hasRest) {
      setBatchSize(s.batchSize ?? 3);
      setRestMinutes(s.restMinutes ?? 20);
    }
    setAvoidReuse(s.avoidReuse ?? true);
    setCoverId(s.coverId ?? null);
    setWhen("now");
    setStart("");
    setActiveTool("none");
    setFlowId(crypto.randomUUID());
    setWorkspace("composer");
    toast.success("Configurações carregadas no editor.");
  }

  function submit() {
    unlockAudio();
    void perform(async () => {
      if (!picked.length || !available.length)
        throw new Error("Selecione ao menos uma conta ativa e uma mídia.");
      let slotList: string[] | null = null;
      if (scheduleMode === "slots") {
        try {
          slotList = normalizedSlots(slotDraft);
        } catch {
          throw new Error(
            "Informe de 1 a 24 horários HH:MM, sem repetir e com pelo menos 3 minutos entre eles.",
          );
        }
        if (!isValidTimeZone(timeZone))
          throw new Error("Escolha um fuso horário válido.");
      } else if (gap * unit < 3 || !Number.isFinite(gap * unit)) {
        throw new Error("O intervalo mínimo é de 3 minutos.");
      }
      if (when === "schedule" && (!start || Date.parse(start) <= Date.now()))
        throw new Error("Escolha uma data futura.");
      const input: FlowInput = {
        id: flowId,
        name,
        accountIds: available,
        mediaIds: picked.map((m) => m.id),
        gapMinutes: scheduleMode === "slots" ? 3 : gap * unit,
        random,
        distribution,
        format,
        kind,
        caption,
        variations: variations
          .split("\n---\n")
          .map((v) => v.trim())
          .filter(Boolean),
        startAt: when === "schedule" ? new Date(start).toISOString() : null,
        coverId,
        ...(slotList
          ? { schedule: "slots" as const, slots: slotList, timeZone }
          : {}),
        ...(report
          ? {
              repeat,
              batchSize: batchRest ? batchSize : 500,
              restMinutes: batchRest ? restMinutes : 0,
              avoidReuse,
              folderCaptions: folderPools,
            }
          : {}),
      };
      await createFlow(input);
      setFlowId(crypto.randomUUID());
      setSelected([]);
      setName("");
      playConfirmation("scheduled");
      toast.success(
        when === "schedule"
          ? "Fluxo agendado."
          : "Fluxo enviado à fila. A publicação começa no próximo ciclo.",
      );
      await onCreated();
    });
  }

  function nextSlotPreview() {
    if (scheduleMode !== "slots" || !picked.length) return [];
    try {
      const from =
        when === "schedule" && start ? Date.parse(start) : Date.now() + 60000;
      if (!Number.isFinite(from) || from <= Date.now()) return [];
      return slotInstants(
        Math.min(3, picked.length),
        from,
        parseSlots(readSlots(slotDraft)),
        timeZone,
        {
          batch: batchRest ? batchSize : 500,
          restMs: batchRest ? restMinutes * 60000 : 0,
        },
      ).map((ms) => new Date(ms).toLocaleString("pt-BR", { timeZone }));
    } catch {
      return [];
    }
  }
  const slotPreview = nextSlotPreview();

  function toggleCaptionTool(tool: Exclude<CaptionTool, "none">) {
    setActiveTool((current) => (current === tool ? "none" : tool));
  }

  function handleCancelFlow(flowIdToCancel: string) {
    void perform(async () => {
      cache.setQueryData<Awaited<ReturnType<typeof loadFlowData>>>(
        key,
        (previous) =>
          previous
            ? {
                ...previous,
                flows: previous.flows.map((f) =>
                  f.id === flowIdToCancel ? { ...f, state: "stopped" } : f,
                ),
                report: previous.report
                  ? {
                      ...previous.report,
                      flows: previous.report.flows.map((rf) =>
                        rf.id === flowIdToCancel ? { ...rf, pending: 0 } : rf,
                      ),
                    }
                  : null,
              }
            : previous,
      );
      await cancelFlow(flowIdToCancel);
      await onCreated();
      toast.success("Fluxo cancelado e envios pendentes interrompidos.");
    });
  }

  function handleDeleteFlow(flowIdToDelete: string) {
    void perform(async () => {
      cache.setQueryData<Awaited<ReturnType<typeof loadFlowData>>>(
        key,
        (previous) =>
          previous
            ? {
                ...previous,
                flows: previous.flows.filter((f) => f.id !== flowIdToDelete),
                report: previous.report
                  ? {
                      ...previous.report,
                      flows: previous.report.flows.filter(
                        (rf) => rf.id !== flowIdToDelete,
                      ),
                    }
                  : null,
              }
            : previous,
      );
      await deleteFlow(flowIdToDelete, user?.id);
      await onCreated();
      toast.success("Fluxo apagado com sucesso.");
    });
  }

  if (query.isLoading)
    return (
      <p role="status" className="py-8 text-center text-xs text-muted-foreground">
        Carregando seus Fluxos…
      </p>
    );

  if (query.isError)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-card p-4"
      >
        <p className="text-xs text-foreground">{query.error.message}</p>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );

  const customFolderEmpty =
    folder !== "*" &&
    folder !== "" &&
    !media.some((m) => m.folder === folder);

  return (
    <div className="ig-flows">
      {sharing && user && <FlowSharingDialog target={sharing === "join" ? null : sharing} userId={user.id}
        onClose={() => setSharing(null)} onChanged={() => {
          void query.refetch();
          void cache.invalidateQueries({ queryKey: ["ig-shared-flow-progress", user.id] });
        }} />}
      {user && <SharedFlowProgress userId={user.id} />}
      <Dialog open={!!syncFlowId} onOpenChange={open => { if (!open && !busy) setSyncFlowId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar conta ao fluxo</DialogTitle>
            <DialogDescription>As contas selecionadas entram agora na campanha e acompanham as próximas publicações nos horários do fluxo. As postagens já concluídas não serão repetidas.</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {syncCandidates.map(account => <label key={account.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
              <input type="checkbox" checked={syncAccountIds.includes(account.id)} disabled={busy} onChange={e => setSyncAccountIds(previous => e.target.checked ? [...previous, account.id] : previous.filter(id => id !== account.id))} />
              @{account.username}
            </label>)}
            {!syncCandidates.length && <p className="text-sm text-muted-foreground">Não há novas contas disponíveis. Conecte uma conta do Instagram para adicioná-la aqui.</p>}
          </div>
          <Button disabled={busy || !syncAccountIds.length || syncFlow?.state !== "active"} onClick={() => {
            if (!syncFlowId) return;
            void perform(async () => {
              await addFlowAccounts(syncFlowId, syncAccountIds);
              await onCreated();
              setSyncFlowId(null);
              setSyncAccountIds([]);
              toast.success("Contas sincronizadas com as próximas publicações do fluxo.");
            });
          }}>Sincronizar contas</Button>
        </DialogContent>
      </Dialog>
      {/* Modal de Inspeção Individual da Mídia (Prévia + Pasta + Legenda Individual) */}
      <Dialog
        open={!!inspector}
        onOpenChange={(open) => {
          if (!open) setInspector(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Detalhes da mídia
            </DialogTitle>
          </DialogHeader>
          {inspector && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-[10px] border border-border bg-background">
                {inspector.video ? (
                  <video
                    src={inspector.url}
                    controls
                    className="max-h-[52vh] w-full object-contain"
                  />
                ) : (
                  <img
                    src={inspector.url}
                    alt="Mídia selecionada para publicação"
                    className="max-h-[52vh] w-full object-contain"
                  />
                )}
              </div>

              {inspectedMedia && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label
                      htmlFor="inspector-folder"
                      className="text-xs text-muted-foreground"
                    >
                      Pasta
                    </Label>
                    <select
                      id="inspector-folder"
                      aria-label="Pasta desta mídia"
                      className={`${selectField} w-48`}
                      value={inspectedMedia.folder}
                      disabled={busy}
                      onChange={(e) => {
                        const targetFolder = e.target.value;
                        void perform(() =>
                          setMedia(inspectedMedia.id, { folder: targetFolder }),
                        );
                      }}
                    >
                      <option value="">Sem pasta</option>
                      {prefs?.folders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>

                  {inspectedMedia.kind === "posts" && (
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="inspector-caption"
                        className="text-xs text-muted-foreground"
                      >
                        Legenda individual (sobrepõe a legenda padrão)
                      </Label>
                      <Textarea
                        id="inspector-caption"
                        rows={2}
                        maxLength={2200}
                        className="text-xs"
                        placeholder="Opcional para esta mídia…"
                        value={inspector.captionDraft}
                        onChange={(e) =>
                          setInspector((prev) =>
                            prev
                              ? { ...prev, captionDraft: e.target.value }
                              : prev,
                          )
                        }
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            busy ||
                            inspector.captionDraft === inspectedMedia.caption
                          }
                          onClick={() =>
                            void perform(async () => {
                              await setMedia(inspectedMedia.id, {
                                caption: inspector.captionDraft,
                              });
                              toast.success("Legenda salva.");
                            })
                          }
                        >
                          Salvar legenda
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={mediaToDelete.length > 0}
        onOpenChange={(open) => {
          if (!open && !busy) setMediaToDelete([]);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              {mediaToDelete.length > 1 ? `Excluir ${mediaToDelete.length} mídias selecionadas?` : "Excluir mídia?"}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-xs text-muted-foreground">
            {mediaToDelete.length > 1 ? "Os arquivos selecionados serão removidos permanentemente." : "O arquivo será removido permanentemente."}
            {" "}Mídias usadas em fluxos, postagens ou rascunhos serão preservadas até
            que eles sejam concluídos ou cancelados. As demais serão excluídas.
          </DialogDescription>
          {busy && <p role="status" className="text-xs">Excluindo {deleteProgress} de {mediaToDelete.length} mídia(s)…</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setMediaToDelete([])}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy || uploadInProgress}
              onClick={confirmDeleteMedia}
            >
              {busy ? "Excluindo…" : mediaToDelete.length > 1 ? "Excluir mídias selecionadas" : "Excluir mídia"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* BARRA SUPERIOR DE CONTEXTO: Separa Criação vs. Monitoramento */}
      <div className="ig-flows-topbar">
        <div className="ig-segmented-tabs" aria-label="Área do Modo Fluxo">
          <button
            type="button"
            aria-pressed={workspace === "composer"}
            onClick={() => setWorkspace("composer")}
            className={`ig-tab-pill ${workspace === "composer" ? "is-active" : ""}`}
          >
            Novo fluxo
          </button>
          <button
            type="button"
            aria-pressed={workspace === "campaigns"}
            onClick={() => setWorkspace("campaigns")}
            className={`ig-tab-pill ${workspace === "campaigns" ? "is-active" : ""}`}
          >
            <span>Campanhas ({flows.length})</span>
            {campaignStats.needsAttention > 0 && (
              <span
                className="ig-attention-dot"
                title="Há campanhas que precisam de revisão"
              />
            )}
          </button>
        </div>

        <Button size="sm" variant="outline" onClick={() => setSharing("join")}>Participar com código</Button>

        {workspace === "composer" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void query.refetch()}
              aria-label="Atualizar biblioteca"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={14} />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="ig-segmented-tabs" aria-label="Filtro de campanhas">
              {(
                [
                  ["all", "Todas"],
                  ["active", `Ativas (${campaignStats.active})`],
                  ["paused", `Pausadas (${campaignStats.paused})`],
                  ["done", `Concluídas (${campaignStats.done})`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={campaignFilter === id}
                  onClick={() => setCampaignFilter(id)}
                  className={`ig-tab-pill ${campaignFilter === id ? "is-active" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                void query.refetch();
                void onCreated();
              }}
              aria-label="Atualizar fluxos"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={14} />
            </Button>
          </div>
        )}
      </div>

      {/* Aviso enxuto de atenção apenas quando alguma campanha pausou com erro */}
      {workspace === "composer" && campaignStats.needsAttention > 0 && (
        <div className="ig-attention-banner" role="status">
          <div className="flex items-center gap-2 text-xs text-foreground">
            <AlertTriangle size={14} className="shrink-0 text-warning" />
            <span>
              {campaignStats.needsAttention} campanha(s) com itens para revisão.
            </span>
          </div>
          <button
            type="button"
            className="text-xs font-medium text-foreground underline underline-offset-2"
            onClick={() => setWorkspace("campaigns")}
          >
            Ver campanhas
          </button>
        </div>
      )}

      {/* ====================================================================
          WORKSPACE 1: NOVO FLUXO (Biblioteca limpa + Configurador flat)
          ==================================================================== */}
      {workspace === "composer" && (
        <div className="ig-flows-workspace">
          {/* PAINEL ESQUERDO: BIBLIOTECA DE MÍDIAS */}
          <section
            className={`operation-panel ig-panel ig-library-panel ${dragOver ? "is-dragover" : ""}`}
            aria-labelledby="ig-library-heading"
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!busy && e.dataTransfer.files.length) {
                void upload(Array.from(e.dataTransfer.files));
              }
            }}
          >
            {/* Cabeçalho da biblioteca + botão direto de upload */}
            <div className="ig-panel-head">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 id="ig-library-heading">Biblioteca de mídias</h2>
                <Button size="sm" variant="outline" onClick={() => setLibrarySharing(true)}>Compartilhar por @</Button>
                <Button size="sm" variant="outline" disabled={busy || uploadInProgress} onClick={() => setDuplicateCleanup(true)}>Remover repetidos</Button>
                {duplicateCleanup && user && <DuplicateMediaDialog userId={user.id} onClose={() => setDuplicateCleanup(false)} onDeleted={(ids) => {
                  const deleted = new Set(ids);
                  cache.setQueryData<Awaited<ReturnType<typeof loadFlowData>>>(key, previous => previous ? { ...previous, media: previous.media.filter(item => !deleted.has(item.id)) } : previous);
                  setSelected(previous => previous.filter(id => !deleted.has(id)));
                  if (coverId && deleted.has(coverId)) setCoverId(null);
                  if (inspector && deleted.has(inspector.mediaId)) setInspector(null);
                  void cache.invalidateQueries({ queryKey: key });
                }} />}
                {librarySharing && user && <LibrarySharingDialog userId={user.id} onClose={() => setLibrarySharing(false)} onChanged={() => { void cache.invalidateQueries({ queryKey: key }); }} />}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {visible.length}
                </span>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    className="ig-folder-picker-btn"
                    aria-label="Selecionar pasta"
                    title="Selecionar pasta"
                  >
                    <Folder size={13} className="text-muted-foreground shrink-0" />
                    <span className="truncate max-w-[130px]">
                      {folder === "*"
                        ? "Todas as pastas"
                        : folder === ""
                          ? "Sem pasta"
                          : folder}
                    </span>
                    <ChevronDown size={12} className="opacity-60 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-52 border-white/10 bg-[#12131a] p-1.5 text-foreground shadow-xl"
                >
                  <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Filtrar por pasta
                  </div>
                  <DropdownMenuItem
                    onClick={() => setFolder("*")}
                    className={`flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-xs ${folder === "*" ? "bg-white/10 font-semibold text-white" : "text-muted-foreground hover:text-white"}`}
                  >
                    <div className="flex items-center gap-2">
                      <Folder size={13} />
                      <span>Todas as pastas</span>
                    </div>
                    {folder === "*" && <Check size={13} className="text-emerald-400" />}
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() => setFolder("")}
                    className={`flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-xs ${folder === "" ? "bg-white/10 font-semibold text-white" : "text-muted-foreground hover:text-white"}`}
                  >
                    <div className="flex items-center gap-2">
                      <Folder size={13} />
                      <span>Sem pasta</span>
                    </div>
                    {folder === "" && <Check size={13} className="text-emerald-400" />}
                  </DropdownMenuItem>

                  {prefs?.folders && prefs.folders.length > 0 && (
                    <DropdownMenuSeparator className="my-1 bg-white/10" />
                  )}

                  {prefs?.folders.map((f) => (
                    <DropdownMenuItem
                      key={f}
                      onClick={() => setFolder(f)}
                      className={`flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-xs ${folder === f ? "bg-white/10 font-semibold text-white" : "text-muted-foreground hover:text-white"}`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Folder size={13} />
                        <span className="truncate">{f}</span>
                      </div>
                      {folder === f && (
                        <Check size={13} className="shrink-0 text-emerald-400" />
                      )}
                    </DropdownMenuItem>
                  ))}

                  <DropdownMenuSeparator className="my-1 bg-white/10" />

                  <DropdownMenuItem
                    onClick={() => setAddingFolder(true)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-white"
                  >
                    <FolderPlus size={13} />
                    <span>Nova pasta…</span>
                  </DropdownMenuItem>

                  {customFolderEmpty && prefs && folder !== "*" && folder !== "" && (
                    <DropdownMenuItem
                      onClick={() =>
                        void perform(async () => {
                          await savePrefs({
                            ...prefs,
                            folders: prefs.folders.filter((item) => item !== folder),
                          });
                          setFolder("*");
                          toast.success(`Pasta "${folder}" excluída.`);
                        })
                      }
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <X size={13} />
                      <span>Excluir pasta atual</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Fila de upload (dispensável após concluir) */}
            {!!uploadItems.length && (
              <section aria-label="Fila de upload" className="ig-upload-queue">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {uploadItems.filter((item) => item.status === "done").length}/
                    {uploadItems.length} mídia(s) pronta(s) · {uploadItems.filter(item => item.status === "pending").length} na fila
                  </span>
                  {!uploadInProgress && (
                    <button
                      type="button"
                      onClick={() => setUploadItems([])}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <X size={12} /> Fechar
                    </button>
                  )}
                </div>
                <ol className="max-h-28 space-y-1 overflow-y-auto pt-1.5">
                  {uploadItems.map((item) => (
                    <li
                      key={item.index}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="truncate text-muted-foreground">
                        {item.name}
                      </span>
                      <span
                        className={
                          item.status === "error"
                            ? "shrink-0 text-destructive"
                            : "shrink-0 text-muted-foreground"
                        }
                      >
                        {item.message}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <p className="text-xs text-muted-foreground">Adicione um ou vários arquivos, inclusive durante o processamento. Mantenha esta tela aberta para acompanhar a fila.</p>
            <LocalMediaPreviews files={chosenFiles} />

            {/* Espaço das pastas agora ocupado pelo botão amplo de envio com opção de arrastar vídeos */}
            <label
              className={`ig-upload-dropzone ${dragOver ? "is-dragover" : ""} ${busy ? "is-disabled" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragOver) setDragOver(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOver(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOver(false);
                if (!busy && e.dataTransfer.files.length) {
                  void upload(Array.from(e.dataTransfer.files));
                }
              }}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,video/mp4"
                aria-label="Adicionar mídias à fila"
                multiple
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  void upload(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <div className="ig-upload-dropzone-inner">
                <div className="ig-upload-dropzone-icon">
                  <Upload size={18} />
                </div>
                <div className="ig-upload-dropzone-content">
                  <span className="ig-upload-dropzone-title">
                    {uploadInProgress
                      ? "Adicione mais arquivos à fila"
                      : dragOver
                        ? "Solte as mídias aqui para enviar"
                        : "Arraste arquivos ou clique para selecionar vários"}
                  </span>
                  <span className="ig-upload-dropzone-subtitle">
                    Fotos JPG/PNG e vídeos MP4 · limpeza em fila · até 100 MB por arquivo
                  </span>
                </div>
              </div>
            </label>

            <Button type="button" size="sm" variant="ghost" className="h-8 justify-start gap-2 text-xs text-muted-foreground" disabled={busy} onClick={() => { setReelError(""); setReelImportOpen(true); }}>
              <Link2 size={14} aria-hidden="true" /> Importar Reel por link
            </Button>
            <Dialog open={reelImportOpen} onOpenChange={setReelImportOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Importar Reel do Instagram</DialogTitle>
                  <DialogDescription>Cole o link de um Reel público. O vídeo entra na fila para baixar, limpar os metadados e salvar nesta biblioteca.</DialogDescription>
                </DialogHeader>
                <form className="space-y-3" onSubmit={event => {
                  event.preventDefault();
                  try {
                    const reel = parseReelUrl(reelUrl);
                    void upload([], kind, reel.url);
                    setReelImportOpen(false); setReelUrl(""); setReelError("");
                  } catch { setReelError("Cole um link válido de Reel do Instagram."); }
                }}>
                  <Label htmlFor="reel-import-url">Link do Reel</Label>
                  <Input id="reel-import-url" type="url" required maxLength={2048} placeholder="https://www.instagram.com/reel/…" value={reelUrl} onChange={event => { setReelUrl(event.target.value); setReelError(""); }} aria-describedby="reel-import-note" />
                  <p id="reel-import-note" className="text-xs text-muted-foreground">Até 100 MB. Reels privados, bloqueados ou indisponíveis não podem ser importados.</p>
                  {reelError && <p role="alert" className="text-sm text-destructive">{reelError}</p>}
                  <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setReelImportOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy || !reelUrl.trim()}>Adicionar à fila</Button></div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={addingFolder} onOpenChange={setAddingFolder}>
              <DialogContent className="max-w-xs border-white/10 bg-[#12131a] text-white">
                <DialogHeader>
                  <DialogTitle className="text-sm font-semibold">Nova pasta</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = newFolder.trim();
                    if (!prefs || !trimmed) {
                      setAddingFolder(false);
                      return;
                    }
                    void perform(async () => {
                      await savePrefs({
                        ...prefs,
                        folders: [...new Set([...prefs.folders, trimmed])],
                      });
                      setFolder(trimmed);
                      setNewFolder("");
                      setAddingFolder(false);
                      toast.success(`Pasta "${trimmed}" criada!`);
                    });
                  }}
                  className="space-y-3 pt-2"
                >
                  <Input
                    autoFocus
                    aria-label="Nome da nova pasta"
                    placeholder="Ex: Ofertas, Bastidores..."
                    value={newFolder}
                    maxLength={80}
                    onChange={(e) => setNewFolder(e.target.value)}
                    className="h-8 text-xs bg-white/5 border-white/10 text-white"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAddingFolder(false);
                        setNewFolder("");
                      }}
                      className="h-7 text-xs text-muted-foreground hover:text-white"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={busy || !newFolder.trim()}
                      className="h-7 text-xs"
                    >
                      Criar pasta
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            {visible.length > 0 && <div className="ig-media-selection" role="group" aria-label="Ações das mídias da pasta aberta">
              <label className="ig-media-select-all">
                <input
                  type="checkbox"
                  aria-label="Selecionar todas as mídias desta pasta"
                  checked={selectedVisible.length === visible.length}
                  ref={node => { if (node) node.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length; }}
                  disabled={busy || uploadInProgress}
                  onChange={e => setSelected(e.target.checked ? visible.map(m => m.id) : [])}
                />
                <span>Selecionar todas</span>
              </label>
              <span className="ig-media-selection-count" role="status">
                {selectedVisible.length ? `${selectedVisible.length} selecionada${selectedVisible.length === 1 ? "" : "s"}` : `${visible.length} mídia${visible.length === 1 ? "" : "s"}`}
              </span>
              {selectedVisible.length > 0 && <div className="ig-media-selection-actions">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="outline" disabled={busy || uploadInProgress} className="h-8 gap-1.5 text-xs">
                      <Folder size={13} aria-hidden="true" /> Mover para <ChevronDown size={12} aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => moveSelectedMedia("")}><Folder size={14} aria-hidden="true" />Sem pasta</DropdownMenuItem>
                    {destinationFolders.map(f => <DropdownMenuItem key={f} onSelect={() => moveSelectedMedia(f)}><Folder size={14} aria-hidden="true" />{f}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 text-xs" disabled={busy || uploadInProgress}
                  onClick={() => { setDeleteProgress(0); setMediaToDelete([...selectedVisible]); }}>
                  <Trash2 size={13} aria-hidden="true" /> Excluir selecionadas
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" disabled={busy || uploadInProgress} aria-label="Limpar seleção" title="Limpar seleção" onClick={() => setSelected([])}><X size={14} /></Button>
              </div>}
            </div>}
            <p className="text-[11px] text-muted-foreground">Novos envios: {folder === "*" || !folder ? "Sem pasta" : folder}.</p>

            {/* Grade minimalista de miniaturas (borda única, zero dropdown por item) */}
            {visible.length > 0 ? (
              <div className="ig-library-grid">
                {visible.map((m, i) => {
                  const isVideo = m.url.endsWith(".mp4");
                  const itemName = `${isVideo ? "Vídeo" : "Foto"} ${i + 1}`;
                  const isSelected = selected.includes(m.id);

                  return (
                    <article
                      key={m.id}
                      className={`ig-media-tile ${isSelected ? "is-selected" : ""}`}
                    >
                      <MediaPreview
                        url={m.url}
                        label={`Prévia de ${isVideo ? "vídeo" : "foto"} ${i + 1}`}
                        minimal
                      />

                      <div className="ig-media-badges">
                        {isVideo && <span className="ig-media-tag">MP4</span>}
                        {folder === "*" && m.folder && (
                          <span className="ig-media-tag is-folder">
                            {m.folder}
                          </span>
                        )}
                        {m.caption?.trim() && (
                          <span
                            className="ig-media-tag"
                            title="Possui legenda individual"
                          >
                            TXT
                          </span>
                        )}
                      </div>

                      <label className="ig-media-tile-hit">
                        <span className="ig-media-tile-bar">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={busy}
                            onChange={(e) =>
                              setSelected((prev) =>
                                e.target.checked
                                  ? [...prev, m.id]
                                  : prev.filter((id) => id !== m.id),
                              )
                            }
                          />
                          <span>{itemName}</span>
                        </span>
                      </label>

                      <button
                        type="button"
                        className="ig-thumb-inspect-btn"
                        disabled={busy}
                        title="Detalhes, pasta e legenda"
                        aria-label={`Visualizar ${isVideo ? "vídeo" : "foto"} ${i + 1}`}
                        onClick={() =>
                          void perform(async () => {
                            const url = m.url.startsWith("storage://")
                              ? await previewMedia(m.url)
                              : m.url;
                            setInspector({
                              mediaId: m.id,
                              url,
                              video: isVideo,
                              captionDraft: m.caption ?? "",
                            });
                          })
                        }
                      >
                        <Eye size={12} />
                      </button>

                      <button
                        type="button"
                        className="ig-thumb-delete-btn"
                        disabled={busy}
                        title="Excluir mídia"
                        aria-label={`Excluir ${isVideo ? "vídeo" : "foto"} ${i + 1}`}
                        onClick={() => { setDeleteProgress(0); setMediaToDelete([m]); }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <label className="ig-empty-dropzone">
                <Upload size={18} className="text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">
                  Nenhuma mídia nesta pasta
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Arraste arquivos JPG, PNG ou MP4 aqui ou clique para enviar
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,video/mp4"
                  aria-label="Adicionar mídias à pasta vazia"
                  multiple
                  disabled={busy}
                  className="sr-only"
                  onChange={(e) => {
                    void upload(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </section>

          {/* PAINEL DIREITO: CONFIGURADOR FLAT (Sem caixas aninhadas) */}
          <section
            className="operation-panel ig-panel ig-flow-composer"
            aria-labelledby="ig-new-flow-heading"
          >
            {/* Cabeçalho do configurador */}
            <div className="ig-panel-head pb-3">
              <div>
                <h2 id="ig-new-flow-heading">
                  {kind === "stories"
                    ? "Story em várias contas"
                    : "Configurar fluxo"}
                </h2>
                {kind === "stories" && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Formato vertical 9:16 · enviado diretamente como Story.
                  </p>
                )}
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {picked.length} mídia(s) · {available.length} conta(s)
              </span>
            </div>

            {/* SEÇÃO 1: Nome & Contas */}
            <div className="ig-composer-section space-y-3">
              <div>
                <Label htmlFor="flow-name" className="sr-only">
                  Nome do fluxo (opcional)
                </Label>
                <Input
                  id="flow-name"
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome do fluxo (opcional)"
                  className="h-9 text-xs"
                />
              </div>

              <fieldset className="space-y-2 border-0 p-0 m-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <legend className="ig-section-label">
                    Contas ({available.length}/{activeAccountsCount})
                  </legend>

                  <div className="flex flex-wrap items-center gap-2">
                    {accountIds.length > 0 && report && (
                      <button
                        type="button"
                        onClick={() => setShowAccountHistory((v) => !v)}
                        className="ig-ghost-action"
                      >
                        {showAccountHistory ? "Ocultar histórico" : "Ineditismo"}
                      </button>
                    )}
                    {accounts.length > 0 && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          className="ig-ghost-action"
                          onClick={() => {
                            const valid = accounts
                              .filter((a) => {
                                const c = connections.find(
                                  (conn) => conn.account_id === a.id,
                                );
                                return c && !c.paused && !c.reconnect_required;
                              })
                              .map((a) => a.id);
                            setAccounts(valid);
                          }}
                        >
                          Todas ativas
                        </button>
                        {accountIds.length > 0 && (
                          <button
                            type="button"
                            disabled={busy}
                            className="ig-ghost-action"
                            onClick={() => setAccounts([])}
                          >
                            Limpar
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {accounts.length > 0 ? (
                  <div className="ig-flow-options">
                    {accounts.map((a) => {
                      const c = connections.find((conn) => conn.account_id === a.id);
                      const disabled = !c || c.paused || c.reconnect_required;
                      const checked = accountIds.includes(a.id);
                      return (
                        <label
                          key={a.id}
                          className={checked ? "is-checked" : undefined}
                        >
                          <input
                            type="checkbox"
                            disabled={busy || disabled}
                            checked={checked}
                            onChange={(e) =>
                              setAccounts((prev) =>
                                e.target.checked
                                  ? [...prev, a.id]
                                  : prev.filter((id) => id !== a.id),
                              )
                            }
                          />
                          <span>
                            @{a.username.replace(/^@/, "")}
                            {disabled ? " · pausada" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Conecte um perfil na aba Contas para habilitar envios.
                  </p>
                )}

                {showAccountHistory && accountIds.length > 0 && report && (
                  <div className="ig-table-scroll">
                    <table className="ig-table">
                      <thead>
                        <tr>
                          <th>Conta</th>
                          <th>Publicadas</th>
                          <th>Na fila</th>
                          <th>Inéditas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accounts
                          .filter((a) => accountIds.includes(a.id))
                          .map((a) => {
                            const usage = report.usage.filter(
                              (u) =>
                                u.account_id === a.id &&
                                picked.some((m) => m.id === u.media_id),
                            );
                            return (
                              <tr key={a.id}>
                                <td>@{a.username.replace(/^@/, "")}</td>
                                <td>
                                  {usage.filter((u) => u.published > 0).length}
                                </td>
                                <td>
                                  {usage.filter((u) => u.pending > 0).length}
                                </td>
                                <td>
                                  {picked.length -
                                    usage.filter(
                                      (u) => u.published > 0 || u.pending > 0,
                                    ).length}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </fieldset>
            </div>

            {/* SEÇÃO 2: Programação (Cadência) */}
            <div className="ig-composer-section space-y-3">
              <fieldset className="border-0 p-0 m-0">
                <legend className="ig-section-label mb-1.5">Cadência</legend>
                <div className="ig-segmented-full">
                  <button
                    type="button"
                    aria-pressed={scheduleMode === "gap"}
                    onClick={() => setScheduleMode("gap")}
                  >
                    Intervalo (GAP)
                  </button>
                  <button
                    type="button"
                    aria-pressed={scheduleMode === "slots"}
                    onClick={() => setScheduleMode("slots")}
                  >
                    Horários fixos
                  </button>
                </div>
              </fieldset>

              {scheduleMode === "gap" ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label
                      htmlFor="flow-gap"
                      className="text-xs text-muted-foreground"
                    >
                      Intervalo entre envios
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id="flow-gap"
                        type="number"
                        min={unit === 60 ? 0.05 : 3}
                        step="any"
                        value={gap}
                        onChange={(e) => setGap(Number(e.target.value))}
                        className="h-8 w-20 text-xs tabular-nums"
                      />
                      <select
                        className={selectField}
                        aria-label="Unidade do intervalo"
                        value={unit}
                        onChange={(e) => setUnit(Number(e.target.value))}
                      >
                        <option value={60}>horas</option>
                        <option value={1}>minutos</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        ["15m", 15, 1],
                        ["30m", 30, 1],
                        ["1h", 1, 60],
                        ["2h", 2, 60],
                        ["4h", 4, 60],
                        ["6h", 6, 60],
                        ["12h", 12, 60],
                      ] as const
                    ).map(([label, g, u]) => {
                      const active = gap === g && unit === u;
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={active}
                          className={`ig-preset-pill ${active ? "is-active" : ""}`}
                          onClick={() => {
                            setGap(g);
                            setUnit(u);
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Horários do dia ({parsedSlotTags.length})
                    </span>
                  </div>

                  <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {parsedSlotTags.map((slot) => (
                          <span key={slot} className="ig-slot-chip">
                            <span>{slot}</span>
                            <button
                              type="button"
                              aria-label={`Remover horário ${slot}`}
                              onClick={() => removeSlotChip(slot)}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}

                        <div className="inline-flex items-center gap-1">
                          <Input
                            type="time"
                            aria-label="Novo horário"
                            value={slotTime}
                            onChange={(e) => setSlotTime(e.target.value)}
                            className="h-7 w-28 px-2 text-xs"
                          />
                          <button
                            type="button"
                            disabled={!slotTime}
                            onClick={() => addSlotChip(slotTime)}
                            className="ig-preset-pill h-7 inline-flex items-center gap-1"
                          >
                            <Plus size={11} /> Adicionar
                          </button>
                        </div>
                      </div>
                    </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor="flow-zone"
                        className="text-[11px] text-muted-foreground"
                      >
                        Fuso
                      </Label>
                      <select
                        id="flow-zone"
                        className={`${selectField} max-w-[190px] h-7 text-[11px]`}
                        value={timeZone}
                        onChange={(e) => setTimeZone(e.target.value)}
                      >
                        {zones.map((zone) => (
                          <option key={zone} value={zone}>
                            {zone}
                          </option>
                        ))}
                      </select>
                    </div>

                    <span
                      aria-live="polite"
                      className="text-[11px] tabular-nums text-muted-foreground"
                    >
                      {slotPreview.length
                        ? `Próximo: ${slotPreview[0]}`
                        : "Selecione mídias para prévia"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* SEÇÃO 3: Distribuição, Ordem & Regras de Automação */}
            <div className="ig-composer-section space-y-3">
              <div className="space-y-2.5">
                <fieldset className="border-0 p-0 m-0">
                  <legend className="ig-section-label mb-1.5">Distribuição</legend>
                  <div className="ig-segmented-full">
                    <button
                      type="button"
                      aria-pressed={distribution === "all"}
                      onClick={() => setDistribution("all")}
                    >
                      Todas as contas postam tudo
                    </button>
                    <button
                      type="button"
                      aria-pressed={distribution === "split"}
                      onClick={() => setDistribution("split")}
                    >
                      Dividir entre as contas
                    </button>
                  </div>
                </fieldset>

                <fieldset className="border-0 p-0 m-0">
                  <legend className="ig-section-label mb-1.5">Ordem</legend>
                  <div className="ig-segmented-full">
                    <button
                      type="button"
                      aria-pressed={random}
                      onClick={() => setRandom(true)}
                    >
                      Randomizar por conta
                    </button>
                    <button
                      type="button"
                      aria-pressed={!random}
                      onClick={() => setRandom(false)}
                    >
                      Manter ordem
                    </button>
                  </div>
                </fieldset>

                {kind === "posts" && (
                  <fieldset className="border-0 p-0 m-0">
                    <legend className="ig-section-label mb-1.5">Formato</legend>
                    <div className="ig-segmented-full">
                      {(["auto", "Reel", "Feed"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={format === f}
                          onClick={() => setFormat(f)}
                        >
                          {f === "auto"
                            ? "Automático"
                            : f === "Feed"
                              ? "Post"
                              : f}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>

              {!report && (
                <p role="status" className="text-[11px] text-muted-foreground">
                  Loop e histórico avançado indisponíveis no momento; fluxos simples operam normalmente.
                </p>
              )}

              <fieldset
                disabled={busy || !report}
                className="ig-check-list border-0 p-0 m-0"
              >
                <legend className="sr-only">Automação e proteção</legend>

                <label className="ig-check-row">
                  <input
                    type="checkbox"
                    checked={repeat === "loop"}
                    disabled={busy}
                    onChange={(e) =>
                      setRepeat(e.target.checked ? "loop" : "once")
                    }
                  />
                  <span>Repetir campanha em loop</span>
                </label>

                <label className="ig-check-row">
                  <input
                    type="checkbox"
                    checked={avoidReuse}
                    disabled={busy}
                    onChange={(e) => setAvoidReuse(e.target.checked)}
                  />
                  <span>
                    Evitar mídias já usadas ou reservadas na mesma conta
                  </span>
                </label>

                <label className="ig-check-row">
                  <input
                    type="checkbox"
                    checked={batchRest}
                    disabled={busy}
                    onChange={(e) => setBatchRest(e.target.checked)}
                  />
                  <span>Descansar entre lotes</span>
                </label>

                {batchRest && (
                  <div className="ig-flow-grid pt-1.5 pl-6">
                    <div>
                      <Label
                        htmlFor="flow-batch-size"
                        className="text-[11px] text-muted-foreground"
                      >
                        Publicações por lote, por conta
                      </Label>
                      <Input
                        id="flow-batch-size"
                        type="number"
                        min={1}
                        max={500}
                        value={batchSize}
                        onChange={(e) => setBatchSize(Number(e.target.value))}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label
                        htmlFor="flow-rest"
                        className="text-[11px] text-muted-foreground"
                      >
                        Descanso extra entre lotes (minutos)
                      </Label>
                      <Input
                        id="flow-rest"
                        type="number"
                        min={0}
                        max={10080}
                        value={restMinutes}
                        onChange={(e) => setRestMinutes(Number(e.target.value))}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>
                )}
              </fieldset>
            </div>

            {/* SEÇÃO 4: Legendas & Recursos Opcionais (Divulgação Progressiva Unificada) */}
            {kind === "posts" && (
              <div className="ig-composer-section space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="flow-caption" className="ig-section-label">
                    Legenda automática
                  </Label>
                  <div className="flex items-center gap-2">
                    {caption.trim() && prefs && (
                      <button
                        type="button"
                        disabled={busy}
                        className="ig-ghost-action"
                        onClick={() =>
                          void perform(async () => {
                            await savePrefs({
                              ...prefs,
                              captions: [
                                ...new Set([...prefs.captions, caption]),
                              ],
                            });
                            toast.success("Legenda salva nos modelos.");
                          })
                        }
                      >
                        Salvar modelo
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!caption.trim()}
                      className="ig-ghost-action"
                      onClick={() => {
                        setVariations(
                          [
                            caption,
                            caption.split(/\n+/).reverse().join("\n"),
                            caption.replace(/([.!?])\s+/g, "$1\n\n"),
                          ]
                            .filter((v, i, a) => a.indexOf(v) === i)
                            .join("\n---\n"),
                        );
                        setActiveTool("variations");
                      }}
                    >
                      Gerar variações
                    </button>
                  </div>
                </div>

                <Textarea
                  id="flow-caption"
                  rows={2}
                  maxLength={2200}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Aplicada às mídias sem legenda individual…"
                  className="text-xs"
                />

                {/* Barra de ferramentas secundárias — apenas 1 aberta por vez */}
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    aria-expanded={activeTool === "saved"}
                    onClick={() => toggleCaptionTool("saved")}
                    className={`ig-preset-pill ${activeTool === "saved" ? "is-active" : ""}`}
                  >
                    Legendas salvas
                    {prefs?.captions.length ? ` (${prefs.captions.length})` : ""}
                  </button>

                  <button
                    type="button"
                    aria-expanded={activeTool === "per-media"}
                    onClick={() => toggleCaptionTool("per-media")}
                    className={`ig-preset-pill ${activeTool === "per-media" ? "is-active" : ""}`}
                  >
                    Por mídia ({picked.length})
                  </button>

                  <button
                    type="button"
                    aria-expanded={activeTool === "variations"}
                    onClick={() => toggleCaptionTool("variations")}
                    className={`ig-preset-pill ${activeTool === "variations" || variations.trim() ? "is-active" : ""}`}
                  >
                    Variações
                  </button>

                  {report && (
                    <button
                      type="button"
                      aria-expanded={activeTool === "folders"}
                      onClick={() => toggleCaptionTool("folders")}
                      className={`ig-preset-pill ${activeTool === "folders" ? "is-active" : ""}`}
                    >
                      Legendas sorteadas por pasta
                    </button>
                  )}

                  <button
                    type="button"
                    aria-expanded={activeTool === "cover"}
                    onClick={() => toggleCaptionTool("cover")}
                    className={`ig-preset-pill ${activeTool === "cover" || coverId ? "is-active" : ""}`}
                  >
                    Capa do Reel{coverId ? " · ativa" : ""}
                  </button>
                </div>

                {/* Painel sob demanda: Legendas salvas */}
                {activeTool === "saved" && (
                  <div className="ig-tool-drawer space-y-1.5">
                    {prefs?.captions.length ? (
                      prefs.captions.map((text, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-secondary/60"
                        >
                          <button
                            type="button"
                            className="flex-1 truncate text-left text-xs text-foreground"
                            onClick={() => {
                              setCaption(text);
                              setActiveTool("none");
                            }}
                          >
                            {text}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="text-[11px] text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              prefs &&
                              void perform(() =>
                                savePrefs({
                                  ...prefs,
                                  captions: prefs.captions.filter(
                                    (_, n) => n !== i,
                                  ),
                                }),
                              )
                            }
                          >
                            Excluir
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Nenhuma legenda salva ainda. Digite acima e clique em “Salvar modelo”.
                      </p>
                    )}
                  </div>
                )}

                {/* Painel sob demanda: Legenda por mídia */}
                {activeTool === "per-media" && (
                  <div className="ig-tool-drawer max-h-56 space-y-2.5 overflow-y-auto">
                    {picked.length ? (
                      picked.map((m, i) => (
                        <MediaCaption
                          key={m.id}
                          media={m}
                          index={i}
                          busy={busy}
                          save={(text) =>
                            perform(() => setMedia(m.id, { caption: text }))
                          }
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Selecione mídias na biblioteca ao lado para definir legendas individuais.
                      </p>
                    )}
                  </div>
                )}

                {/* Painel sob demanda: Variações */}
                {activeTool === "variations" && (
                  <div className="ig-tool-drawer space-y-1.5">
                    <Label
                      htmlFor="flow-variations"
                      className="text-[11px] text-muted-foreground"
                    >
                      Separe cada variação com uma linha contendo ---
                    </Label>
                    <Textarea
                      id="flow-variations"
                      rows={3}
                      value={variations}
                      onChange={(e) => setVariations(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                )}

                {/* Painel sob demanda: Legendas sorteadas por pasta */}
                {activeTool === "folders" && report && (
                  <div className="ig-tool-drawer space-y-2.5">
                    <p className="text-[11px] text-muted-foreground">
                      Separe opções com ---. Cada envio sorteia uma legenda da pasta da mídia.
                    </p>
                    <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                      {captionFolders.map((f) => (
                        <div key={f}>
                          <Label
                            htmlFor={`folder-caption-${encodeURIComponent(f)}`}
                            className="text-xs"
                          >
                            {f || "Sem pasta"}
                          </Label>
                          <Textarea
                            id={`folder-caption-${encodeURIComponent(f)}`}
                            rows={2}
                            className="mt-1 text-xs"
                            value={
                              folderDrafts[f] ??
                              (prefs?.folder_captions?.[f] ?? []).join(
                                "\n---\n",
                              )
                            }
                            onChange={(e) =>
                              setFolderDrafts((previous) => ({
                                ...previous,
                                [f]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !prefs}
                      onClick={() =>
                        void perform(async () => {
                          await savePrefs({
                            ...prefs!,
                            folder_captions: folderPools,
                          });
                          toast.success("Legendas das pastas salvas.");
                        })
                      }
                    >
                      Salvar legendas das pastas
                    </Button>
                  </div>
                )}

                {/* Painel sob demanda: Capa do Reel */}
                {activeTool === "cover" && (
                  <div className="ig-tool-drawer space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label
                        htmlFor="flow-cover"
                        className="text-xs text-muted-foreground"
                      >
                        Capa selecionada
                      </Label>
                      <label className="ig-ghost-action cursor-pointer">
                        + Enviar JPG/PNG
                        <input
                          id="flow-cover"
                          type="file"
                          accept="image/jpeg,image/png"
                          disabled={busy || uploadInProgress}
                          className="sr-only"
                          onChange={(e) => {
                            void upload(
                              Array.from(e.target.files ?? []),
                              "cover",
                            );
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <select
                      aria-label="Capa selecionada"
                      className={`${selectField} w-full`}
                      value={coverId ?? ""}
                      onChange={(e) => setCoverId(e.target.value || null)}
                    >
                      <option value="">Sem capa personalizada</option>
                      {media
                        .filter((m) => m.kind === "cover")
                        .map((m, i) => (
                          <option key={m.id} value={m.id}>
                            Capa {i + 1}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* SEÇÃO: Quando publicar (última opção antes do resumo) */}
            <div className="ig-composer-section space-y-3">
              <fieldset className="border-0 p-0 m-0">
                <legend className="ig-section-label mb-1.5">Quando publicar</legend>
                <div className="ig-segmented-full">
                  <button
                    type="button"
                    aria-pressed={when === "now"}
                    onClick={() => setWhen("now")}
                  >
                    Publicar agora
                  </button>
                  <button
                    type="button"
                    aria-pressed={when === "schedule"}
                    onClick={() => setWhen("schedule")}
                  >
                    Agendar
                  </button>
                </div>
              </fieldset>

              {when === "schedule" && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="flow-start" className="text-xs text-muted-foreground">
                    Início do fluxo
                  </Label>
                  <Input
                    id="flow-start"
                    type="datetime-local"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="h-8 w-auto text-xs"
                  />
                </div>
              )}
            </div>

            {/* SEÇÃO 5: Resumo Enxuto + Ação Principal Única */}
            <div className="ig-composer-section space-y-2.5 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-foreground tabular-nums">
                  {available.length} conta(s) · {picked.length} mídia(s) →{" "}
                  {total} publicação(ões)
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {scheduleMode === "slots"
                    ? `${parsedSlotTags.length} horário(s)/dia`
                    : `GAP ${gap}${unit === 60 ? "h" : "min"}`}
                </span>
              </div>

              <Button
                className="w-full"
                disabled={
                  busy ||
                  !picked.length ||
                  !available.length ||
                  total > 500 ||
                  (scheduleMode === "gap"
                    ? gap * unit < 3 || !Number.isFinite(gap * unit)
                    : slotPreview.length === 0) ||
                  (batchRest &&
                    (!Number.isInteger(batchSize) ||
                      batchSize < 1 ||
                      batchSize > 500 ||
                      !Number.isFinite(restMinutes) ||
                      restMinutes < 0 ||
                      restMinutes > 10080))
                }
                onClick={submit}
              >
                {busy
                  ? "Processando…"
                  : kind === "stories"
                    ? "Criar fluxo de Stories"
                    : when === "schedule"
                      ? "Criar e agendar fluxo"
                      : "Criar fluxo e iniciar"}
              </Button>

              {total > 500 && (
                <p role="alert" className="text-xs text-destructive">
                  Divida o lote em fluxos com até 500 publicações.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* LISTA DIRETA DE FLUXOS NO MODO COMPOSER (Cancelar / Apagar sem precisar trocar de aba) */}
      {workspace === "composer" && flows.length > 0 && (
        <section
          className="operation-panel ig-panel space-y-3"
          aria-label="Fluxos criados"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Fluxos criados ({flows.length})
              </h2>
              <span className="text-xs text-muted-foreground">
                · {campaignStats.totalPending} envio(s) na fila
              </span>
            </div>
            <button
              type="button"
              onClick={() => setWorkspace("campaigns")}
              className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Ver painel completo de campanhas
            </button>
          </div>

          <div className="divide-y divide-border border-t border-border">
            {flows.map((flow) => {
              const summary = report?.flows.find((item) => item.id === flow.id);
              const jobs = posts.filter((p) => p.flow_id === flow.id);
              const done =
                summary?.published ??
                jobs.filter((p) => p.status === "published").length;
              const pending =
                summary?.pending ??
                jobs.filter((p) => p.status === "scheduled").length;
              const state = flow.state || "active";
              const stateLabel = {
                active: "Ativa",
                paused: "Pausada",
                stopped: "Cancelada",
                completed: "Concluída",
              }[state];
              const canCancel =
                pending > 0 || state === "active" || state === "paused";

              return (
                <div
                  key={flow.id}
                  className="ig-campaign-row"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`ig-state-dot is-${state}`}
                        aria-hidden="true"
                      />
                      <span className="truncate text-sm font-medium text-foreground">
                        {flow.name || "Campanha sem nome"}
                      </span>
                      <span className="chip">{stateLabel}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {done} publicado(s) · {pending} na fila
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {state === "active" && (
                      <Button size="sm" variant="outline" disabled={busy} className="h-8 text-xs"
                        onClick={() => setSharing({ id: flow.id, name: flow.name || "Campanha sem nome" })}>
                        <Link2 size={13} className="mr-1.5" />
                        Compartilhar fluxo
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        className="h-8 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-300"
                        onClick={() => handleCancelFlow(flow.id)}
                      >
                        <Ban size={13} className="mr-1.5" />
                        Cancelar fluxo
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDeleteFlow(flow.id)}
                    >
                      <Trash2 size={13} className="mr-1.5" />
                      Apagar fluxo
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ====================================================================
          WORKSPACE 2: CAMPANHAS (Gestão linear, limpa e orientada a ações)
          ==================================================================== */}
      {workspace === "campaigns" && (
        <section
          id="agonia-flows-active-anchor"
          className="operation-panel ig-panel space-y-4"
          aria-label="Campanhas criadas"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <strong className="font-semibold text-foreground">
                {flows.length} campanha(s)
              </strong>
              <span>·</span>
              <span className="tabular-nums">
                {campaignStats.totalPending} envio(s) na fila
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {flows.length > 2 && (
                <Input
                  aria-label="Buscar campanha"
                  placeholder="Filtrar por nome…"
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                  className="h-8 w-48 text-xs"
                />
              )}
              {(campaignStats.active > 0 ||
                campaignStats.paused > 0 ||
                campaignStats.totalPending > 0) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="h-8 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  onClick={() =>
                    void perform(async () => {
                      const activeTargets = flows.filter(
                        (f) =>
                          !f.state ||
                          f.state === "active" ||
                          f.state === "paused",
                      );
                      await Promise.all(
                        activeTargets.map((f) =>
                          cancelFlow(f.id).catch(() => null),
                        ),
                      );
                      await onCreated();
                      toast.success("Todos os fluxos ativos foram cancelados.");
                    })
                  }
                >
                  <Ban size={13} className="mr-1.5" />
                  Cancelar todos ativos
                </Button>
              )}
              {campaignStats.done > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    void perform(async () => {
                      const doneTargets = flows.filter(
                        (f) =>
                          f.state === "stopped" || f.state === "completed",
                      );
                      for (const f of doneTargets) {
                        await deleteFlow(f.id, user?.id);
                      }
                      await onCreated();
                      toast.success("Fluxos encerrados apagados.");
                    })
                  }
                >
                  <Trash2 size={13} className="mr-1.5" />
                  Apagar encerrados
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setWorkspace("composer")}
              >
                <Plus size={13} className="mr-1" /> Novo fluxo
              </Button>
            </div>
          </div>

          {filteredFlows.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-xs text-muted-foreground">
                {flows.length === 0
                  ? "Nenhum fluxo criado ainda."
                  : "Nenhuma campanha corresponde ao filtro selecionado."}
              </p>
              {flows.length === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setWorkspace("composer")}
                >
                  Criar primeiro fluxo
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {filteredFlows.map((flow) => {
                const summary = report?.flows.find((item) => item.id === flow.id);
                const jobs = posts.filter((p) => p.flow_id === flow.id);
                const done =
                  summary?.published ??
                  jobs.filter((p) => p.status === "published").length;
                const pending =
                  summary?.pending ??
                  jobs.filter((p) => p.status === "scheduled").length;
                const review =
                  summary?.review ??
                  jobs.filter(
                    (p) => p.status === "failed" || p.status === "uncertain",
                  ).length;
                const pct = Math.min(
                  100,
                  Math.round((done / (done + pending || 1)) * 100),
                );
                const state = flow.state || "active";
                const stateLabel = {
                  active: "Ativa",
                  paused: "Pausada",
                  stopped: "Cancelada",
                  completed: "Concluída",
                }[state];

                return (
                  <article key={flow.id} className="ig-campaign-row">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`ig-state-dot is-${state}`}
                          aria-hidden="true"
                        />
                        <strong className="truncate text-sm font-medium text-foreground">
                          {flow.name || "Campanha sem nome"}
                        </strong>
                        <span className="chip">{stateLabel}</span>
                        <span className="text-xs text-muted-foreground">
                          {flow.settings.kind === "stories" ? "Stories" : "Posts"} ·{" "}
                          {flow.settings.repeat === "loop"
                            ? `Loop (ciclo ${flow.cycle || 1})`
                            : "Ciclo único"}
                        </span>
                      </div>

                      {["active", "paused"].includes(state) && <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs text-muted-foreground">{flow.settings.accountIds.length} conta(s) neste fluxo</span>
                        <Button size="sm" variant="outline" disabled={busy || state !== "active"} className="h-8 text-xs" onClick={() => {
                          setSyncFlowId(flow.id);
                          setSyncAccountIds([]);
                          void onCreated();
                        }}><Plus size={13} className="mr-1.5" />Conectar conta ao fluxo</Button>
                        {state === "paused" && <span className="text-xs text-muted-foreground">Retome a campanha para conectar uma conta.</span>}
                      </div>}
                      {flow.last_error && (
                        <p role="status" className="text-xs text-warning">
                          {flow.last_error === "no_available_accounts"
                            ? "Nenhuma conta disponível para publicar neste fluxo."
                            : flow.last_error === "no_available_media"
                              ? "Nenhuma mídia disponível para continuar neste fluxo."
                              : "Não foi possível preparar o próximo ciclo. As tentativas anteriores estão registradas na fila."}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                        <span>{done} publicado(s)</span>
                        <span>·</span>
                        <span>{pending} na fila</span>
                        {review > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-warning">
                              {review} item(ns) ignorado(s) após erro ou falta de confirmação
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span>
                          {flow.settings.schedule === "slots"
                            ? `Horários: ${flow.settings.slots?.join(", ")}`
                            : `GAP ${flow.settings.gapMinutes} min`}
                        </span>
                      </div>

                      <div className="flex max-w-md items-center gap-2.5 pt-0.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {pct}%
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {state === "active" && (
                        <Button size="sm" variant="outline" disabled={busy} className="h-8 text-xs"
                          onClick={() => setSharing({ id: flow.id, name: flow.name || "Campanha sem nome" })}>
                          <Link2 size={13} className="mr-1.5" />
                          Compartilhar fluxo
                        </Button>
                      )}
                      {report && ["active", "paused"].includes(state) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          className="h-8 text-xs"
                          onClick={() =>
                            void perform(async () => {
                              await controlFlow(
                                flow.id,
                                state === "paused" ? "resume" : "pause",
                              );
                              await onCreated();
                            })
                          }
                        >
                          {state === "paused"
                            ? "Retomar campanha"
                            : "Pausar campanha"}
                        </Button>
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={busy}
                            className="h-8 w-8"
                            aria-label={`Mais ações de ${flow.name || "Campanha sem nome"}`}
                            title="Mais ações"
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => reuseFlow(flow)}>
                            <Copy size={14} aria-hidden="true" />
                            Reusar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {(pending > 0 || state === "active" || state === "paused") && (
                            <DropdownMenuItem onSelect={() => handleCancelFlow(flow.id)}>
                              <Ban size={14} aria-hidden="true" />
                              Cancelar fluxo
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => handleDeleteFlow(flow.id)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            Apagar fluxo
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MediaCaption({
  media,
  index,
  busy,
  save,
}: {
  media: Media;
  index: number;
  busy: boolean;
  save: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(media.caption);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={`caption-${media.id}`}
          className="text-[11px] text-muted-foreground"
        >
          Mídia {index + 1}
        </Label>
        {text !== media.caption && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(text)}
            className="text-[11px] font-medium text-foreground underline underline-offset-2"
          >
            Salvar
          </button>
        )}
      </div>
      <Textarea
        id={`caption-${media.id}`}
        rows={2}
        className="text-xs"
        value={text}
        maxLength={2200}
        placeholder="Legenda exclusiva desta mídia…"
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}
