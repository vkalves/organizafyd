import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, CheckCircle2, Clapperboard, Download, Images, LayoutDashboard,
  Link2, Loader2, Settings, Users, Send, PauseCircle, PlayCircle, ShieldCheck, LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConnectAccount } from "@/features/instagram-publisher/ConnectAccount";
import { LocalMediaPreviews } from "@/features/instagram-publisher/LocalMediaPreviews";
import { MediaPreview } from "@/features/instagram-publisher/MediaPreview";
import { publishedToday } from "@/features/instagram-publisher/HotfyDashboard";
import { playConfirmation, unlockAudio } from "@/features/instagram-publisher/sound";
import {
  cancelPost, connections, listAccounts, listPosts, publisherRequest, savePost, uploadMedia,
} from "@/features/instagram-publisher/api";
import type { Connection } from "@/features/instagram-publisher/api";
import type { Format, Post } from "@/features/instagram-publisher/model";
import {
  TIMEZONES, buildSchedule, clampInterval, loadSettings, localToUtcIso, saveSettings,
  type AgoniaSettings,
} from "@/features/agonia/schedule";
import "@/features/agonia/agonia.css";

type Account = { id: string; username: string };

const TABS = [
  { slug: "", label: "Dashboard", icon: LayoutDashboard },
  { slug: "modelos", label: "Modelos", icon: Users },
  { slug: "reels", label: "Novo Reel", icon: Clapperboard },
  { slug: "stories", label: "Stories", icon: Images },
  { slug: "stories-link", label: "Stories com link", icon: Link2 },
  { slug: "agendamentos", label: "Agendamentos", icon: CalendarClock },
  { slug: "publicados", label: "Publicados", icon: CheckCircle2 },
  { slug: "config", label: "Configurações", icon: Settings },
] as const;

const STATUS: Record<Post["status"], { label: string; tone: "ok" | "warn" | "bad" | "" }> = {
  draft: { label: "Rascunho", tone: "" },
  waiting_integration: { label: "Revisar e agendar", tone: "warn" },
  cancelled: { label: "Cancelado", tone: "" },
  scheduled: { label: "Agendado", tone: "warn" },
  processing: { label: "Processando", tone: "warn" },
  published: { label: "Publicado", tone: "ok" },
  failed: { label: "Falhou", tone: "bad" },
  uncertain: { label: "Conferir no Instagram", tone: "bad" },
};

const fmtDate = (iso: string | null | undefined, tz: string) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }) : "—";

function useAgonia() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const accountsQ = useQuery({ queryKey: ["instagram-publisher-accounts", user?.id], queryFn: () => listAccounts(user!.id), enabled: !!user });
  const postsQ = useQuery({ queryKey: ["instagram-publisher", user?.id], queryFn: () => listPosts(user!.id), enabled: !!user, refetchInterval: 30000 });
  const linksQ = useQuery({ queryKey: ["ig-connections", user?.id], queryFn: connections, enabled: !!user, refetchInterval: 30000 });
  const refresh = () => Promise.all([
    cache.invalidateQueries({ queryKey: ["instagram-publisher-accounts", user?.id] }),
    cache.invalidateQueries({ queryKey: ["instagram-publisher", user?.id] }),
    cache.invalidateQueries({ queryKey: ["ig-connections", user?.id] }),
  ]);
  return {
    user, refresh,
    accounts: (accountsQ.data ?? []) as Account[],
    posts: postsQ.data ?? [],
    links: linksQ.data ?? [],
    loading: accountsQ.isLoading || postsQ.isLoading,
    error: accountsQ.isError || postsQ.isError,
  };
}
type Ctx = ReturnType<typeof useAgonia> & { settings: AgoniaSettings };

const linkOf = (links: Connection[], id: string) => links.find((c) => c.account_id === id);
const isReady = (links: Connection[], id: string) => {
  const c = linkOf(links, id);
  return !!c && !c.paused && !c.reconnect_required;
};
const accStatus = (links: Connection[], id: string) => {
  const c = linkOf(links, id);
  if (!c) return { label: "Sem conexão", tone: "bad" as const };
  if (c.reconnect_required) return { label: "Reconectar", tone: "bad" as const };
  if (c.paused) return { label: "Pausada", tone: "warn" as const };
  return { label: "Pronta", tone: "ok" as const };
};

function Dashboard({ accounts, posts, links, settings, loading }: Ctx) {
  const pending = posts.filter((p) => ["scheduled", "processing"].includes(p.status))
    .sort((a, b) => Date.parse(a.scheduled_at || "") - Date.parse(b.scheduled_at || ""));
  const name = (id: string) => "@" + (accounts.find((a) => a.id === id)?.username ?? "modelo");
  const stats = [
    ["Modelos conectadas", accounts.length, `${accounts.filter((a) => isReady(links, a.id)).length} prontas para publicar`],
    ["Na fila", pending.length, "agendados e em processamento"],
    ["Publicados hoje", posts.filter((p) => publishedToday(p)).length, "confirmados pela Meta"],
    ["Com atenção", posts.filter((p) => ["failed", "uncertain"].includes(p.status)).length, "falhas ou resultado incerto"],
  ] as const;
  return (
    <div className="ag-grid">
      <section className="operation-panel ag-stats" aria-label="Resumo">
        {stats.map(([title, value, hint]) => (
          <div className="ag-stat" key={title}>
            <span>{title}</span><strong>{loading ? "…" : value}</strong><small>{hint}</small>
          </div>
        ))}
      </section>
      <div className="ag-two">
        <section className="operation-panel ag-panel">
          <h2>Próximos envios</h2>
          <p className="ag-hint">Horários no fuso {settings.timezone}.</p>
          <div className="ag-list">
            {pending.slice(0, 8).map((p) => (
              <div className="ag-row" key={p.id}>
                <div><strong>{name(p.account_id)}</strong><small>{p.format} · {fmtDate(p.scheduled_at, settings.timezone)}</small></div>
                <span className={`ag-badge ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
              </div>
            ))}
            {!loading && !pending.length && <p className="ag-empty">Nenhum envio agendado.</p>}
          </div>
        </section>
        <section className="operation-panel ag-panel">
          <h2>Ações rápidas</h2>
          <p className="ag-hint">Publique em várias modelos de uma vez, com intervalo entre elas.</p>
          <div className="ag-actions">
            <Button asChild><Link to="/agonia/reels"><Clapperboard className="mr-2 h-4 w-4" />Novo Reel</Link></Button>
            <Button asChild variant="outline"><Link to="/agonia/stories"><Images className="mr-2 h-4 w-4" />Novo Story</Link></Button>
            <Button asChild variant="outline"><Link to="/agonia/modelos"><Users className="mr-2 h-4 w-4" />Gerenciar modelos</Link></Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Models({ accounts, links, user, refresh, loading }: Ctx) {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); await refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível concluir."); } finally { setBusy(null); }
  }
  return (
    <section className="operation-panel ag-panel">
      <div className="ag-picker-head">
        <div><h2>Modelos e contas</h2><p className="ag-hint">Cada perfil profissional do Instagram conectado representa uma modelo da agência.</p></div>
        <ConnectAccount onConnected={async () => { await refresh(); }} />
      </div>
      <div className="ag-list">
        {loading && <p className="ag-empty">Carregando…</p>}
        {accounts.map((a) => {
          const s = accStatus(links, a.id);
          const c = linkOf(links, a.id);
          return (
            <div className="ag-row" key={a.id}>
              <div><strong>@{a.username}</strong><small>Instagram profissional</small></div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className={`ag-badge ${s.tone}`}>{s.label}</span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("v" + a.id, async () => {
                  const d = await publisherRequest<{ username: string }>("verify", { account_id: a.id });
                  toast.success("Acesso confirmado: @" + d.username);
                })}>
                  {busy === "v" + a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}Verificar
                </Button>
                {c && <Button size="sm" variant="ghost" disabled={busy !== null || !user} onClick={() => run("p" + a.id, async () => {
                  await publisherRequest("pause", { account_id: a.id, paused: !c.paused });
                })}>
                  {c.paused ? <PlayCircle className="mr-1 h-4 w-4" /> : <PauseCircle className="mr-1 h-4 w-4" />}{c.paused ? "Retomar" : "Pausar"}
                </Button>}
              </div>
            </div>
          );
        })}
        {!loading && !accounts.length && <p className="ag-empty">Nenhuma modelo conectada. Use “Conectar conta” para começar.</p>}
      </div>
    </section>
  );
}

function Composer({ format, accounts, links, user, settings, refresh, loading }: Ctx & { format: Extract<Format, "Reel" | "Story"> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState(format === "Reel" ? settings.defaultCaption : "");
  const [media, setMedia] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [when, setWhen] = useState("");
  const [interval, setIntervalMin] = useState(settings.intervalMinutes);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const ready = useMemo(() => accounts.filter((a) => isReady(links, a.id)), [accounts, links]);
  const mediaList = media.split("\n").map((v) => v.trim()).filter(Boolean);
  const allOn = ready.length > 0 && selected.length === ready.length;
  useEffect(() => { setSelected((cur) => cur.filter((id) => ready.some((a) => a.id === id))); }, [ready]);

  async function onFile(list: FileList | null) {
    unlockAudio();
    const picked = Array.from(list ?? []).slice(0, 1);
    if (!picked.length || !user) return;
    setFiles(picked); setUploading(true);
    try {
      const urls = await uploadMedia(picked, user.id);
      setMedia(urls.join("\n"));
      if (picked[0].type === "video/mp4") playConfirmation("uploaded");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha no upload."); }
    finally { setUploading(false); setFiles([]); }
  }

  async function submit() {
    if (!user) return;
    unlockAudio();
    if (!selected.length) return toast.error("Selecione ao menos uma conta.");
    if (!mediaList.length) return toast.error("Adicione um vídeo ou imagem.");
    if (format === "Reel" && mediaList.some((m) => /\.(jpe?g|png)(\?|$)/i.test(m))) return toast.error("Reels precisam de vídeo MP4.");
    setBusy(true);
    try {
      const start = when ? localToUtcIso(when, settings.timezone) : new Date(Date.now() + 2 * 60000).toISOString();
      const plan = buildSchedule(selected, start, interval);
      let ok = 0; const failed: string[] = [];
      for (const row of plan) {
        try {
          await savePost({ id: crypto.randomUUID(), user_id: user.id, account_id: row.accountId, caption, format, media_urls: mediaList, scheduled_at: row.scheduledAt, status: "scheduled" });
          ok++;
        } catch (e) {
          failed.push("@" + (accounts.find((a) => a.id === row.accountId)?.username ?? "conta") + ": " + (e instanceof Error ? e.message : "erro"));
        }
      }
      await refresh();
      if (ok) { playConfirmation("scheduled"); toast.success(`${ok} ${format === "Reel" ? "Reel(s)" : "Story(s)"} agendado(s).`); }
      failed.slice(0, 3).forEach((m) => toast.error(m));
      if (!failed.length) { setMedia(""); setWhen(""); setSelected([]); if (format === "Story") setCaption(""); }
      else setSelected(plan.map((p) => p.accountId).filter((id) => failed.some((f) => f.startsWith("@" + accounts.find((a) => a.id === id)?.username + ":"))));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível agendar.");
    } finally { setBusy(false); }
  }

  const noun = format === "Reel" ? "Reel" : "Story";
  return (
    <div className="ag-two">
      <section className="operation-panel ag-panel">
        <div className="ag-picker-head">
          <div><h2>Modelos</h2><p className="ag-hint">{selected.length} de {ready.length} pronta(s) selecionada(s)</p></div>
          <Button size="sm" variant="outline" onClick={() => setSelected(allOn ? [] : ready.map((a) => a.id))}>{allOn ? "Limpar" : "Selecionar todas"}</Button>
        </div>
        <div className="ag-list ag-picker-scroll">
          {ready.map((a) => (
            <label key={a.id} className={`ag-row ag-pick ${selected.includes(a.id) ? "is-on" : ""}`}>
              <div><strong>@{a.username}</strong><small>pronta para publicar</small></div>
              <input type="checkbox" checked={selected.includes(a.id)} onChange={() => setSelected((cur) => cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id])} />
            </label>
          ))}
          {!loading && !ready.length && <p className="ag-empty">Nenhuma conta pronta. <Link className="underline" to="/agonia/modelos">Conecte ou retome uma conta</Link>.</p>}
        </div>
      </section>
      <section className="operation-panel ag-panel ag-grid">
        <div><h2>Novo {noun}</h2><p className="ag-hint">{format === "Reel" ? "Vídeo MP4 (9:16)." : "Imagem JPG/PNG ou vídeo MP4 (conta empresarial)."} A fila é verificada a cada minuto.</p></div>
        <div className="ag-field">
          <Label htmlFor="ag-file">Enviar {format === "Reel" ? "vídeo" : "imagem ou vídeo"}</Label>
          <Input id="ag-file" type="file" accept={format === "Reel" ? "video/mp4" : "image/jpeg,image/png,video/mp4"} disabled={uploading || busy} onChange={(e) => { const f = e.target.files; void onFile(f); e.target.value = ""; }} />
          {uploading && <p className="ag-hint" role="status"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Limpando e enviando…</p>}
          <LocalMediaPreviews files={files} />
          {mediaList.map((u, i) => <MediaPreview key={u + i} url={u} label={`Mídia ${i + 1}`} />)}
        </div>
        <div className="ag-field">
          <Label htmlFor="ag-url">Ou link HTTPS direto</Label>
          <Textarea id="ag-url" rows={2} placeholder="https://…" value={media} onChange={(e) => setMedia(e.target.value)} />
        </div>
        <div className="ag-field">
          <Label htmlFor="ag-caption">Legenda</Label>
          <Textarea id="ag-caption" rows={4} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} />
          <p className="ag-hint text-right">{caption.length}/2.200</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="ag-field"><Label htmlFor="ag-when">Início ({settings.timezone})</Label><Input id="ag-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /><p className="ag-hint">Vazio = em ~2 minutos.</p></div>
          <div className="ag-field"><Label htmlFor="ag-int">Intervalo entre contas (min)</Label><Input id="ag-int" type="number" min={0} max={1440} value={interval} onChange={(e) => setIntervalMin(clampInterval(e.target.value))} /></div>
        </div>
        <Button disabled={busy || uploading || !selected.length} onClick={() => void submit()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Agendar em {selected.length || "0"} conta(s)
        </Button>
      </section>
    </div>
  );
}

function Queue({ mode, accounts, posts, settings, user, refresh, loading }: Ctx & { mode: "queue" | "done" }) {
  const [account, setAccount] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const statuses: Post["status"][] = mode === "queue" ? ["scheduled", "processing", "draft", "waiting_integration"] : ["published", "failed", "uncertain", "cancelled"];
  const rows = posts.filter((p) => statuses.includes(p.status) && (account === "all" || p.account_id === account))
    .sort((a, b) => mode === "queue" ? Date.parse(a.scheduled_at || "9") - Date.parse(b.scheduled_at || "9") : Date.parse(b.published_at || b.created_at) - Date.parse(a.published_at || a.created_at));
  const name = (id: string) => "@" + (accounts.find((a) => a.id === id)?.username ?? "modelo");
  return (
    <section className="operation-panel ag-panel">
      <div className="ag-picker-head">
        <div><h2>{mode === "queue" ? "Agendamentos" : "Publicados"}</h2><p className="ag-hint">{mode === "queue" ? "Fila persistente no servidor — publica mesmo com o navegador fechado." : "Histórico recente (até 200 itens)."}</p></div>
        <select aria-label="Filtrar por conta" className="ag-input" style={{ maxWidth: 220 }} value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="all">Todas as contas</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
        </select>
      </div>
      <div className="ag-list">
        {loading && <p className="ag-empty">Carregando…</p>}
        {rows.map((p) => (
          <div className="ag-row" key={p.id}>
            <div>
              <strong>{name(p.account_id)} · {p.format}</strong>
              <small>{mode === "queue" ? fmtDate(p.scheduled_at, settings.timezone) : fmtDate(p.published_at || p.scheduled_at, settings.timezone)} · {p.caption ? p.caption.slice(0, 70) : "sem legenda"}</small>
              {p.error_code && <small className="text-destructive">{p.status === "uncertain" ? "O envio pode ter ocorrido — confira o perfil." : "Falha no envio."} ({p.error_code})</small>}
            </div>
            <div className="flex items-center gap-2">
              <span className={`ag-badge ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
              {mode === "queue" && ["scheduled", "draft", "waiting_integration"].includes(p.status) && (
                <Button size="sm" variant="ghost" disabled={busy !== null || !user} onClick={async () => {
                  setBusy(p.id);
                  try { await cancelPost(p, user!.id); await refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao cancelar."); } finally { setBusy(null); }
                }}>Cancelar</Button>
              )}
            </div>
          </div>
        ))}
        {!loading && !rows.length && <p className="ag-empty">{mode === "queue" ? "Nada na fila." : "Nenhuma publicação ainda."}</p>}
      </div>
    </section>
  );
}

function StoriesLink() {
  return (
    <section className="operation-panel ag-panel">
      <h2>Stories com link</h2>
      <p className="ag-hint">A API oficial da Meta não permite sticker de link em Stories. O fluxo é feito por uma extensão de navegador, direto no Instagram Web (Chrome/Edge).</p>
      <ol className="ag-steps">
        <li>Instale a extensão em cada navegador ou perfil que for usar.</li>
        <li>Extraia o ZIP em uma pasta permanente.</li>
        <li>Abra <code>chrome://extensions</code> (ou <code>edge://extensions</code>) e ative o modo desenvolvedor.</li>
        <li>Clique em “Carregar sem compactação” e selecione a pasta com o <code>manifest.json</code>.</li>
        <li>Abra o Instagram, entre na conta desejada e crie o Story com o sticker de link.</li>
      </ol>
      <div className="ag-actions">
        <Button disabled title="Arquivo da extensão ainda não adicionado ao projeto"><Download className="mr-2 h-4 w-4" />Baixar extensão (indisponível)</Button>
      </div>
      <p className="ag-hint mt-3">Para habilitar o download, coloque o ZIP da extensão em <code>public/extensions/</code> e aponte o botão para ele.</p>
    </section>
  );
}

function Config({ user, settings, onSave }: Ctx & { onSave: (s: AgoniaSettings) => void }) {
  const { signOut } = useAuth();
  const [draft, setDraft] = useState(settings);
  const name = (user?.user_metadata?.display_name as string | undefined) || user?.email?.split("@")[0] || "Minha conta";
  return (
    <div className="ag-two">
      <section className="operation-panel ag-panel ag-grid">
        <div><h2>Preferências de publicação</h2><p className="ag-hint">Salvas neste navegador para sua conta.</p></div>
        <div className="ag-field"><Label htmlFor="ag-tz">Fuso horário padrão</Label>
          <select id="ag-tz" className="ag-input" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select>
          <p className="ag-hint">Usado para interpretar os horários agendados.</p></div>
        <div className="ag-field"><Label htmlFor="ag-gap">Intervalo padrão entre contas (min)</Label>
          <Input id="ag-gap" type="number" min={0} max={1440} value={draft.intervalMinutes} onChange={(e) => setDraft({ ...draft, intervalMinutes: clampInterval(e.target.value) })} /></div>
        <div className="ag-field"><Label htmlFor="ag-cap">Legenda padrão dos Reels</Label>
          <Textarea id="ag-cap" rows={4} maxLength={2200} value={draft.defaultCaption} onChange={(e) => setDraft({ ...draft, defaultCaption: e.target.value })} /></div>
        <Button onClick={() => { onSave(draft); toast.success("Configurações salvas."); }}>Salvar configurações</Button>
      </section>
      <section className="operation-panel ag-panel">
        <h2>Meu perfil</h2>
        <div className="ag-list"><div className="ag-row"><div><strong>{name}</strong><small>{user?.email}</small></div></div></div>
        <div className="ag-actions"><Button variant="outline" onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Sair</Button></div>
      </section>
    </div>
  );
}

export default function Agonia() {
  const { section = "" } = useParams();
  const data = useAgonia();
  const [settings, setSettings] = useState<AgoniaSettings>(() => loadSettings(data.user?.id));
  useEffect(() => { setSettings(loadSettings(data.user?.id)); }, [data.user?.id]);
  const ctx: Ctx = { ...data, settings };
  const tab = TABS.find((t) => t.slug === section);
  if (!tab) return <Navigate to="/agonia" replace />;
  return (
    <div className="ag">
      <header className="ag-header">
        <div>
          <p className="ag-eyebrow">Agonia Pro · Agência de modelos</p>
          <h1>{tab.slug === "" ? "Agonia Pro" : tab.label}</h1>
          <p className="ag-sub">Publicação oficial de Reels e Stories para todas as modelos da agência, com fila persistente.</p>
        </div>
      </header>
      <nav className="ag-tabs" aria-label="Seções da Agonia Pro">
        {TABS.map((t) => (
          <Link key={t.slug} to={t.slug ? `/agonia/${t.slug}` : "/agonia"} aria-current={t.slug === section ? "page" : undefined}><t.icon className="h-4 w-4" />{t.label}</Link>
        ))}
      </nav>
      {data.error && <p role="alert" className="mb-4 text-destructive">Não foi possível carregar os dados. Atualize a página.</p>}
      {section === "" && <Dashboard {...ctx} />}
      {section === "modelos" && <Models {...ctx} />}
      {section === "reels" && <Composer key="reel" {...ctx} format="Reel" />}
      {section === "stories" && <Composer key="story" {...ctx} format="Story" />}
      {section === "stories-link" && <StoriesLink />}
      {section === "agendamentos" && <Queue {...ctx} mode="queue" />}
      {section === "publicados" && <Queue {...ctx} mode="done" />}
      {section === "config" && <Config {...ctx} onSave={(s) => { if (data.user) saveSettings(data.user.id, s); setSettings(s); }} />}
    </div>
  );
}
