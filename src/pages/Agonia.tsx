import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Film,
  FolderPlus,
  Heart,
  Image as ImageIcon,
  Instagram,
  Layers,
  Link2,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ConnectAccount } from "@/features/instagram-publisher/ConnectAccount";
import Flows from "@/features/instagram-publisher/Flows";
import { AgoniaAlerts } from "@/components/agonia/AgoniaAlerts";
import { useInstagramMonitor } from "@/features/instagram-publisher/InstagramAlerts";
import {
  cancelFlow,
  deleteFlow,
  loadFlowData,
} from "@/features/instagram-publisher/flows-api";
import {
  cancelPost,
  connections,
  listAccounts,
  listPosts,
  publisherRequest,
  savePost,
  uploadMedia,
} from "@/features/instagram-publisher/api";
import type { Post } from "@/features/instagram-publisher/model";
import {
  TIMEZONES,
  buildSchedule,
  clampInterval,
  loadAccountFolders,
  loadAccountMeta,
  loadAgoniaProfile,
  loadMetaApps,
  loadSettings,
  localToUtcIso,
  parseCaptionVariants,
  saveAccountFolders,
  saveAccountMeta,
  saveAgoniaProfile,
  saveMetaApps,
  saveSettings,
  type AccountMetaMap,
  type MetaAppConfig,
} from "@/features/agonia/schedule";
import "@/features/agonia/agonia.css";

type Section =
  | "dashboard"
  | "fluxos"
  | "alertas"
  | "conectar"
  | "instagram"
  | "reels-new"
  | "stories"
  | "stories-link"
  | "scheduled"
  | "reels"
  | "reels-test"
  | "settings"
  | "profile";

const VALID_SECTIONS = new Set<Section>([
  "dashboard",
  "fluxos",
  "alertas",
  "conectar",
  "instagram",
  "reels-new",
  "stories",
  "stories-link",
  "scheduled",
  "reels",
  "reels-test",
  "settings",
  "profile",
]);

function defaultDateTimeLocal() {
  const date = new Date(Date.now() + 10 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isToday(iso?: string | null) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isWithinDays(iso: string | null | undefined, days: number) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= days * 86_400_000;
}

function statusBadge(status: Post["status"]) {
  switch (status) {
    case "published":
      return <span className="badge badge-green">Publicado</span>;
    case "scheduled":
    case "processing":
      return (
        <span className="badge badge-yellow">
          {status === "processing" ? "Processando" : "Agendado"}
        </span>
      );
    case "failed":
    case "uncertain":
      return (
        <span className="badge badge-red">
          {status === "uncertain" ? "Verificar" : "Falhou"}
        </span>
      );
    default:
      return (
        <span className="badge badge-gray">
          {status === "cancelled" ? "Cancelado" : "Rascunho"}
        </span>
      );
  }
}

export default function Agonia() {
  const { section: rawSection } = useParams<{ section?: string }>();
  const section: Section =
    rawSection && VALID_SECTIONS.has(rawSection as Section)
      ? (rawSection as Section)
      : "dashboard";
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: ["instagram-publisher-accounts", user?.id],
    queryFn: () => listAccounts(user!.id),
    enabled: !!user,
  });
  const linksQuery = useQuery({
    queryKey: ["instagram-publisher-links", user?.id],
    queryFn: connections,
    enabled: !!user,
  });
  const postsQuery = useQuery({
    queryKey: ["instagram-publisher", user?.id],
    queryFn: () => listPosts(user!.id),
    enabled: !!user,
    refetchInterval: 20_000,
  });

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);
  const posts = useMemo(() => postsQuery.data ?? [], [postsQuery.data]);

  const monitor = useInstagramMonitor();
  const flowsQuery = useQuery({
    queryKey: ["ig-flows", user?.id],
    queryFn: () => loadFlowData(user!.id),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const activeAlerts = useMemo(
    () => monitor.data?.alerts.filter((a) => !a.resolved_at) ?? [],
    [monitor.data?.alerts],
  );
  const unreadAlerts = useMemo(
    () => monitor.data?.alerts.filter((a) => !a.read_at && !a.resolved_at) ?? [],
    [monitor.data?.alerts],
  );
  const healthList = useMemo(
    () => monitor.data?.health ?? [],
    [monitor.data?.health],
  );
  const healthMap = useMemo(
    () => new Map(healthList.map((h) => [h.account_id, h])),
    [healthList],
  );
  const degradedAccounts = useMemo(() => {
    return accounts.filter((a) => {
      const h = healthMap.get(a.id);
      const c = links.find((conn) => conn.account_id === a.id);
      return (
        (h && h.state !== "healthy" && h.state !== "unknown") ||
        c?.reconnect_required
      );
    });
  }, [accounts, healthMap, links]);

  const activeFlows = useMemo(
    () =>
      flowsQuery.data?.flows.filter(
        (f) => !f.state || f.state === "active" || f.state === "paused",
      ) ?? [],
    [flowsQuery.data?.flows],
  );

  // Settings & Local Persistence
  const [settings, setSettings] = useState(() => loadSettings(user?.id));
  const [metaApps, setMetaApps] = useState<MetaAppConfig[]>(() =>
    loadMetaApps(user?.id),
  );
  const [selectedAppId, setSelectedAppId] = useState<string>("");
  const [accountMeta, setAccountMeta] = useState<AccountMetaMap>(() =>
    loadAccountMeta(user?.id),
  );
  const [accountFolders, setAccountFolders] = useState<string[]>(() =>
    loadAccountFolders(user?.id),
  );
  const [selectedAccountFolder, setSelectedAccountFolder] = useState<string>("*");
  const [addingAccountFolder, setAddingAccountFolder] = useState(false);
  const [newAccountFolderName, setNewAccountFolderName] = useState("");
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});

  // Meta App form state
  const [newAppName, setNewAppName] = useState("");
  const [newAppId, setNewAppId] = useState("");
  const [newAppSecret, setNewAppSecret] = useState("");

  // Instagram Operations Map state
  const [opsFilter, setOpsFilter] = useState("ALL");
  const [opsSelectedIds, setOpsSelectedIds] = useState<string[]>([]);
  const [opsBusy, setOpsBusy] = useState(false);

  // Reel Composer state
  const [reelVideos, setReelVideos] = useState<File[]>([]);
  const [reelCover, setReelCover] = useState<File | null>(null);
  const [reelCaption, setReelCaption] = useState("");
  const [reelVariants, setReelVariants] = useState("");
  const [reelMode, setReelMode] = useState<"sequence" | "schedule" | "now" | "repeat">("sequence");
  const [reelTimezone, setReelTimezone] = useState(settings.timezone);
  const [reelInterval, setReelInterval] = useState(settings.intervalMinutes || 10);
  const [reelScheduledAt, setReelScheduledAt] = useState(defaultDateTimeLocal);
  const [reelRepeatCount, setReelRepeatCount] = useState(2);
  const [reelAccountIds, setReelAccountIds] = useState<string[]>([]);
  const [reelBusy, setReelBusy] = useState(false);
  const [reelProgress, setReelProgress] = useState("");

  // Stories Composer state
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [storyMode, setStoryMode] = useState<"now" | "schedule">("now");
  const [storyTimezone, setStoryTimezone] = useState(settings.timezone);
  const [storyScheduledAt, setStoryScheduledAt] = useState(defaultDateTimeLocal);
  const [storyAccountIds, setStoryAccountIds] = useState<string[]>([]);
  const [storyBusy, setStoryBusy] = useState(false);

  // Scheduled & Published filters/pagination
  const [schedAppFilter, setSchedAppFilter] = useState("");
  const [schedAccountFilter, setSchedAccountFilter] = useState("");
  const [pubTab, setPubTab] = useState<"all" | "scheduled" | "published" | "failed">("all");
  const [pubPage, setPubPage] = useState(1);

  // Diagnostic Reel Test state
  const [diagAccountId, setDiagAccountId] = useState("");
  const [diagVideo, setDiagVideo] = useState<File | null>(null);
  const [diagCaption, setDiagCaption] = useState("Teste");
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagSteps, setDiagSteps] = useState<
    Array<{ title: string; detail: string; done: boolean }>
  >([]);

  // Profile state
  const fallbackDisplayName =
    (typeof user?.user_metadata?.display_name === "string" &&
      user.user_metadata.display_name.trim()) ||
    user?.email?.split("@")[0] ||
    "Operador";
  const [profile, setProfile] = useState(() =>
    loadAgoniaProfile(user?.id, fallbackDisplayName),
  );

  useEffect(() => {
    const loaded = loadSettings(user?.id);
    setSettings(loaded);
    setReelTimezone(loaded.timezone);
    setStoryTimezone(loaded.timezone);
    setReelInterval(loaded.intervalMinutes || 10);
    setReelCaption((prev) => prev || loaded.defaultCaption);
    setMetaApps(loadMetaApps(user?.id));
    setAccountMeta(loadAccountMeta(user?.id));
    setAccountFolders(loadAccountFolders(user?.id));
    setProfile(loadAgoniaProfile(user?.id, fallbackDisplayName));
  }, [user?.id, fallbackDisplayName]);

  // Garante que cada conta tenha um activeSince registrado para o cálculo automático de etiquetas por dias
  useEffect(() => {
    if (!user?.id || !accounts.length) return;
    let changed = false;
    const next: AccountMetaMap = { ...accountMeta };
    for (const acc of accounts) {
      if (!next[acc.id]?.activeSince) {
        const accPosts = posts.filter((p) => p.account_id === acc.id);
        const timestamps: number[] = [];
        if (acc.created_at) {
          const t = Date.parse(acc.created_at);
          if (Number.isFinite(t)) timestamps.push(t);
        }
        for (const p of accPosts) {
          const t = Date.parse(p.published_at || p.created_at);
          if (Number.isFinite(t)) timestamps.push(t);
        }
        const earliest =
          timestamps.length > 0
            ? new Date(Math.min(...timestamps)).toISOString()
            : new Date().toISOString();
        next[acc.id] = {
          ...next[acc.id],
          activeSince: earliest,
        };
        changed = true;
      }
    }
    if (changed) {
      setAccountMeta(next);
      saveAccountMeta(user.id, next);
    }
  }, [user?.id, accounts, posts, accountMeta]);

  useEffect(() => {
    if (accounts.length) {
      setReelAccountIds((prev) =>
        prev.length ? prev : accounts.map((a) => a.id),
      );
      setStoryAccountIds((prev) =>
        prev.length ? prev : accounts.map((a) => a.id),
      );
      setDiagAccountId((prev) => prev || accounts[0].id);
    }
  }, [accounts]);

  const activeMetaApp = useMemo(
    () =>
      metaApps.find((a) => a.id === selectedAppId) ||
      metaApps.find((a) => a.active) ||
      metaApps[0],
    [metaApps, selectedAppId],
  );

  const accountNames = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.username])),
    [accounts],
  );

  const linkMap = useMemo(
    () => new Map(links.map((l) => [l.account_id, l])),
    [links],
  );

  const stats = useMemo(() => {
    const scheduled = posts.filter(
      (p) => p.status === "scheduled" || p.status === "processing",
    );
    const publishedToday = posts.filter(
      (p) => p.status === "published" && isToday(p.published_at || p.created_at),
    );
    const failed = posts.filter(
      (p) => p.status === "failed" || p.status === "uncertain",
    );
    return {
      connected: accounts.length,
      scheduled: scheduled.length,
      publishedToday: publishedToday.length,
      failed: failed.length,
      nextPosts: [...scheduled]
        .sort(
          (a, b) =>
            Date.parse(a.scheduled_at || a.created_at) -
            Date.parse(b.scheduled_at || b.created_at),
        )
        .slice(0, 6),
    };
  }, [accounts.length, posts]);

  // Métricas de visualização de Reels & alertas das contas conectadas
  // Período do dashboard (apenas layout; dados de métricas serão ligados depois)
  const [dashPeriod, setDashPeriod] = useState<"today" | "yesterday" | "7d">("today");
  const dashPeriodLabel = { today: "Hoje", yesterday: "Ontem", "7d": "7 dias" }[dashPeriod];

  // Filtro por modelo no Ranking de Contas
  const MODEL_OPTIONS = [
    { id: "all", label: "Todas as contas" },
    { id: "bianca-rossi", label: "Bianca Rossi" },
    { id: "sara-isabel", label: "Sara Isabel" },
    { id: "leticia-torres", label: "Letícia Torres" },
  ] as const;
  const [selectedModel, setSelectedModel] = useState<string>("all");
  const selectedModelLabel =
    MODEL_OPTIONS.find((m) => m.id === selectedModel)?.label ?? "Todas as contas";

  const getRankBadge = (pos: number) => {
    if (pos === 1) {
      return (
        <span className="rank-pos-badge rank-pos-1" title="1º Lugar no ranking">
          🥇 1º
        </span>
      );
    }
    if (pos === 2) {
      return (
        <span className="rank-pos-badge rank-pos-2" title="2º Lugar no ranking">
          🥈 2º
        </span>
      );
    }
    if (pos === 3) {
      return (
        <span className="rank-pos-badge rank-pos-3" title="3º Lugar no ranking">
          🥉 3º
        </span>
      );
    }
    return (
      <span className="rank-pos-badge rank-pos-other">
        {pos}º
      </span>
    );
  };

  const dashHour = new Date().getHours();
  const dashGreeting = useMemo(() => {
    // ☀️ Manhã: das 5h às 12h
    if (dashHour >= 5 && dashHour < 12) {
      return "Olá! Acordou agora ou está indo dormir?";
    }
    // 🌤️ Tarde: das 12h às 18h
    if (dashHour >= 12 && dashHour < 18) {
      return "Boa tarde! Já fez o L hoje?";
    }
    // 🌙 Noite: das 18h à 0h
    if (dashHour >= 18 && dashHour < 24) {
      return "Boa noite! Já fez dinheiro por LULA hoje?";
    }
    // 🦉 Madrugada: da 0h às 5h
    return "Olá, coruja! Dormir não dá ROI, né?";
  }, [dashHour]);

  const accountViewsMetrics = useMemo(() => {
    // Preparado para receber views_count/reels_views das contas conectadas quando a API fornecer
    const rows = accounts.map((acc) => {
      const rawViews = (acc as any).reels_views ?? (acc as any).views_count ?? 0;
      const h = healthMap.get(acc.id);
      const conn = links.find((c) => c.account_id === acc.id);
      const hasWarning =
        (h && h.state !== "healthy" && h.state !== "unknown") ||
        conn?.reconnect_required ||
        activeAlerts.some((alert) => alert.account_id === acc.id);

      const modelVal =
        (acc as any).model ??
        (acc as any).model_name ??
        (acc as any).model_id ??
        null;

      return {
        id: acc.id,
        username: acc.username,
        model: modelVal,
        views: Number(rawViews) || 0,
        hasWarning: Boolean(hasWarning),
      };
    });

    const allAccountsTotalViews = rows.reduce((acc, r) => acc + r.views, 0);

    // Filtragem por modelo (se selecionada uma modelo específica)
    const filtered =
      selectedModel === "all"
        ? rows
        : rows.filter((r) => {
            if (!r.model) return false;
            const target = MODEL_OPTIONS.find((m) => m.id === selectedModel)?.label.toLowerCase();
            const current = String(r.model).toLowerCase();
            return current === selectedModel.toLowerCase() || (target && current === target);
          });

    // Ordenação do ranking por critérios de visualizações de vídeos (maior para menor)
    const sorted = [...filtered].sort((a, b) => b.views - a.views);
    const totalViews = sorted.reduce((acc, r) => acc + r.views, 0);
    const maxViews = Math.max(1, ...sorted.map((r) => r.views));
    const accountsWithWarning = sorted.filter((r) => r.hasWarning);

    const best = sorted[0];
    const lowest = sorted[sorted.length - 1];
    const lowestAccounts = sorted.filter(
      (r) => r.views === (lowest?.views ?? 0),
    );

    return {
      rows: sorted,
      totalViews,
      allAccountsTotalViews,
      maxViews,
      accountsWithWarning,
      accountsWithWarningCount: accountsWithWarning.length,
      best,
      lowest,
      lowestAccounts,
    };
  }, [accounts, healthMap, links, activeAlerts, selectedModel]);

  const redirectUri = `${window.location.origin}/instagram/conectar`;

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["instagram-publisher-accounts", user?.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["instagram-publisher-links", user?.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["instagram-publisher", user?.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["instagram-monitor", user?.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["ig-flows", user?.id],
      }),
    ]);
  }

  function handleAddMetaApp(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const name = newAppName.trim();
    const appId = newAppId.trim();
    if (!name || !appId || newAppSecret.trim().length < 4) {
      toast.error("Preencha o Nome interno, o Meta App ID e o App Secret.");
      return;
    }
    const next: MetaAppConfig[] = [
      ...metaApps,
      {
        id: crypto.randomUUID(),
        name,
        appId,
        active: true,
        createdAt: new Date().toISOString(),
      },
    ];
    setMetaApps(next);
    saveMetaApps(user.id, next);
    setNewAppName("");
    setNewAppId("");
    setNewAppSecret("");
    toast.success(`App Meta "${name}" adicionado com sucesso.`);
  }

  function toggleMetaApp(id: string) {
    if (!user) return;
    const next = metaApps.map((app) =>
      app.id === id ? { ...app, active: !app.active } : app,
    );
    setMetaApps(next);
    saveMetaApps(user.id, next);
  }

  function deleteMetaApp(id: string) {
    if (!user) return;
    if (metaApps.length <= 1) {
      toast.error("Mantenha pelo menos um App Meta cadastrado.");
      return;
    }
    const next = metaApps.filter((app) => app.id !== id);
    setMetaApps(next);
    saveMetaApps(user.id, next);
    toast.success("App Meta removido.");
  }

  function saveModelForAccount(accountId: string, username: string) {
    if (!user) return;
    const value = (
      modelDrafts[accountId] ??
      accountMeta[accountId]?.modelName ??
      ""
    ).trim();
    const next: AccountMetaMap = {
      ...accountMeta,
      [accountId]: {
        ...accountMeta[accountId],
        modelName: value || "Sem modelo",
        metaAppId: activeMetaApp?.id,
      },
    };
    setAccountMeta(next);
    saveAccountMeta(user.id, next);
    toast.success(`Modelo salvo para @${username}`);
  }

  function saveNameForAccount(accountId: string, username: string) {
    if (!user) return;
    const value = (
      nameDrafts[accountId] ??
      accountMeta[accountId]?.customName ??
      ""
    ).trim();
    const next: AccountMetaMap = {
      ...accountMeta,
      [accountId]: {
        ...accountMeta[accountId],
        customName: value,
      },
    };
    setAccountMeta(next);
    saveAccountMeta(user.id, next);
    toast.success(
      value
        ? `Nome "${value}" salvo para @${username}`
        : `Nome personalizado removido de @${username}`,
    );
  }

  function setFolderForAccount(
    accountId: string,
    username: string,
    folderName: string,
  ) {
    if (!user) return;
    const next: AccountMetaMap = {
      ...accountMeta,
      [accountId]: {
        ...accountMeta[accountId],
        folder: folderName,
      },
    };
    setAccountMeta(next);
    saveAccountMeta(user.id, next);
    toast.success(
      folderName
        ? `@${username} movida para a pasta "${folderName}".`
        : `@${username} movida para Sem pasta.`,
    );
  }

  function moveSelectedAccountsToFolder(folderName: string) {
    if (!user || !opsSelectedIds.length) return;
    const next: AccountMetaMap = { ...accountMeta };
    for (const id of opsSelectedIds) {
      next[id] = {
        ...next[id],
        folder: folderName,
      };
    }
    setAccountMeta(next);
    saveAccountMeta(user.id, next);
    toast.success(
      folderName
        ? `${opsSelectedIds.length} conta(s) movida(s) para "${folderName}".`
        : `${opsSelectedIds.length} conta(s) movida(s) para Sem pasta.`,
    );
  }

  function getAccountActiveDays(acc: { id: string; created_at?: string }) {
    const accPosts = posts.filter((p) => p.account_id === acc.id);
    const timestamps: number[] = [];
    const savedSince = accountMeta[acc.id]?.activeSince;
    if (savedSince) {
      const t = Date.parse(savedSince);
      if (Number.isFinite(t)) timestamps.push(t);
    }
    if (acc.created_at) {
      const t = Date.parse(acc.created_at);
      if (Number.isFinite(t)) timestamps.push(t);
    }
    for (const p of accPosts) {
      const t = Date.parse(p.published_at || p.created_at);
      if (Number.isFinite(t)) timestamps.push(t);
    }
    const startMs = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
    const elapsedDays = Math.floor((Date.now() - startMs) / 86_400_000) + 1;
    return Math.max(1, elapsedDays);
  }

  async function verifyAllAccounts() {
    if (!accounts.length || !user) return;
    setOpsBusy(true);
    let okCount = 0;
    const nowIso = new Date().toISOString();
    const nextMeta: AccountMetaMap = { ...accountMeta };
    try {
      for (const acc of accounts) {
        try {
          await publisherRequest("verify", { account_id: acc.id });
          okCount += 1;
          nextMeta[acc.id] = { ...nextMeta[acc.id], lastCheckedAt: nowIso };
        } catch {
          /* continue checking remaining accounts */
        }
      }
      setAccountMeta(nextMeta);
      saveAccountMeta(user.id, nextMeta);
      await refreshAll();
      toast.success(
        `Verificação concluída: ${okCount} de ${accounts.length} conta(s) saudável(is).`,
      );
    } finally {
      setOpsBusy(false);
    }
  }

  async function resumePausedAccounts() {
    const paused = links.filter((l) => l.paused);
    if (!paused.length) return;
    setOpsBusy(true);
    try {
      for (const item of paused) {
        await publisherRequest("pause", {
          account_id: item.account_id,
          paused: false,
        });
      }
      await refreshAll();
      toast.success(`${paused.length} conta(s) reativada(s).`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao reativar contas.",
      );
    } finally {
      setOpsBusy(false);
    }
  }

  async function handlePublishReels(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const targets = accounts
      .map((a) => a.id)
      .filter((id) => reelAccountIds.includes(id));
    if (!targets.length) {
      toast.error("Selecione ao menos uma conta de destino.");
      return;
    }
    if (!reelVideos.length) {
      toast.error("Escolha pelo menos um vídeo MP4 ou MOV.");
      return;
    }

    setReelBusy(true);
    try {
      const startIso =
        reelMode === "schedule"
          ? localToUtcIso(reelScheduledAt, reelTimezone)
          : new Date(Date.now() + 90_000).toISOString();

      const urls = await uploadMedia(reelVideos, user.id, setReelProgress);
      const captions = parseCaptionVariants(reelCaption, reelVariants);
      const stepMs = clampInterval(reelInterval) * 60_000;
      const startMs = Date.parse(startIso);

      const videosToPublish =
        reelMode === "repeat"
          ? Array.from(
              { length: Math.max(1, Math.min(20, reelRepeatCount)) },
              (_, i) => urls[i % urls.length],
            )
          : urls;

      let jobIndex = 0;
      for (let vIdx = 0; vIdx < videosToPublish.length; vIdx++) {
        const mediaUrl = videosToPublish[vIdx];
        for (let aIdx = 0; aIdx < targets.length; aIdx++) {
          const accountId = targets[aIdx];
          const chosenCaption = captions[jobIndex % captions.length] || "";
          const scheduledAt = new Date(
            startMs + jobIndex * stepMs,
          ).toISOString();
          await savePost({
            id: crypto.randomUUID(),
            user_id: user.id,
            account_id: accountId,
            format: "Reel",
            caption: chosenCaption,
            media_urls: [mediaUrl],
            scheduled_at: scheduledAt,
            status: "scheduled",
          });
          jobIndex += 1;
        }
      }

      await refreshAll();
      setReelVideos([]);
      setReelCover(null);
      toast.success(
        `${jobIndex} Reel(s) enviado(s) para a fila de publicação oficial!`,
      );
      navigate("/agonia/scheduled");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Não foi possível agendar o Reel.",
      );
    } finally {
      setReelBusy(false);
      setReelProgress("");
    }
  }

  async function handlePublishStories(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const targets = accounts
      .map((a) => a.id)
      .filter((id) => storyAccountIds.includes(id));
    if (!targets.length) {
      toast.error("Selecione ao menos uma conta para o Story.");
      return;
    }
    if (!storyFile) {
      toast.error("Escolha uma imagem ou vídeo para o Story.");
      return;
    }

    setStoryBusy(true);
    try {
      const startIso =
        storyMode === "schedule"
          ? localToUtcIso(storyScheduledAt, storyTimezone)
          : new Date(Date.now() + 90_000).toISOString();
      const urls = await uploadMedia([storyFile], user.id);
      const schedule = buildSchedule(targets, startIso, settings.intervalMinutes);

      for (const item of schedule) {
        await savePost({
          id: crypto.randomUUID(),
          user_id: user.id,
          account_id: item.accountId,
          format: "Story",
          caption: "",
          media_urls: urls,
          scheduled_at: item.scheduledAt,
          status: "scheduled",
        });
      }

      await refreshAll();
      setStoryFile(null);
      toast.success(`Story enviado para ${schedule.length} conta(s)!`);
      navigate("/agonia/scheduled");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possível publicar o Story.",
      );
    } finally {
      setStoryBusy(false);
    }
  }

  async function handleRunDiagnostic(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !diagAccountId || !diagVideo) {
      toast.error("Selecione uma conta de teste e um vídeo.");
      return;
    }
    setDiagBusy(true);
    setDiagSteps([
      {
        title: "1. Verificando token e permissões da conta",
        detail: "Consultando Instagram Graph API...",
        done: false,
      },
    ]);
    try {
      await publisherRequest("verify", { account_id: diagAccountId });
      setDiagSteps((prev) => [
        { ...prev[0], detail: "Token válido e autorizado pela Meta.", done: true },
        {
          title: "2. Limpando metadados e enviando vídeo",
          detail: "Enviando para o storage seguro...",
          done: false,
        },
      ]);

      const urls = await uploadMedia([diagVideo], user.id);
      setDiagSteps((prev) => [
        prev[0],
        { ...prev[1], detail: `Upload concluído (${urls[0]})`, done: true },
        {
          title: "3. Criando container de Reel e agendando envio imediato",
          detail: "Registrando job na fila oficial...",
          done: false,
        },
      ]);

      await savePost({
        id: crypto.randomUUID(),
        user_id: user.id,
        account_id: diagAccountId,
        format: "Reel",
        caption: diagCaption.trim(),
        media_urls: urls,
        scheduled_at: new Date(Date.now() + 75_000).toISOString(),
        status: "scheduled",
      });

      setDiagSteps((prev) => [
        prev[0],
        prev[1],
        {
          ...prev[2],
          detail:
            "Job registrado com sucesso! O worker enviará para a Meta no próximo ciclo.",
          done: true,
        },
      ]);
      await refreshAll();
      toast.success("Teste isolado enviado com sucesso!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha no teste de diagnóstico.",
      );
    } finally {
      setDiagBusy(false);
    }
  }

  function renderMetaAppsPanel() {
    return (
      <section className="panel meta-apps-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              <Layers className="h-4 w-4" /> Apps Meta Developer
            </h2>
            <p className="panel-copy">
              Use um app diferente para novas autorizações. O App Secret nunca é
              exibido depois de salvo.
            </p>
          </div>
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="notice" style={{ marginBottom: 0 }}>
          <strong>Como funciona:</strong> selecione o app desejado na área de
          contas conectadas antes de clicar em “Adicionar”. Cada app precisa ter
          seu próprio produto, redirect URI e permissões configurados no Meta
          for Developers.
        </div>
        <div className="meta-app-list">
          {metaApps.map((app) => (
            <article
              key={app.id}
              className={`meta-app-card ${!app.active ? "meta-app-card-disabled" : ""}`}
            >
              <div className="meta-app-card-main">
                <div className="meta-app-icon">
                  <Instagram className="h-4 w-4" />
                </div>
                <div>
                  <strong>{app.name}</strong>
                  <span>
                    App ID: <code>{app.appId}</code>
                  </span>
                  <small>
                    {app.active
                      ? "Disponível para novas conexões"
                      : "Desativado para novas conexões"}
                  </small>
                </div>
              </div>
              <div className="meta-app-card-actions">
                <span
                  className={`setup-status ${app.active ? "setup-ok" : "setup-pending"}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {app.active ? "Ativo" : "Pausado"}
                </span>
                <span className="meta-app-account-count">
                  {accounts.length} conta(s)
                </span>
                <button
                  type="button"
                  onClick={() => toggleMetaApp(app.id)}
                  className="button button-secondary"
                  style={{ padding: "6px 10px", fontSize: 11 }}
                >
                  {app.active ? "Desativar" : "Ativar"}
                </button>
                <button
                  type="button"
                  onClick={() => deleteMetaApp(app.id)}
                  className="button button-danger"
                  style={{ padding: "6px 10px", fontSize: 11 }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="meta-app-redirect">
          <span>Redirect URI que deve ser cadastrado em todos os apps</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <code>{redirectUri}</code>
            <button
              type="button"
              className="icon-button"
              title="Copiar redirect URI"
              onClick={() => {
                void navigator.clipboard.writeText(redirectUri);
                toast.success("Redirect URI copiado!");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <form onSubmit={handleAddMetaApp} className="meta-app-form">
          <div className="meta-app-form-heading">
            <div>
              <h3>Adicionar outro app Meta</h3>
              <p>
                Preencha os três campos abaixo com os dados copiados do Meta for
                Developers.
              </p>
            </div>
            <Plus className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="form-grid">
            <label className="meta-app-field form-full">
              <span className="meta-app-field-label">1. Nome interno</span>
              <input
                placeholder="Ex.: App Meta 02"
                required
                minLength={2}
                maxLength={80}
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
              />
              <small>Um nome para você identificar este app no painel.</small>
            </label>
            <label className="meta-app-field">
              <span className="meta-app-field-label">
                2. Meta App ID <b>obrigatório</b>
              </span>
              <input
                placeholder="Ex.: 123456789012345"
                inputMode="numeric"
                required
                value={newAppId}
                onChange={(e) => setNewAppId(e.target.value)}
              />
              <small>
                Somente números. Encontre em Meta for Developers → Configurações
                básicas.
              </small>
            </label>
            <label className="meta-app-field">
              <span className="meta-app-field-label">
                3. Meta App Secret <b>obrigatório</b>
              </span>
              <input
                type="password"
                placeholder="Cole aqui o App Secret"
                required
                minLength={4}
                maxLength={512}
                autoComplete="new-password"
                value={newAppSecret}
                onChange={(e) => setNewAppSecret(e.target.value)}
              />
              <small>O secret fica oculto e não será exibido novamente.</small>
            </label>
          </div>
          <div className="config-actions">
            <button className="button button-mint" type="submit">
              <Plus className="h-4 w-4" /> Adicionar app Meta
            </button>
            <span className="panel-copy">
              Os Apps e chaves cadastrados aqui são privados da sua conta.
            </span>
          </div>
        </form>
      </section>
    );
  }

  return (
    <div className="agonia-root">
      {/* 1. DASHBOARD */}
      {section === "dashboard" && (
        <>
          <header className="topbar">
            <div>
              <h1 className="page-title">{dashGreeting}</h1>
            </div>
            <div className="action-row">
              <Link className="button button-secondary" to="/agonia/fluxos">
                <Layers className="h-4 w-4" /> Modo Fluxo
              </Link>
              <Link className="button button-primary" to="/agonia/reels-new">
                <Plus className="h-4 w-4" /> Novo Reel
              </Link>
            </div>
          </header>

          {/* 1. MÉTRICAS NO TOPO */}
          <div className="dash-metrics-head">
            <div className="dash-metrics-label">
              <BarChart3 className="h-3.5 w-3.5" /> Métricas
              <span className="font-normal opacity-70">· {dashPeriodLabel}</span>
            </div>
            <div className="period-tabs" role="tablist" aria-label="Período">
              {([["today", "Hoje"], ["yesterday", "Ontem"], ["7d", "7 dias"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={dashPeriod === k}
                  className={dashPeriod === k ? "is-active" : ""}
                  onClick={() => setDashPeriod(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <section className="grid stats-grid">
            <Link to="/agonia/instagram" className="stat-card tone-purple">
              <span className="stat-icon"><Instagram className="h-4 w-4" /></span>
              <div className="label">Contas conectadas</div>
              <div className="value">{stats.connected}</div>
            </Link>
            <Link to="/agonia/scheduled" className="stat-card tone-blue">
              <span className="stat-icon"><CalendarClock className="h-4 w-4" /></span>
              <div className="label">Reels agendados</div>
              <div className="value">{stats.scheduled}</div>
            </Link>
            <div className="stat-card tone-purple">
              <span className="stat-icon"><Eye className="h-4 w-4" /></span>
              <div className="label">Views Reels</div>
              <div className="value">{accountViewsMetrics.allAccountsTotalViews.toLocaleString("pt-BR")}</div>
            </div>
            <div className="stat-card tone-blue">
              <span className="stat-icon"><Heart className="h-4 w-4" /></span>
              <div className="label">Curtidas Reels</div>
              <div className="value">0</div>
            </div>
            <div className="stat-card tone-green">
              <span className="stat-icon"><CheckCircle2 className="h-4 w-4" /></span>
              <div className="label">Publicados hoje</div>
              <div className="value">{stats.publishedToday}</div>
            </div>
            <Link to="/agonia/alertas" className="stat-card tone-red">
              <span className="stat-icon"><AlertTriangle className="h-4 w-4" /></span>
              <div className="label">Alertas de contas</div>
              <div className={`value ${activeAlerts.length > 0 ? "text-rose-400 font-semibold" : ""}`}>
                {activeAlerts.length || stats.failed}
              </div>
            </Link>
          </section>

          {/* 2. RANKING DE CONTAS POR VISUALIZAÇÃO TOTAL DE REELS */}
          <section className="panel performance-panel">
            <div className="panel-header performance-header">
              <div>
                <div className="eyebrow">
                  <Trophy className="h-3.5 w-3.5 text-amber-400" /> Ranking de Contas
                </div>
                <h2 className="performance-title">Ranking por visualização total de reels</h2>
                <p className="panel-copy">
                  Classificação das contas conectadas ordenada pela visualização total de reels.
                </p>
              </div>
              <div className="performance-summary-group">
                <div className="performance-total" title="Visualização total de reels">
                  <Play className="h-3.5 w-3.5 text-emerald-400" />
                  <strong>{accountViewsMetrics.totalViews.toLocaleString("pt-BR")}</strong>
                  <span>visualização total de reels</span>
                </div>
              </div>
            </div>

            {/* Filtro de Ranking por Modelo */}
            <div className="ranking-filter-bar" role="tablist" aria-label="Filtrar ranking por modelo">
              <span className="ranking-filter-label">Filtrar por modelo:</span>
              <div className="ranking-filter-tabs">
                {MODEL_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedModel === m.id}
                    className={`ranking-filter-tab ${selectedModel === m.id ? "is-active" : ""}`}
                    onClick={() => setSelectedModel(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {accountViewsMetrics.rows.length > 0 && (
              <div className="performance-highlights">
                <div className="performance-highlight performance-highlight-best">
                  <div className="performance-highlight-label">
                    <Trophy className="h-3.5 w-3.5 text-amber-400" /> 1º Lugar · Mais visualizações
                  </div>
                  <strong>
                    {accountViewsMetrics.best ? `@${accountViewsMetrics.best.username}` : "Nenhuma conta"}
                  </strong>
                  <span>
                    {accountViewsMetrics.best && accountViewsMetrics.best.views > 0
                      ? `${accountViewsMetrics.best.views.toLocaleString("pt-BR")} visualizações de Reels`
                      : "0 visualizações"}
                  </span>
                </div>
                <div className="performance-highlight performance-highlight-low">
                  <div className="performance-highlight-label">
                    <TrendingDown className="h-3.5 w-3.5" /> Menos visualizações
                  </div>
                  <strong>
                    {accountViewsMetrics.lowestAccounts.length > 0
                      ? accountViewsMetrics.lowestAccounts
                          .slice(0, 3)
                          .map((a) => `@${a.username}`)
                          .join(", ") +
                        (accountViewsMetrics.lowestAccounts.length > 3
                          ? ` +${accountViewsMetrics.lowestAccounts.length - 3}`
                          : "")
                      : "Todas com mesmo alcance"}
                  </strong>
                  <span>
                    {accountViewsMetrics.lowest && accountViewsMetrics.lowest.views > 0
                      ? `${accountViewsMetrics.lowest.views.toLocaleString("pt-BR")} visualizações`
                      : "0 visualizações"}
                  </span>
                </div>
              </div>
            )}

            {accounts.length === 0 ? (
              <div className="empty">
                Nenhuma conta conectada ainda. Conecte contas do Instagram para acompanhar o ranking por visualização total de reels.
              </div>
            ) : accountViewsMetrics.rows.length === 0 ? (
              <div className="empty">
                Nenhuma conta vinculada à modelo <strong>{selectedModelLabel}</strong> ainda.
                <p className="text-xs text-muted-foreground mt-1">
                  A categorização por modelos será ativada no site em breve.
                </p>
              </div>
            ) : (
              <div
                className="performance-list"
                role="list"
                aria-label="Ranking de contas por visualização total de reels"
              >
                {accountViewsMetrics.rows.map((row, index) => (
                  <div
                    key={row.id}
                    className="performance-row"
                    role="listitem"
                  >
                    <div className="performance-account">
                      <div className="flex items-center gap-2 min-w-0">
                        {getRankBadge(index + 1)}
                        <span className="truncate">@{row.username}</span>
                      </div>
                      <strong>
                        {row.views.toLocaleString("pt-BR")}{" "}
                        <span className="text-[10px] font-normal text-muted-foreground">reels</span>
                      </strong>
                    </div>
                    <div className="performance-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${
                            row.views > 0
                              ? Math.max(5, Math.round(
                                  (row.views / accountViewsMetrics.maxViews) * 100,
                                ))
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="performance-footer">
              <span>
                <CheckCircle2 className="h-3.5 w-3.5" /> Critério de ordenação: visualização total de reels
              </span>
              <span>
                {accountViewsMetrics.rows.length} conta(s) no ranking · Filtro: {selectedModelLabel}
              </span>
            </div>
          </section>

          {/* 3. AÇÕES RÁPIDAS (Minimalista) */}
          <section className="quick-actions-minimal">
            <span className="quick-actions-minimal-label">Ações rápidas</span>
            <div className="quick-actions-minimal-row">
              <Link className="quick-action-mini-btn" to="/agonia/fluxos">
                <Layers className="h-4 w-4 text-emerald-400" />
                <span>Modo Fluxo Automático</span>
                <ArrowRight className="h-3 w-3 opacity-60" />
              </Link>
              <Link className="quick-action-mini-btn" to="/agonia/reels-new">
                <Film className="h-4 w-4 text-blue-400" />
                <span>Publicar Novo Reel</span>
                <ArrowRight className="h-3 w-3 opacity-60" />
              </Link>
              <Link className="quick-action-mini-btn" to="/agonia/conectar">
                <Instagram className="h-4 w-4 text-purple-400" />
                <span>Conectar Instagram</span>
                <ArrowRight className="h-3 w-3 opacity-60" />
              </Link>
            </div>
          </section>

          {/* Fluxos em Andamento widget */}
          {activeFlows.length > 0 && (
            <section className="panel" aria-label="Fluxos em Andamento">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title flex items-center gap-2">
                    <Layers className="h-5 w-5 text-indigo-400" /> Fluxos de Publicação em Execução
                  </h2>
                  <p className="panel-copy">
                    Campanhas automáticas ativas rodando em segundo plano nas suas contas.
                  </p>
                </div>
                <Link className="link" to="/agonia/fluxos">
                  Gerenciar Modo Fluxo <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="grid gap-3">
                {activeFlows.slice(0, 3).map((flow) => {
                  const summary = flowsQuery.data?.report?.flows.find(
                    (item) => item.id === flow.id,
                  );
                  const jobs = posts.filter((p) => p.flow_id === flow.id);
                  const done =
                    summary?.published ??
                    jobs.filter((p) => p.status === "published").length;
                  const pending =
                    summary?.pending ??
                    jobs.filter((p) => p.status === "scheduled").length;
                  const totalJobs = done + pending || 1;
                  const pct = Math.min(100, Math.round((done / totalJobs) * 100));

                  return (
                    <div
                      key={flow.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-white text-base">
                            {flow.name || "Fluxo sem nome"}
                          </strong>
                          <span
                            className={`badge ${flow.state === "paused" ? "badge-yellow" : "badge-green"}`}
                          >
                            {flow.state === "paused" ? "Pausada" : "Ativa"}
                          </span>
                          {flow.settings.repeat === "loop" && (
                            <span className="badge badge-gray text-[10px]">
                              Loop · Ciclo {flow.cycle || 1}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {flow.settings.schedule === "slots"
                              ? `${flow.settings.slots?.length || 0} horários/dia`
                              : `GAP: ${flow.settings.gapMinutes || 60}m`}
                          </span>
                        </div>

                        <div className="w-full max-w-lg bg-white/10 rounded-full h-2 overflow-hidden mt-2">
                          <div
                            className="bg-emerald-400 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="text-emerald-400 font-medium">
                            {done} post(s) publicado(s) ({pct}%)
                          </span>
                          <span>{pending} agendado(s) na fila</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Link
                          to="/agonia/fluxos"
                          className="button button-secondary text-xs py-2 px-3"
                        >
                          Acompanhar Campanha
                        </Link>
                        <button
                          type="button"
                          className="button button-secondary text-xs py-2 px-3 flex items-center gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                          onClick={async () => {
                            try {
                              await cancelFlow(flow.id);
                              await refreshAll();
                              await flowsQuery.refetch();
                              toast.success(
                                "Fluxo cancelado e envios pendentes interrompidos.",
                              );
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Não foi possível cancelar o fluxo.",
                              );
                            }
                          }}
                        >
                          <Ban className="h-3.5 w-3.5" /> Cancelar fluxo
                        </button>
                        <button
                          type="button"
                          className="button button-secondary text-xs py-2 px-3 flex items-center gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
                          onClick={async () => {
                            try {
                              await deleteFlow(flow.id, user?.id);
                              await refreshAll();
                              await flowsQuery.refetch();
                              toast.success("Fluxo apagado com sucesso.");
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Não foi possível apagar o fluxo.",
                              );
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Apagar fluxo
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {/* 1.5. MODO FLUXO AUTOMÁTICO */}
      {section === "fluxos" && (
        <>
          <header className="topbar">
            <div>
              <h1 className="page-title">Modo Fluxo</h1>
              <p className="page-subtitle">
                Selecione mídias da biblioteca, escolha as contas e programe o envio contínuo.
              </p>
            </div>
          </header>

          <div className="agonia-flows-wrapper">
            <Flows
              accounts={accounts}
              connections={links}
              posts={posts}
              onCreated={refreshAll}
            />
          </div>
        </>
      )}

      {/* 1.6. CENTRAL DE ALERTAS E SAÚDE DAS CONTAS */}
      {section === "alertas" && (
        <AgoniaAlerts
          accounts={accounts}
          connections={links}
          onRefresh={refreshAll}
        />
      )}

      {/* 2. CONECTAR */}
      {section === "conectar" && (
        <>
          <header className="topbar">
            <div>
              <div className="eyebrow">Comece por aqui</div>
              <h1 className="page-title">Conectar Instagram</h1>
              <p className="page-subtitle">
                Você não precisa informar senha do Instagram. A conexão acontece
                na tela oficial do Instagram.
              </p>
            </div>
            <ConnectAccount onConnected={refreshAll} />
          </header>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Como conectar sua conta</h2>
                <p className="panel-copy">
                  Siga este passo a passo simples para autorizar sua conta ou enviar um convite.
                </p>
              </div>
            </div>
            <div className="wizard-grid">
              <div className="wizard-step">
                <span className="step-number">1</span>
                <div>
                  <h3>Conta Profissional</h3>
                  <p>
                    Certifique-se de que sua conta do Instagram seja do tipo{" "}
                    <strong>Profissional (Criador de Conteúdo ou Empresa)</strong>.
                  </p>
                </div>
              </div>
              <div className="wizard-step">
                <span className="step-number">2</span>
                <div>
                  <h3>Clique em Conectar conta</h3>
                  <p>
                    Use o botão <strong>Conectar conta</strong> no topo da página. Você pode entrar direto na sua conta ou clicar em{" "}
                    <strong>Gerar link de convite</strong> para enviar para outra pessoa autorizar.
                  </p>
                </div>
              </div>
              <div className="wizard-step">
                <span className="step-number">3</span>
                <div>
                  <h3>Autorize na tela oficial</h3>
                  <p>
                    Confirme as permissões na página oficial do Instagram. Assim que concluir, a conta já aparece pronta em{" "}
                    <Link to="/agonia/instagram" className="underline">
                      Instagram
                    </Link>{" "}
                    e no{" "}
                    <Link to="/agonia/fluxos" className="underline">
                      Modo Fluxo
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* 3. INSTAGRAM (GERENCIAMENTO DE CONTAS) */}
      {section === "instagram" && (
        <section className="operations-page">
          <div className="operations-hero-panel">
            <div className="operations-heading">
              <div>
                <div className="eyebrow flex items-center gap-2 text-purple-400">
                  <Instagram className="h-3.5 w-3.5" /> Central de Contas
                </div>
                <div className="flex items-center gap-3 flex-wrap mt-1">
                  <h1 className="operations-title">Gerenciar contas</h1>
                  <span className="rounded-full px-3 py-1 text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {accounts.length} {accounts.length === 1 ? "perfil conectado" : "perfis conectados"}
                  </span>
                </div>
                <p className="page-subtitle">
                  Organize suas contas em pastas, personalize os nomes e acompanhe a etiqueta automática de dias ativos.
                </p>
              </div>
              <div className="operations-actions">
                <ConnectAccount
                  onConnected={refreshAll}
                  variant="default"
                  className="connect-account-btn-prominent"
                />
                <button
                  type="button"
                  onClick={() => {
                    void refreshAll();
                    toast.success("Contas atualizadas!");
                  }}
                  className="button button-secondary operation-action"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Atualizar
                </button>
                <button
                  type="button"
                  disabled={opsBusy || !accounts.length}
                  onClick={() => void verifyAllAccounts()}
                  className="button button-secondary operation-action"
                >
                  {opsBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  Verificar saúde
                </button>
                {links.some((l) => l.paused) && (
                  <button
                    type="button"
                    disabled={opsBusy}
                    onClick={() => void resumePausedAccounts()}
                    className="button button-secondary operation-action"
                    title="Reativar contas pausadas"
                  >
                    Verificar e reativar pausadas
                  </button>
                )}
              </div>
            </div>

            {/* Status Strip */}
            <div className="operations-stats-strip">
              <div className="ops-stat-item">
                <span className="ops-stat-num">{accounts.length}</span>
                <span className="ops-stat-desc">Contas conectadas</span>
              </div>
              <div className="ops-stat-item">
                <span className="ops-stat-num text-emerald-400">
                  {accounts.filter((a) => !activeAlerts.some((al) => al.account_id === a.id)).length}
                </span>
                <span className="ops-stat-desc">Prontas para publicar</span>
              </div>
              <div className="ops-stat-item">
                <span className="ops-stat-num text-blue-400">{stats.publishedToday}</span>
                <span className="ops-stat-desc">Posts hoje</span>
              </div>
              <div className="ops-stat-item">
                <span className="ops-stat-num text-purple-400">{stats.scheduled}</span>
                <span className="ops-stat-desc">Na fila de envio</span>
              </div>
            </div>
          </div>

          {/* Barra de Pastas de Contas (igual à organização do Modo Fluxo) */}
          <div className="panel" style={{ padding: "14px 18px" }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="ig-folder-bar" aria-label="Pastas de contas">
                {["*", "", ...accountFolders].map((f) => {
                  const count = accounts.filter((acc) => {
                    const accFolder = accountMeta[acc.id]?.folder || "";
                    if (f === "*") return true;
                    return accFolder === f;
                  }).length;
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={selectedAccountFolder === f}
                      onClick={() => setSelectedAccountFolder(f)}
                      className={`ig-folder-tag ${selectedAccountFolder === f ? "is-active" : ""}`}
                    >
                      <span>{f === "*" ? "Todas" : f === "" ? "Sem pasta" : f}</span>
                      <span className="opacity-60 text-[10px]">({count})</span>
                    </button>
                  );
                })}

                {selectedAccountFolder !== "*" &&
                  selectedAccountFolder !== "" &&
                  user && (
                    <button
                      type="button"
                      title="Excluir pasta atual"
                      onClick={() => {
                        const folderToRemove = selectedAccountFolder;
                        const nextFolders = accountFolders.filter(
                          (item) => item !== folderToRemove,
                        );
                        setAccountFolders(nextFolders);
                        saveAccountFolders(user.id, nextFolders);
                        const nextMeta: AccountMetaMap = { ...accountMeta };
                        for (const id of Object.keys(nextMeta)) {
                          if (nextMeta[id]?.folder === folderToRemove) {
                            nextMeta[id] = { ...nextMeta[id], folder: "" };
                          }
                        }
                        setAccountMeta(nextMeta);
                        saveAccountMeta(user.id, nextMeta);
                        setSelectedAccountFolder("*");
                        toast.success(`Pasta "${folderToRemove}" excluída.`);
                      }}
                      className="ig-folder-tag text-muted-foreground hover:text-destructive"
                    >
                      Excluir pasta
                    </button>
                  )}

                {addingAccountFolder ? (
                  <form
                    className="inline-flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = newAccountFolderName.trim();
                      if (!user || !trimmed) {
                        setAddingAccountFolder(false);
                        return;
                      }
                      const next = [...new Set([...accountFolders, trimmed])];
                      setAccountFolders(next);
                      saveAccountFolders(user.id, next);
                      setSelectedAccountFolder(trimmed);
                      setNewAccountFolderName("");
                      setAddingAccountFolder(false);
                      toast.success(`Pasta "${trimmed}" criada!`);
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="Nome da nova pasta de contas"
                      placeholder="Nome da pasta"
                      value={newAccountFolderName}
                      maxLength={60}
                      onChange={(e) => setNewAccountFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setAddingAccountFolder(false);
                          setNewAccountFolderName("");
                        }
                      }}
                      className="ops-filter"
                      style={{ height: 28, width: 140, padding: "0 10px", fontSize: 12 }}
                    />
                    <button
                      type="submit"
                      disabled={!newAccountFolderName.trim()}
                      className="button button-secondary"
                      style={{ height: 28, padding: "0 10px", fontSize: 11 }}
                    >
                      Criar
                    </button>
                    <button
                      type="button"
                      aria-label="Cancelar nova pasta"
                      onClick={() => {
                        setAddingAccountFolder(false);
                        setNewAccountFolderName("");
                      }}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingAccountFolder(true)}
                    className="ig-folder-tag ig-folder-add"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    <span>Nova pasta</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Tag className="h-3.5 w-3.5 text-emerald-400" />
                <span>
                  Etiquetador automático ativo: atualiza a cada 24h conforme os dias de operação da conta
                </span>
              </div>
            </div>
          </div>

          <div className="operations-toolbar">
            <label className="ops-select-all">
              <input
                type="checkbox"
                checked={
                  accounts.length > 0 &&
                  opsSelectedIds.length === accounts.length
                }
                onChange={(e) =>
                  setOpsSelectedIds(
                    e.target.checked ? accounts.map((a) => a.id) : [],
                  )
                }
              />
              <span>Selecionar todas ({accounts.length})</span>
            </label>

            <div className="ops-filter-group">
              <label className="ops-filter-label" htmlFor="instagram-filter">
                Filtrar status:
              </label>
              <select
                id="instagram-filter"
                className="ops-filter"
                value={opsFilter}
                onChange={(e) => setOpsFilter(e.target.value)}
              >
                <option value="ALL">Todas as contas</option>
                <option value="CONNECTED">Prontas para publicar</option>
                <option value="REAUTH_REQUIRED">Reconexão necessária</option>
                <option value="PAUSED">Pausadas</option>
              </select>
            </div>

            <div className="ops-batch-actions">
              {opsSelectedIds.length > 0 && (
                <>
                  <select
                    aria-label="Mover contas selecionadas para pasta"
                    value="__placeholder__"
                    onChange={(e) => {
                      const target = e.target.value;
                      if (target === "__placeholder__") return;
                      moveSelectedAccountsToFolder(target);
                    }}
                    className="ops-filter"
                  >
                    <option value="__placeholder__" disabled>
                      Mover selecionadas para pasta…
                    </option>
                    <option value="">Sem pasta</option>
                    {accountFolders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="button button-secondary operation-action text-xs"
                    onClick={() => setOpsSelectedIds([])}
                  >
                    Desmarcar ({opsSelectedIds.length})
                  </button>
                </>
              )}
              <button
                type="button"
                className={`button operation-action ${
                  opsSelectedIds.length > 0 ? "button-primary" : "button-secondary opacity-60"
                }`}
                disabled={opsSelectedIds.length === 0}
                onClick={() => {
                  setReelAccountIds(opsSelectedIds);
                  navigate("/agonia/reels-new");
                }}
              >
                <Film className="h-3.5 w-3.5" />
                Publicar nas selecionadas ({opsSelectedIds.length})
              </button>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div className="empty">
              Nenhuma conta conectada ainda. Use o botão “Conectar conta” acima
              para autorizar seu primeiro perfil.
            </div>
          ) : (
            <div className="operations-grid">
              {accounts
                .filter((acc) => {
                  const link = linkMap.get(acc.id);
                  if (opsFilter === "CONNECTED" && (link?.paused || link?.reconnect_required))
                    return false;
                  if (opsFilter === "REAUTH_REQUIRED" && !link?.reconnect_required)
                    return false;
                  if (opsFilter === "PAUSED" && !link?.paused) return false;

                  const accFolder = accountMeta[acc.id]?.folder || "";
                  if (selectedAccountFolder !== "*" && accFolder !== selectedAccountFolder)
                    return false;

                  return true;
                })
                .map((acc) => {
                  const link = linkMap.get(acc.id);
                  const isSelected = opsSelectedIds.includes(acc.id);
                  const accPosts = posts.filter((p) => p.account_id === acc.id);
                  const todayCount = accPosts.filter(
                    (p) =>
                      p.status === "published" &&
                      isToday(p.published_at || p.created_at),
                  ).length;
                  const queueCount = accPosts.filter(
                    (p) =>
                      p.status === "scheduled" || p.status === "processing",
                  ).length;
                  const days30Count = accPosts.filter(
                    (p) =>
                      p.status === "published" &&
                      isWithinDays(p.published_at || p.created_at, 30),
                  ).length;
                  const failedCount = accPosts.filter(
                    (p) => p.status === "failed" || p.status === "uncertain",
                  ).length;
                  const lastPublished = accPosts.find(
                    (p) => p.status === "published",
                  );
                  const customName =
                    nameDrafts[acc.id] ??
                    accountMeta[acc.id]?.customName ??
                    "";
                  const savedCustomName = accountMeta[acc.id]?.customName?.trim();
                  const currentFolder = accountMeta[acc.id]?.folder || "";
                  const activeDays = getAccountActiveDays(acc);
                  const dayLabel =
                    activeDays === 1 ? "1 dia" : `${activeDays} dias`;
                  const checkedAt = accountMeta[acc.id]?.lastCheckedAt;

                  return (
                    <article
                      key={acc.id}
                      className={`ops-account-card ${isSelected ? "ops-account-card-selected" : ""}`}
                    >
                      <div className="ops-account-head">
                        <label className="ops-check">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) =>
                              setOpsSelectedIds((prev) =>
                                e.target.checked
                                  ? [...prev, acc.id]
                                  : prev.filter((id) => id !== acc.id),
                              )
                            }
                          />
                          <span />
                        </label>
                        <div className="ops-avatar">
                          {(savedCustomName || acc.username).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="ops-account-name">
                          <strong>
                            {savedCustomName
                              ? `${savedCustomName} (@${acc.username})`
                              : `@${acc.username}`}
                          </strong>
                          <small>@{acc.username}</small>
                        </div>
                      </div>

                      <div className="ops-account-status">
                        {link?.reconnect_required ? (
                          <span className="ops-status ops-status-red">
                            Reconexão necessária
                          </span>
                        ) : link?.paused ? (
                          <span className="ops-status ops-status-yellow">
                            Pausada
                          </span>
                        ) : (
                          <span className="ops-status ops-status-green">
                            Ativa
                          </span>
                        )}

                        {/* Etiqueta automática por dias de conta ativa */}
                        <span
                          className="ops-status ops-status-green"
                          title={`Etiqueta automática: conta ativa há ${dayLabel} na ferramenta`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontWeight: 600,
                          }}
                        >
                          <Tag className="h-3 w-3" />
                          {dayLabel}
                        </span>

                        {currentFolder && (
                          <span className="ops-auth-badge">
                            Pasta: {currentFolder}
                          </span>
                        )}
                      </div>

                      {/* Nomear conta */}
                      <div className="ops-model-row">
                        <span>NOME DA CONTA</span>
                        <div>
                          <input
                            aria-label={`Nome personalizado da conta @${acc.username}`}
                            placeholder={`Ex.: Conta Principal (@${acc.username})`}
                            value={customName}
                            onChange={(e) =>
                              setNameDrafts((prev) => ({
                                ...prev,
                                [acc.id]: e.target.value,
                              }))
                            }
                          />
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() =>
                              saveNameForAccount(acc.id, acc.username)
                            }
                          >
                            Salvar
                          </button>
                        </div>
                      </div>

                      {/* Pasta da conta */}
                      <div className="ops-model-row">
                        <span>PASTA</span>
                        <div>
                          <select
                            aria-label={`Pasta da conta @${acc.username}`}
                            value={currentFolder}
                            onChange={(e) =>
                              setFolderForAccount(
                                acc.id,
                                acc.username,
                                e.target.value,
                              )
                            }
                            className="ops-filter"
                            style={{ width: "100%" }}
                          >
                            <option value="">Sem pasta</option>
                            {accountFolders.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="ops-metrics">
                        <div>
                          <strong>{todayCount}</strong>
                          <span>hoje</span>
                        </div>
                        <div>
                          <strong>{queueCount}</strong>
                          <span>fila</span>
                        </div>
                        <div>
                          <strong>{days30Count}</strong>
                          <span>posts 30d</span>
                        </div>
                        <div>
                          <strong>{failedCount}</strong>
                          <span>falhas</span>
                        </div>
                      </div>

                      <div
                        className={`ops-queue ${
                          link?.paused ? "ops-queue-paused" : "ops-queue-ready"
                        }`}
                      >
                        <strong>
                          {link?.paused ? "Fila pausada" : "Fila pronta"}
                        </strong>
                        <span>
                          Próximo post:{" "}
                          {queueCount > 0 ? `${queueCount} na fila` : "aguardando"}
                          . Último publicado:{" "}
                          {lastPublished?.published_at
                            ? new Date(
                                lastPublished.published_at,
                              ).toLocaleDateString("pt-BR")
                            : "nunca"}
                        </span>
                      </div>

                      {checkedAt && (
                        <div className="ops-health-detail">
                          <span>Saúde verificada</span>
                          <span>
                            {new Date(checkedAt).toLocaleString("pt-BR")}
                          </span>
                        </div>
                      )}

                      <div className="ops-card-footer">
                        <span className="ops-mini-badge">
                          {link?.paused ? "pausada" : "conectada"}
                        </span>
                        <button
                          type="button"
                          className="button button-secondary ops-small-button"
                          onClick={() => {
                            setReelAccountIds([acc.id]);
                            navigate("/agonia/reels-new");
                          }}
                        >
                          Publicar Reel
                        </button>
                        <button
                          type="button"
                          className="button button-secondary ops-small-button"
                          style={{ marginLeft: "auto" }}
                          onClick={async () => {
                            try {
                              await publisherRequest("pause", {
                                account_id: acc.id,
                                paused: !link?.paused,
                              });
                              await refreshAll();
                              toast.success(
                                link?.paused
                                  ? `Conta @${acc.username} retomada.`
                                  : `Conta @${acc.username} pausada.`,
                              );
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Erro ao alterar pausa.",
                              );
                            }
                          }}
                        >
                          {link?.paused ? "Retomar" : "Pausar"}
                        </button>
                      </div>
                    </article>
                  );
                })}
            </div>
          )}
        </section>
      )}

      {/* 4. NOVO REEL */}
      {section === "reels-new" && (
        <>
          <header className="topbar">
            <div>
              <Link className="link" to="/agonia/reels">
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar para Reels
              </Link>
              <h1 className="page-title" style={{ marginTop: 12 }}>
                Novo Reel
              </h1>
              <p className="page-subtitle">
                Envie seu vídeo, adicione uma legenda opcional e escolha o
                momento certo.
              </p>
            </div>
            <div className="action-row">
              <Link className="button button-secondary" to="/agonia/fluxos">
                <Layers className="h-4 w-4" /> Usar Modo Fluxo (Biblioteca e Loop)
              </Link>
            </div>
          </header>

          <form onSubmit={handlePublishReels} className="reel-composer">
            <div
              className="panel reel-composer-summary"
              aria-label="Resumo da publicação"
            >
              <div className="reel-summary-item">
                <small>Mídia</small>
                <strong>
                  {reelVideos.length === 0
                    ? "Nenhum vídeo"
                    : `${reelVideos.length} vídeo(s)`}
                </strong>
              </div>
              <div className="reel-summary-item">
                <small>Legenda</small>
                <strong>
                  {reelCaption.trim() || reelVariants.trim()
                    ? `${parseCaptionVariants(reelCaption, reelVariants).length} variação(ões)`
                    : "Sem legenda"}
                </strong>
              </div>
              <div className="reel-summary-item">
                <small>
                  {reelMode === "sequence"
                    ? "Sequência de vídeos"
                    : reelMode === "schedule"
                      ? "Agendamento"
                      : reelMode === "repeat"
                        ? "Repetir vídeo"
                        : "Publicação imediata"}
                </small>
                <strong>
                  {reelMode === "sequence"
                    ? `1º agora, depois a cada ${reelInterval} min`
                    : reelMode === "schedule"
                      ? reelScheduledAt.replace("T", " ")
                      : reelMode === "repeat"
                        ? `${reelRepeatCount}x a cada ${reelInterval} min`
                        : "Assim que enviado"}
                </strong>
              </div>
              <div className="reel-summary-item">
                <small>Contas</small>
                <strong>
                  {reelAccountIds.length} de {accounts.length}
                </strong>
              </div>
            </div>

            <div className="reel-composer-layout">
              <div className="reel-composer-main">
                <section className="panel" aria-labelledby="reel-media-title">
                  <div className="panel-header">
                    <div>
                      <h2 className="panel-title" id="reel-media-title">
                        <span className="reel-step">1</span> Mídia
                      </h2>
                      <p className="panel-copy">
                        Vídeo obrigatório e capa opcional.
                      </p>
                    </div>
                    <Film className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="reel-media-grid">
                    <div className="reel-media-card">
                      <label htmlFor="agonia-video" className="reel-media-label">
                        Vídeos <b className="muted">obrigatório</b>
                      </label>
                      <label className="upload-drop" htmlFor="agonia-video">
                        <input
                          id="agonia-video"
                          type="file"
                          multiple
                          accept="video/mp4,video/quicktime,.mp4,.mov"
                          onChange={(e) =>
                            setReelVideos(Array.from(e.target.files || []))
                          }
                        />
                        <Upload className="h-6 w-6 text-muted-foreground" />
                        <strong>
                          {reelVideos.length > 0
                            ? `${reelVideos.length} vídeo(s) selecionado(s)`
                            : "Escolha os vídeos na ordem da sequência"}
                        </strong>
                        <span className="muted">
                          Até 50 vídeos · o primeiro será publicado agora
                        </span>
                      </label>
                      {reelVideos.length > 0 && (
                        <div className="sequence-file-list">
                          {reelVideos.map((file, idx) => (
                            <span key={`${file.name}-${idx}`}>
                              <strong>
                                {idx + 1}. {file.name}
                              </strong>
                              <small>
                                {(file.size / (1024 * 1024)).toFixed(1)} MB
                              </small>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="reel-media-card">
                      <label htmlFor="agonia-cover" className="reel-media-label">
                        Capa do Reel <span className="muted">(opcional)</span>
                      </label>
                      <label className="upload-drop" htmlFor="agonia-cover">
                        <input
                          id="agonia-cover"
                          type="file"
                          accept="image/jpeg,.jpg,.jpeg"
                          onChange={(e) =>
                            setReelCover(e.target.files?.[0] ?? null)
                          }
                        />
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                        <strong>
                          {reelCover
                            ? reelCover.name
                            : "Escolha uma imagem para a capa"}
                        </strong>
                        <span className="muted">JPG ou JPEG · até 8 MB</span>
                      </label>
                    </div>
                  </div>
                </section>

                <section className="panel" aria-labelledby="reel-caption-title">
                  <div className="panel-header">
                    <div>
                      <h2 className="panel-title" id="reel-caption-title">
                        <span className="reel-step">2</span> Legenda
                      </h2>
                      <p className="panel-copy">
                        Opcional. Se a Meta não aplicar a legenda, o Reel
                        aparece como “Publicado sem legenda” no histórico.
                      </p>
                    </div>
                  </div>
                  <div className="reel-caption-fields">
                    <div className="field">
                      <label htmlFor="agonia-caption">
                        Legenda principal{" "}
                        <span className="muted">
                          (opcional · {reelCaption.length}/2200)
                        </span>
                      </label>
                      <textarea
                        id="agonia-caption"
                        maxLength={2200}
                        value={reelCaption}
                        onChange={(e) => setReelCaption(e.target.value)}
                        placeholder="Escreva a legenda do Reel (opcional)"
                      />
                      <span className="field-help">
                        Se preenchida, será enviada para a Meta. Deixe em branco
                        para publicar sem legenda.
                      </span>
                    </div>
                    <div className="field reel-variants">
                      <label htmlFor="agonia-caption-variants">
                        Variações de legenda{" "}
                        <span className="muted">(opcional)</span>
                      </label>
                      <textarea
                        id="agonia-caption-variants"
                        maxLength={44000}
                        value={reelVariants}
                        onChange={(e) => setReelVariants(e.target.value)}
                        placeholder="Escreva uma variação e separe a próxima com uma linha contendo apenas ---"
                      />
                      <span className="field-help">
                        Separe cada alternativa com <strong>---</strong>. O
                        sistema alterna as variações entre contas e vídeos, sem
                        alterar o texto automaticamente.
                      </span>
                    </div>
                  </div>
                </section>

                <section className="panel" aria-labelledby="reel-publish-title">
                  <div className="panel-header">
                    <div>
                      <h2 className="panel-title" id="reel-publish-title">
                        <span className="reel-step">3</span> Publicação
                      </h2>
                      <p className="panel-copy">
                        Publique agora, agende um Reel, inicie uma sequência ou
                        repita um vídeo.
                      </p>
                    </div>
                    <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="agonia-mode">Quando publicar</label>
                      <select
                        id="agonia-mode"
                        value={reelMode}
                        onChange={(e) =>
                          setReelMode(
                            e.target.value as
                              | "sequence"
                              | "schedule"
                              | "now"
                              | "repeat",
                          )
                        }
                      >
                        <option value="sequence">Sequência de vídeos</option>
                        <option value="schedule">Agendar</option>
                        <option value="now">Publicar agora</option>
                        <option value="repeat">Repetir vídeo</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="agonia-timezone">Timezone</label>
                      <select
                        id="agonia-timezone"
                        value={reelTimezone}
                        onChange={(e) => setReelTimezone(e.target.value)}
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                    {reelMode === "schedule" && (
                      <div className="field form-full">
                        <label htmlFor="agonia-schedule-at">Data e hora</label>
                        <input
                          id="agonia-schedule-at"
                          type="datetime-local"
                          value={reelScheduledAt}
                          onChange={(e) => setReelScheduledAt(e.target.value)}
                        />
                      </div>
                    )}
                    {reelMode === "repeat" && (
                      <div className="field form-full">
                        <label htmlFor="agonia-repeat-count">
                          Quantas vezes repetir o vídeo
                        </label>
                        <input
                          id="agonia-repeat-count"
                          type="number"
                          min={2}
                          max={20}
                          value={reelRepeatCount}
                          onChange={(e) =>
                            setReelRepeatCount(Number(e.target.value))
                          }
                        />
                      </div>
                    )}
                    <div className="field form-full">
                      <label htmlFor="agonia-sequence-interval">
                        Intervalo entre vídeos (minutos)
                      </label>
                      <input
                        id="agonia-sequence-interval"
                        type="number"
                        min={0}
                        max={1440}
                        step={1}
                        value={reelInterval}
                        onChange={(e) =>
                          setReelInterval(Number(e.target.value))
                        }
                      />
                      <span className="field-help">
                        O primeiro vídeo entra na fila agora. Os seguintes serão
                        agendados a cada {reelInterval} minuto(s).
                      </span>
                    </div>
                  </div>
                </section>
              </div>

              <aside className="reel-composer-aside">
                <section
                  className="panel reel-destination"
                  aria-labelledby="reel-destination-title"
                >
                  <div className="panel-header">
                    <div>
                      <h2 className="panel-title" id="reel-destination-title">
                        <span className="reel-step">4</span> Destino
                      </h2>
                      <p className="panel-copy">
                        App Meta e contas que vão receber o Reel.
                      </p>
                    </div>
                  </div>

                  <div className="reel-destination-app">
                    <div className="meta-app-picker">
                      <span className="meta-app-picker-label">
                        App Meta para publicar
                      </span>
                      <select
                        className="ops-filter"
                        value={activeMetaApp?.id || ""}
                        onChange={(e) => setSelectedAppId(e.target.value)}
                      >
                        {metaApps.map((app) => (
                          <option key={app.id} value={app.id}>
                            {app.name} ({accounts.length})
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="field-help">
                      Somente as contas vinculadas ao app escolhido aparecem
                      abaixo.
                    </span>
                  </div>

                  <div className="field">
                    <div className="reel-accounts-head">
                      <label>Contas do Instagram</label>
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          setReelAccountIds(
                            reelAccountIds.length === accounts.length
                              ? []
                              : accounts.map((a) => a.id),
                          )
                        }
                      >
                        {reelAccountIds.length === accounts.length
                          ? "Desmarcar todas"
                          : "Selecionar todas"}
                      </button>
                    </div>
                    <p className="muted reel-accounts-count">
                      {reelAccountIds.length} de {accounts.length} conta(s)
                      selecionadas
                    </p>
                    {accounts.length === 0 ? (
                      <div className="empty">Nenhuma conta conectada.</div>
                    ) : (
                      <div className="account-list">
                        {accounts.map((acc) => {
                          const checked = reelAccountIds.includes(acc.id);
                          const model =
                            accountMeta[acc.id]?.modelName || "MEDIA_CREATOR";
                          return (
                            <label key={acc.id} className="account-option">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setReelAccountIds((prev) =>
                                    e.target.checked
                                      ? [...prev, acc.id]
                                      : prev.filter((id) => id !== acc.id),
                                  )
                                }
                              />
                              <span>
                                <strong>@{acc.username}</strong>
                                <small>{model}</small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>

                <div className="panel reel-submit-panel">
                  <p className="field-help">
                    {reelProgress
                      ? reelProgress
                      : reelVideos.length === 0
                        ? "Para continuar: escolha o vídeo."
                        : `Pronto para enviar para ${reelAccountIds.length} conta(s).`}
                  </p>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={
                      reelBusy ||
                      reelVideos.length === 0 ||
                      reelAccountIds.length === 0
                    }
                  >
                    {reelBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {reelMode === "sequence"
                      ? `Iniciar sequência (${reelVideos.length * reelAccountIds.length})`
                      : reelMode === "schedule"
                        ? "Agendar Reel"
                        : "Publicar agora"}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => navigate("/agonia")}
                  >
                    Cancelar
                  </button>
                </div>
              </aside>
            </div>
          </form>
        </>
      )}

      {/* 5. STORIES */}
      {section === "stories" && (
        <>
          <header className="topbar stories-topbar">
            <div>
              <Link className="link" to="/agonia">
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar para Dashboard
              </Link>
              <div className="eyebrow" style={{ marginTop: 14 }}>
                Painel operacional
              </div>
              <h1 className="page-title" style={{ marginTop: 4 }}>
                Stories
              </h1>
              <p className="page-subtitle">
                Publique imagens e vídeos em todas as contas conectadas.
              </p>
            </div>
            <div className="stories-top-status">
              <span>● Instagram conectado</span>
              <Link className="button button-secondary" to="/agonia/instagram">
                Gerenciar contas
              </Link>
            </div>
          </header>

          <div className="stories-layout">
            <main>
              <div className="notice">
                Cada conta conectada aparece aqui e pode ser selecionada para
                publicar. A autorização individual e os limites da Meta
                continuam sendo respeitados.
              </div>
              <form
                onSubmit={handlePublishStories}
                className="grid"
                style={{ gap: 18 }}
              >
                <div className="panel stories-app-filter">
                  <div className="meta-app-picker">
                    <span className="meta-app-picker-label">
                      App Meta para publicar Stories
                    </span>
                    <select
                      className="ops-filter"
                      value={activeMetaApp?.id || ""}
                      onChange={(e) => setSelectedAppId(e.target.value)}
                    >
                      {metaApps.map((app) => (
                        <option key={app.id} value={app.id}>
                          {app.name} ({accounts.length})
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="field-help">
                    Selecione um app para exibir somente as contas vinculadas a
                    ele.
                  </span>
                </div>

                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <h2 className="panel-title">Conteúdo do Story</h2>
                      <p className="panel-copy">
                        Publique uma imagem ou vídeo nas contas Business
                        selecionadas.
                      </p>
                    </div>
                  </div>
                  <div className="form-grid">
                    <div className="field form-full">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <label>Contas do Instagram</label>
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            setStoryAccountIds(
                              storyAccountIds.length === accounts.length
                                ? []
                                : accounts.map((a) => a.id),
                            )
                          }
                        >
                          {storyAccountIds.length === accounts.length
                            ? "Desmarcar todas"
                            : "Selecionar todas"}
                        </button>
                      </div>
                      <p className="muted" style={{ margin: "4px 0 10px" }}>
                        {storyAccountIds.length} de {accounts.length} conta(s)
                        disponíveis
                      </p>
                      <div className="stories-account-panel">
                        <div className="stories-account-heading">
                          <strong>Todas as contas conectadas</strong>
                          <span>{accounts.length} disponível(is)</span>
                        </div>
                        {accounts.length === 0 ? (
                          <div className="empty">Nenhuma conta conectada.</div>
                        ) : (
                          <div
                            className="account-list"
                            style={{ padding: 10 }}
                          >
                            {accounts.map((acc) => (
                              <label key={acc.id} className="account-option">
                                <input
                                  type="checkbox"
                                  checked={storyAccountIds.includes(acc.id)}
                                  onChange={(e) =>
                                    setStoryAccountIds((prev) =>
                                      e.target.checked
                                        ? [...prev, acc.id]
                                        : prev.filter((id) => id !== acc.id),
                                    )
                                  }
                                />
                                <span>
                                  <strong>@{acc.username}</strong>
                                  <small>
                                    MEDIA_CREATOR · pronta para publicar
                                  </small>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="field form-full">
                      <label htmlFor="story-media">Imagem ou vídeo</label>
                      <label className="upload-drop" htmlFor="story-media">
                        <input
                          id="story-media"
                          type="file"
                          accept="image/jpeg,image/png,video/mp4,video/quicktime,.jpg,.jpeg,.png,.mp4,.mov"
                          onChange={(e) =>
                            setStoryFile(e.target.files?.[0] ?? null)
                          }
                        />
                        <Upload className="h-6 w-6 text-muted-foreground" />
                        <strong>
                          {storyFile
                            ? storyFile.name
                            : "Escolha uma imagem ou vídeo"}
                        </strong>
                        <span className="muted">
                          JPG, PNG, MP4 ou MOV · até 100 MB
                        </span>
                      </label>
                    </div>

                    <div className="form-full">
                      <div className="notice" style={{ marginBottom: 0 }}>
                        Stories não têm legenda de publicação neste fluxo. Para
                        Stories com sticker de link clicável, acesse{" "}
                        <Link className="link" to="/agonia/stories-link">
                          Storys Com Link
                        </Link>
                        .
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <h2 className="panel-title">Publicação</h2>
                      <p className="panel-copy">
                        Publique agora ou agende o Story para as contas
                        selecionadas.
                      </p>
                    </div>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="story-mode">Quando publicar</label>
                      <select
                        id="story-mode"
                        value={storyMode}
                        onChange={(e) =>
                          setStoryMode(e.target.value as "now" | "schedule")
                        }
                      >
                        <option value="now">Publicar agora</option>
                        <option value="schedule">Agendar</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="story-timezone">Timezone</label>
                      <select
                        id="story-timezone"
                        value={storyTimezone}
                        onChange={(e) => setStoryTimezone(e.target.value)}
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                    {storyMode === "schedule" && (
                      <div className="field form-full">
                        <label htmlFor="story-schedule-at">Data e hora</label>
                        <input
                          id="story-schedule-at"
                          type="datetime-local"
                          value={storyScheduledAt}
                          onChange={(e) => setStoryScheduledAt(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setStoryFile(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={
                      storyBusy || !storyFile || storyAccountIds.length === 0
                    }
                  >
                    {storyBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Publicar Story em {storyAccountIds.length} conta(s)
                  </button>
                </div>
              </form>
            </main>

            <aside className="stories-sidebar">
              <section className="panel stories-summary">
                <div className="eyebrow">Resumo</div>
                <h2>Stories hoje</h2>
                <div className="stories-stat-grid">
                  <div>
                    <strong>
                      {
                        posts.filter(
                          (p) =>
                            p.format === "Story" &&
                            p.status === "published" &&
                            isToday(p.published_at || p.created_at),
                        ).length
                      }
                    </strong>
                    <span>publicados</span>
                  </div>
                  <div>
                    <strong>{accounts.length}</strong>
                    <span>contas conectadas</span>
                  </div>
                </div>
                <Link
                  className="button button-secondary"
                  style={{ width: "100%" }}
                  to="/agonia/reels"
                >
                  Ver publicações
                </Link>
              </section>

              <section className="panel stories-live">
                <div className="eyebrow">Disponibilidade</div>
                <h2>Pronto para publicar</h2>
                <p className="muted" style={{ fontSize: 12 }}>
                  Escolha um app Meta para exibir somente as contas vinculadas a
                  ele.
                </p>
                <div className="stories-live-ok">
                  <CheckCircle2 className="h-4 w-4" /> {accounts.length} conta(s)
                  disponível(is)
                </div>
              </section>

              <section className="panel stories-history">
                <div className="eyebrow">Histórico</div>
                <h2>Últimos Stories</h2>
                {posts.filter((p) => p.format === "Story").length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    Nenhum Story enviado recentemente.
                  </p>
                ) : (
                  <div className="stories-history-list">
                    {posts
                      .filter((p) => p.format === "Story")
                      .slice(0, 5)
                      .map((p) => (
                        <div key={p.id}>
                          <strong>
                            @{accountNames.get(p.account_id) || "conta"}
                          </strong>
                          <span>
                            {p.media_urls[0]?.split("/").pop() || "story"}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </section>
            </aside>
          </div>
        </>
      )}

      {/* 6. STORYS COM LINK */}
      {section === "stories-link" && (
        <div className="story-link-page">
          <header className="story-link-topbar">
            <div>
              <div className="eyebrow">Painel operacional</div>
              <h1 className="page-title">Storys Com Link</h1>
            </div>
            <div className="story-link-top-status">
              <span>Extensão para navegador</span>
              <span className="story-link-status-ok">
                ● Instagram conectado
              </span>
            </div>
          </header>

          <section className="story-link-hero panel">
            <div className="story-link-hero-copy">
              <div className="story-link-kicker">
                <Link2 className="h-3.5 w-3.5" /> EXTENSÃO PARA NAVEGADOR
              </div>
              <h2>Storys Com Link</h2>
              <h3>
                Stories com link pelo navegador, feitos direto no Instagram Web.
              </h3>
              <p>
                Publique Stories com link clicável e personalize o sticker
                diretamente no Instagram Web com suporte a postar em todas as contas conectadas simultaneamente.
              </p>
              <a
                className="button button-primary"
                href="/extensions/storys-com-link.zip"
                download
              >
                <Download className="h-4 w-4" /> Baixar extensão Storys Com Link (v0.8.0)
              </a>
              <span className="story-link-version">
                <CheckCircle2 className="h-3.5 w-3.5" /> Versão 0.8.0 (Multi-Contas) pronta
                para Chrome e Edge
              </span>
            </div>
            <div className="story-link-mark">
              <Link2 className="h-16 w-16" />
            </div>
          </section>

          <div className="story-link-features">
            <div>
              <ImageIcon className="h-5 w-5" />
              <strong>Imagens</strong>
              <span>JPG, PNG e WEBP até 20 MB</span>
            </div>
            <div>
              <Link2 className="h-5 w-5" />
              <strong>Sticker clicável</strong>
              <span>Texto, estilo, tamanho e posição</span>
            </div>
            <div>
              <Users className="h-5 w-5" />
              <strong>Multi-contas simultâneo</strong>
              <span>Poste em todas as contas conectadas de uma vez</span>
            </div>
          </div>

          <section className="story-link-section">
            <div className="story-link-section-heading">
              <span>01</span>
              <div>
                <h2>Instalação</h2>
                <p>
                  Faça uma vez em cada navegador ou perfil do Chrome e Edge.
                </p>
              </div>
            </div>
            <div className="story-link-step-grid">
              {[
                [
                  "1",
                  "Baixe o ZIP",
                  "Use o botão acima para baixar a extensão Storys Com Link.",
                ],
                [
                  "2",
                  "Extraia em uma pasta permanente",
                  "Não apague essa pasta depois da instalação.",
                ],
                [
                  "3",
                  "Abra a página de extensões",
                  "Digite chrome://extensions no Chrome ou edge://extensions no Edge.",
                ],
                [
                  "4",
                  "Ative o modo desenvolvedor",
                  "O botão fica no canto superior da página de extensões.",
                ],
                [
                  "5",
                  "Carregue a pasta extraída",
                  "Clique em Carregar sem compactação e selecione a pasta com o manifest.json.",
                ],
                [
                  "6",
                  "Abra o Instagram",
                  "Entre na conta desejada ou conecte várias contas no Instagram Web para postar em todas simultaneamente.",
                ],
              ].map(([num, title, desc]) => (
                <article key={num} className="story-link-step">
                  <b>{num}</b>
                  <div>
                    <strong>{title}</strong>
                    <p>{desc}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="story-link-section">
            <div className="story-link-section-heading">
              <span>02</span>
              <div>
                <h2>Como publicar</h2>
                <p>A extensão abre a criação do Story dentro do Instagram.</p>
              </div>
            </div>
            <div className="story-link-publish-grid">
              {[
                [
                  "1",
                  "Abra Storys Com Link",
                  "Clique no ícone da extensão na barra. O editor será aberto no Instagram Web.",
                ],
                [
                  "2",
                  "Comece a criar",
                  "Clique em Publicar Story para acessar o editor.",
                ],
                [
                  "3",
                  "Escolha a imagem e o link",
                  "Selecione uma imagem e informe o endereço que ficará no sticker clicável.",
                ],
                [
                  "4",
                  "Personalize o sticker",
                  "Ajuste o texto, o estilo, o tamanho e arraste o sticker para a posição desejada.",
                ],
                [
                  "5",
                  "Opcional: crie um Destaque",
                  "Marque a opção, defina o título e o Story será adicionado ao perfil.",
                ],
                [
                  "6",
                  "Publique e confirme",
                  "Clique em Publicar Story e aguarde a mensagem de conclusão.",
                ],
              ].map(([num, title, desc]) => (
                <article key={num} className="story-link-step">
                  <b>{num}</b>
                  <div>
                    <strong>{title}</strong>
                    <p>{desc}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="notice story-link-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <strong>Esta versão publica apenas imagens.</strong>
              <br />
              Vídeos e música ainda não estão disponíveis nesta extensão.
            </span>
          </div>

          <div className="story-link-footer">
            <Link className="link" to="/agonia/stories">
              Voltar para Stories
            </Link>
            <span>
              <CheckCircle2 className="h-3.5 w-3.5" /> O texto e o estilo são
              aplicados na composição visual.
            </span>
            <span>
              <CheckCircle2 className="h-3.5 w-3.5" /> O destino é enviado como
              sticker clicável.
            </span>
            <span>
              <CheckCircle2 className="h-3.5 w-3.5" /> O Destaque é opcional.
            </span>
          </div>
        </div>
      )}

      {/* 7. AGENDAMENTOS */}
      {section === "scheduled" && (
        <>
          <header className="topbar">
            <div>
              <div className="eyebrow">Fila persistente</div>
              <h1 className="page-title">Agendamentos</h1>
              <p className="page-subtitle">
                Jobs persistentes no servidor, sem depender de setTimeout no
                navegador.
              </p>
            </div>
            <div className="actions">
              <Link className="button button-secondary" to="/agonia/stories">
                Novo Story
              </Link>
              <Link className="button button-primary" to="/agonia/reels-new">
                Novo Reel
              </Link>
              <button
                type="button"
                className="button button-danger"
                disabled={stats.scheduled === 0}
                onClick={async () => {
                  if (!user) return;
                  const pending = posts.filter((p) => p.status === "scheduled");
                  for (const post of pending) {
                    try {
                      await cancelPost(post, user.id);
                    } catch {
                      /* ignore */
                    }
                  }
                  await refreshAll();
                  toast.success("Registros agendados cancelados.");
                }}
              >
                <Trash2 className="h-4 w-4" /> Apagar registros
              </button>
            </div>
          </header>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Próximos jobs</h2>
                <p className="panel-copy">
                  Escolha um App Meta ou uma conta para visualizar e cancelar
                  somente a fila desejada.
                </p>
              </div>
            </div>

            <div className="schedule-filters">
              <div className="field">
                <label htmlFor="scheduled-app-filter">App Meta</label>
                <select
                  id="scheduled-app-filter"
                  value={schedAppFilter}
                  onChange={(e) => setSchedAppFilter(e.target.value)}
                >
                  <option value="">Todos os apps</option>
                  {metaApps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="scheduled-account-filter">Conta</label>
                <select
                  id="scheduled-account-filter"
                  value={schedAccountFilter}
                  onChange={(e) => setSchedAccountFilter(e.target.value)}
                >
                  <option value="">Todas as contas</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      @{acc.username}
                    </option>
                  ))}
                </select>
              </div>
              <div className="schedule-filter-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setSchedAppFilter("");
                    setSchedAccountFilter("");
                  }}
                >
                  Limpar filtros
                </button>
              </div>
            </div>

            {(() => {
              const filtered = posts.filter(
                (p) =>
                  (p.status === "scheduled" || p.status === "processing") &&
                  (!schedAccountFilter || p.account_id === schedAccountFilter),
              );
              return (
                <>
                  <p className="schedule-filter-summary">
                    Exibindo <strong>{filtered.length}</strong> job(s) na fila
                  </p>
                  {filtered.length === 0 ? (
                    <div className="empty">
                      Nenhum job pendente para os filtros selecionados.
                    </div>
                  ) : (
                    <div className="list">
                      {filtered.map((post) => (
                        <div key={post.id} className="list-row">
                          <div className="list-main">
                            <strong>
                              @{accountNames.get(post.account_id) || "conta"}
                            </strong>
                            <span>
                              {post.format}:{" "}
                              {post.caption ||
                                post.media_urls[0]?.split("/").pop() ||
                                "Sem legenda"}
                            </span>
                            <span className="schedule-app-label">
                              App Meta: {activeMetaApp?.name || "Principal"}
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            {statusBadge(post.status)}
                            <span className="muted" style={{ fontSize: 12 }}>
                              {post.scheduled_at
                                ? new Date(post.scheduled_at).toLocaleString(
                                    "pt-BR",
                                  )
                                : "Agora"}
                            </span>
                            {post.status === "scheduled" && (
                              <button
                                type="button"
                                className="button button-secondary"
                                style={{ padding: "7px 11px", fontSize: 12 }}
                                onClick={async () => {
                                  if (!user) return;
                                  try {
                                    await cancelPost(post, user.id);
                                    await refreshAll();
                                    toast.success("Agendamento cancelado.");
                                  } catch (err) {
                                    toast.error(
                                      err instanceof Error
                                        ? err.message
                                        : "Erro ao cancelar.",
                                    );
                                  }
                                }}
                              >
                                Cancelar
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </section>
        </>
      )}

      {/* 8. PUBLICADOS (BIBLIOTECA) */}
      {section === "reels" && (
        <>
          <header className="topbar">
            <div>
              <div className="eyebrow">Biblioteca</div>
              <h1 className="page-title">Publicações</h1>
              <p className="page-subtitle">
                Histórico de Reels, Stories, status da Meta e tentativas de
                publicação.
              </p>
            </div>
            <div className="actions">
              <Link className="button button-secondary" to="/agonia/reels-test">
                Publicar Reel de teste
              </Link>
              <Link className="button button-secondary" to="/agonia/stories">
                Novo Story
              </Link>
              <Link className="button button-primary" to="/agonia/reels-new">
                Novo Reel
              </Link>
            </div>
          </header>

          <section className="panel">
            <div className="toolbar">
              <div className="filter-tabs">
                {(
                  [
                    ["all", "Todos"],
                    ["scheduled", "Agendados"],
                    ["published", "Publicados"],
                    ["failed", "Falharam"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`filter-tab ${pubTab === key ? "active" : ""}`}
                    onClick={() => {
                      setPubTab(key);
                      setPubPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const filtered = posts.filter((p) => {
                if (pubTab === "scheduled")
                  return p.status === "scheduled" || p.status === "processing";
                if (pubTab === "published") return p.status === "published";
                if (pubTab === "failed")
                  return p.status === "failed" || p.status === "uncertain";
                return true;
              });
              const pageSize = 25;
              const totalPages = Math.max(
                1,
                Math.ceil(filtered.length / pageSize),
              );
              const slice = filtered.slice(
                (pubPage - 1) * pageSize,
                pubPage * pageSize,
              );

              return (
                <>
                  {slice.length === 0 ? (
                    <div className="empty">
                      Nenhum registro encontrado neste filtro.
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Conteúdo</th>
                            <th>Conta</th>
                            <th>Agendado</th>
                            <th>Publicado</th>
                            <th>Status</th>
                            <th>Resultado</th>
                            <th>Ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slice.map((post) => (
                            <tr key={post.id}>
                              <td>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                  }}
                                >
                                  <span className="video-thumb">
                                    <Film className="h-4 w-4" />
                                  </span>
                                  <span
                                    style={{
                                      maxWidth: 220,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    <strong>{post.format}:</strong>{" "}
                                    {post.caption ||
                                      post.media_urls[0]?.split("/").pop() ||
                                      "Sem legenda"}
                                  </span>
                                </div>
                              </td>
                              <td>
                                @{accountNames.get(post.account_id) || "conta"}
                              </td>
                              <td>
                                {post.scheduled_at
                                  ? new Date(post.scheduled_at).toLocaleString(
                                      "pt-BR",
                                    )
                                  : "—"}
                              </td>
                              <td>
                                {post.published_at
                                  ? new Date(post.published_at).toLocaleString(
                                      "pt-BR",
                                    )
                                  : "—"}
                              </td>
                              <td>{statusBadge(post.status)}</td>
                              <td className="muted">
                                {post.status === "published"
                                  ? `${post.format} publicado pela Meta.`
                                  : post.error_code
                                    ? `Erro: ${post.error_code}`
                                    : "Aguardando processamento"}
                              </td>
                              <td>
                                {post.status === "scheduled" ? (
                                  <button
                                    type="button"
                                    className="button button-secondary"
                                    style={{ padding: "6px 10px", fontSize: 11 }}
                                    onClick={async () => {
                                      if (!user) return;
                                      await cancelPost(post, user.id);
                                      await refreshAll();
                                      toast.success("Cancelado.");
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="pagination">
                    <span className="muted">
                      Página {pubPage} de {totalPages} · {filtered.length}{" "}
                      registro(s)
                    </span>
                    <div className="pagination-actions">
                      <button
                        type="button"
                        disabled={pubPage <= 1}
                        onClick={() => setPubPage((p) => Math.max(1, p - 1))}
                        className="button button-secondary"
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        disabled={pubPage >= totalPages}
                        onClick={() =>
                          setPubPage((p) => Math.min(totalPages, p + 1))
                        }
                        className="button button-secondary"
                      >
                        Próxima
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </section>
        </>
      )}

      {/* 9. DIAGNÓSTICO DE PUBLICAÇÃO (REELS TEST) */}
      {section === "reels-test" && (
        <>
          <header className="topbar">
            <div>
              <Link className="link" to="/agonia/reels">
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar para Publicações
              </Link>
              <h1 className="page-title" style={{ marginTop: 12 }}>
                Diagnóstico de publicação
              </h1>
              <p className="page-subtitle">
                Verifique upload, container, publicação e confirmação da legenda
                em uma conta por vez.
              </p>
            </div>
          </header>

          <div className="notice">
            Este modo mantém o fluxo oficial e a forma atual de conexão das
            contas. Não altera credenciais e não publica em lote.
          </div>

          <form
            onSubmit={handleRunDiagnostic}
            className="grid"
            style={{ gap: 18 }}
          >
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Teste isolado de publicação</h2>
                  <p className="panel-copy">
                    O teste cria uma publicação real em apenas uma conta e
                    registra cada etapa da Meta.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <div className="field form-full">
                  <label htmlFor="diagnostic-account">Conta de teste</label>
                  <select
                    id="diagnostic-account"
                    value={diagAccountId}
                    onChange={(e) => setDiagAccountId(e.target.value)}
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        @{acc.username} · MEDIA_CREATOR · Instagram Login
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field form-full">
                  <label htmlFor="diagnostic-video">Vídeo</label>
                  <label className="upload-drop" htmlFor="diagnostic-video">
                    <input
                      id="diagnostic-video"
                      type="file"
                      accept="video/mp4,video/quicktime,.mp4,.mov"
                      onChange={(e) =>
                        setDiagVideo(e.target.files?.[0] ?? null)
                      }
                    />
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <strong>
                      {diagVideo
                        ? diagVideo.name
                        : "Escolha um vídeo real para o teste"}
                    </strong>
                    <span className="muted">
                      Use um vídeo seguro da sua pasta de vídeos.
                    </span>
                  </label>
                </div>
                <div className="field form-full">
                  <label htmlFor="diagnostic-caption">
                    Legenda do teste{" "}
                    <span className="muted">({diagCaption.length}/2200)</span>
                  </label>
                  <textarea
                    id="diagnostic-caption"
                    maxLength={2200}
                    value={diagCaption}
                    onChange={(e) => setDiagCaption(e.target.value)}
                  />
                </div>
              </div>

              {diagSteps.length > 0 && (
                <div className="diagnostic-steps" style={{ marginTop: 18 }}>
                  {diagSteps.map((step, i) => (
                    <div
                      key={i}
                      className={`diagnostic-step ${step.done ? "done" : ""}`}
                    >
                      <span className="diagnostic-step-icon">
                        {step.done ? "✓" : i + 1}
                      </span>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="actions">
              <button
                type="submit"
                className="button button-primary"
                disabled={diagBusy || !diagAccountId || !diagVideo}
              >
                {diagBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Publicar Reel de teste
              </button>
            </div>
          </form>
        </>
      )}

      {/* 10. CONFIGURAÇÕES */}
      {section === "settings" && (
        <>
          <header className="topbar">
            <div>
              <div className="eyebrow">Conta</div>
              <h1 className="page-title">Configurações</h1>
              <p className="page-subtitle">
                Controle seu timezone e mantenha sua rotina de publicação
                consistente.
              </p>
            </div>
          </header>

          <div className="settings-stack">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Preferências de publicação</h2>
                  <p className="panel-copy">
                    Defina o comportamento padrão da sua fila.
                  </p>
                </div>
              </div>
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="settings-timezone">Timezone padrão</label>
                  <select
                    id="settings-timezone"
                    value={settings.timezone}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, timezone: e.target.value }))
                    }
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                  <span className="field-help">
                    Usado para interpretar os horários agendados.
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="settings-interval">
                    Intervalo padrão entre posts (minutos)
                  </label>
                  <input
                    id="settings-interval"
                    type="number"
                    min={0}
                    max={1440}
                    value={settings.intervalMinutes}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        intervalMinutes: Number(e.target.value),
                      }))
                    }
                  />
                  <span className="field-help">
                    O intervalo mínimo continua sujeito aos limites da Meta.
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="settings-limit">
                    Limite diário por usuário
                  </label>
                  <input
                    id="settings-limit"
                    type="number"
                    min={0}
                    max={10000}
                    value={settings.dailyLimit ?? 0}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        dailyLimit: Number(e.target.value),
                      }))
                    }
                  />
                  <span className="field-help">
                    Use 0 para deixar sem limite.
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="settings-retries">
                    Tentativas automáticas
                  </label>
                  <input
                    id="settings-retries"
                    type="number"
                    min={1}
                    max={5}
                    value={settings.maxRetries ?? 3}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        maxRetries: Number(e.target.value),
                      }))
                    }
                  />
                  <span className="field-help">
                    Falhas temporárias serão tentadas novamente.
                  </span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Legenda padrão e proteção</h2>
                  <p className="panel-copy">
                    Essas opções ajudam a manter a operação consistente.
                  </p>
                </div>
              </div>
              <div className="field">
                <label htmlFor="settings-caption">
                  Legenda padrão dos Reels
                </label>
                <textarea
                  id="settings-caption"
                  maxLength={2200}
                  value={settings.defaultCaption}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      defaultCaption: e.target.value,
                    }))
                  }
                  placeholder="Digite uma legenda que será preenchida automaticamente nos novos Reels"
                />
                <span className="field-help">
                  Você ainda poderá editar a legenda antes de publicar.
                </span>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.pauseOnRepeatedFailures ?? true}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      pauseOnRepeatedFailures: e.target.checked,
                    }))
                  }
                />
                <span>
                  <strong>Pausar contas com falhas repetidas</strong>
                  <small>
                    Evita continuar enviando para uma conta que precisa de
                    atenção.
                  </small>
                </span>
              </label>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    if (!user) return;
                    const normalized = {
                      ...settings,
                      intervalMinutes: clampInterval(settings.intervalMinutes),
                    };
                    setSettings(normalized);
                    saveSettings(user.id, normalized);
                    toast.success("Configurações salvas com sucesso!");
                  }}
                >
                  Salvar configurações
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 11. MEU PERFIL */}
      {section === "profile" && (
        <>
          <header className="topbar">
            <div>
              <div className="eyebrow">Conta</div>
              <h1 className="page-title">Meu Perfil</h1>
              <p className="page-subtitle">
                Personalize seu nome e sua foto no AGONIA PRO.
              </p>
            </div>
          </header>

          <div className="panel profile-form">
            <div className="profile-preview-wrap">
              <div className="profile-preview">
                {profile.avatarDataUrl ? (
                  <img
                    alt="Sua foto de perfil"
                    width={96}
                    height={96}
                    src={profile.avatarDataUrl}
                  />
                ) : (
                  profile.username.slice(0, 2).toUpperCase()
                )}
              </div>
              <span className="profile-preview-label">Pré-visualização</span>
            </div>

            <div className="profile-fields">
              <div className="profile-form-heading">
                <div>
                  <h2>Dados do perfil</h2>
                  <p>Atualize como seu perfil aparece na plataforma.</p>
                </div>
              </div>

              <label className="profile-field">
                <span className="profile-field-label">
                  Nome de usuário <em>editável</em>
                </span>
                <small>
                  Você pode alterar esse nome quando quiser. Ele será exibido no
                  menu e no cabeçalho.
                </small>
                <input
                  type="text"
                  maxLength={80}
                  placeholder="Digite seu nome"
                  value={profile.username}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, username: e.target.value }))
                  }
                />
              </label>

              <label className="profile-field">
                <span>Foto de perfil</span>
                <small>
                  Escolha uma imagem PNG, JPG ou WebP de até 1,5 MB.
                </small>
                <input
                  className="profile-file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1.5 * 1024 * 1024) {
                      toast.error("Escolha uma imagem de até 1,5 MB.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === "string") {
                        setProfile((p) => ({
                          ...p,
                          avatarDataUrl: reader.result as string,
                        }));
                      }
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>

              <div className="profile-actions">
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => {
                    if (!user) return;
                    saveAgoniaProfile(user.id, profile);
                    toast.success("Perfil atualizado!");
                  }}
                >
                  Salvar perfil
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    if (!user) return;
                    const next = { ...profile, avatarDataUrl: "" };
                    setProfile(next);
                    saveAgoniaProfile(user.id, next);
                    toast.success("Foto removida.");
                  }}
                >
                  Remover foto
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
