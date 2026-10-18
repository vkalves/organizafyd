import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Music2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  preparePhoto,
  ttRequest,
  uploadPhoto,
  messages,
} from "@/features/tiktok/api";
import type { Creator, Data, Photo, Settings } from "@/features/tiktok/api";
import "./tiktok-publisher.css";
const privacy: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Todos",
  MUTUAL_FOLLOW_FRIENDS: "Amigos",
  FOLLOWER_OF_CREATOR: "Seguidores",
  SELF_ONLY: "Somente eu",
};
const statuses: Record<string, string> = {
  scheduled: "Agendado",
  processing: "Enviando",
  submitted: "Processando no TikTok",
  published: "Publicado",
  failed: "Falhou",
  uncertain: "Conferir no TikTok",
  cancelled: "Cancelado",
};
const initial: Settings = {
  title: "",
  description: "",
  privacy: "",
  comments: false,
  music: false,
  commercial: false,
  ownBrand: false,
  branded: false,
  ai: false,
  cover: 0,
};
const localTime = () => {
  const d = new Date(Date.now() + 3600000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export default function TikTokPublisher() {
  const { user } = useAuth(),
    cache = useQueryClient();
  const key = ["tiktok-publisher", user?.id];
  const [tab, setTab] = useState("compose"),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [accountId, setAccountId] = useState(""),
    [settings, setSettings] = useState<Settings>({ ...initial }),
    [time, setTime] = useState(localTime);
  const [files, setFiles] = useState<File[]>([]),
    [previews, setPreviews] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [frozen, setFrozen] = useState(false),
    [deleteText, setDeleteText] = useState("");
  const draft = useRef(crypto.randomUUID()),
    uploads = useRef<Photo[]>([]),
    paths = useRef<string[]>([]),
    callbackStarted = useRef(false);
  const query = useQuery({
    queryKey: key,
    queryFn: () => ttRequest<Data>("list"),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const data = query.data,
    accounts = data?.accounts || [],
    selected = accounts.find((a) => a.id === accountId);
  const creator = useQuery({
    queryKey: ["tiktok-creator", user?.id, accountId],
    queryFn: () => ttRequest<Creator>("creator", { accountId }),
    enabled: !!selected && !selected.reconnect_required,
    refetchOnWindowFocus: true,
    retry: false,
  });
  useEffect(() => {
    const previous = document.title;
    document.title = "TikTok Fotos · Organizafy";
    return () => {
      document.title = previous;
    };
  }, []);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  useEffect(() => {
    if (!user || callbackStarted.current) return;
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.has("tt_code") && !p.has("tt_error")) return;
    callbackStarted.current = true;
    history.replaceState(null, "", location.pathname);
    if (p.has("tt_error")) {
      toast.error("A conexão foi cancelada no TikTok.");
      return;
    }
    setBusy(true);
    ttRequest("callback", { code: p.get("tt_code"), state: p.get("tt_state") })
      .then(() => {
        toast.success("Conta conectada.");
        void query.refetch();
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setBusy(false));
  }, [user]);
  function change(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch }));
    setConsent(false);
  }
  async function action(name: string, p: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const r = await ttRequest<{ url?: string }>(name, p);
      if (r.url) location.assign(r.url);
      else await query.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setFrozen(false);
    setFiles([]);
    setSettings({ ...initial });
    setConsent(false);
    setTime(localTime());
    draft.current = crypto.randomUUID();
    uploads.current = [];
    paths.current = [];
    setProgress("");
  }
  function abandon() {
    if (
      frozen &&
      !window.confirm(
        "Confira a fila e o perfil antes de continuar. Um envio sem confirmação pode já ter sido agendado. Deseja abrir um novo rascunho?",
      )
    )
      return;
    reset();
  }
  async function addFiles(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    try {
      const next = Array.from(list);
      if (files.length + next.length > 35)
        throw new Error("Cada postagem permite até 35 fotos.");
      if (next.reduce((s, f) => s + f.size, 0) > 100 * 1024 * 1024)
        throw new Error("Selecione até 100 MB de fotos por vez.");
      const ready: File[] = [];
      for (let i = 0; i < next.length; i++) {
        setProgress(`Preparando foto ${i + 1} de ${next.length}…`);
        ready.push(await preparePhoto(next[i]));
      }
      setFiles((f) => [...f, ...ready]);
      setConsent(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress("");
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    const next = [...files];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setFiles(next);
    change({ cover: 0 });
  }
  async function schedule() {
    if (
      !user ||
      !selected ||
      !creator.data ||
      !consent ||
      !settings.privacy ||
      !files.length
    )
      return;
    setBusy(true);
    setFrozen(true);
    try {
      for (let i = 0; i < files.length; i++) {
        if (uploads.current[i]) continue;
        const path =
          paths.current[i] || `${user.id}/${crypto.randomUUID()}.jpg`;
        paths.current[i] = path;
        setProgress(`Enviando foto ${i + 1} de ${files.length}…`);
        await uploadPhoto(path, files[i]);
        uploads.current[i] = { path, type: "image/jpeg" };
      }
      setProgress("Confirmando agendamento…");
      await ttRequest("schedule", {
        id: draft.current,
        accountId,
        settings,
        media: uploads.current,
        scheduledAt: new Date(time).toISOString(),
        consent: true,
      });
      await cache.invalidateQueries({ queryKey: key });
      reset();
      setTab("queue");
      toast.success("Postagem agendada.");
    } catch (e) {
      toast.error((e as Error).message);
      setProgress(
        "Envio não confirmado. Consulte a fila ou continue este mesmo envio.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!creator.data || frozen) return;
    const invalidPrivacy = settings.privacy && !creator.data.privacy_level_options.includes(settings.privacy);
    const invalidComments = settings.comments && creator.data.comment_disabled;
    if (invalidPrivacy || invalidComments) {
      setSettings(s => ({...s, privacy: invalidPrivacy ? "" : s.privacy, comments: invalidComments ? false : s.comments}));
      setConsent(false);
    }
  }, [creator.data, settings.privacy, settings.comments, frozen]);
  const commercialInvalid =
    settings.commercial && !settings.ownBrand && !settings.branded;
  const allowed =
    !!data?.configured &&
    !!selected &&
    !selected.paused &&
    !selected.reconnect_required &&
    !!creator.data &&
    !creator.isFetching &&
    !creator.isError;
  const submitDisabled =
    busy ||
    !allowed ||
    !consent ||
    !settings.privacy ||
    !files.length ||
    !time || !Number.isFinite(Date.parse(time)) || Date.parse(time) < Date.now() ||
    commercialInvalid ||
    (settings.branded && settings.privacy === "SELF_ONLY");
  return (
    <div className="tt-studio">
      <header className="tt-top">
        <Link to="/" className="tt-back">
          <ArrowLeft size={17} /> Voltar ao painel
        </Link>
        <Link to="/sobre">Organizafy</Link>
        <Button
          disabled={busy || !data?.configured}
          onClick={() => action("connect")}
        >
          <Plus size={16} /> Conectar conta
        </Button>
      </header>
      <main className="tt-main">
        <div className="tt-heading">
          <div>
            <span className="tt-kicker">PUBLICAÇÃO OFICIAL</span>
            <h1>
              <Music2 /> TikTok Fotos
            </h1>
            <p>Suas fotos, na ordem e no horário que você escolher.</p>
          </div>
          <span className="tt-pill">Fotos e carrosséis</span>
        </div>
        <nav className="tt-tabs" aria-label="Área TikTok">
          {[
            ["compose", "Nova postagem"],
            ["queue", "Fila e histórico"],
            ["accounts", "Contas"],
            ["setup", "Como ativar"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
        {query.isLoading && <p role="status">Carregando contas…</p>}
        {query.isError && (
          <div className="tt-notice" role="alert">
            {(query.error as Error).message}{" "}
            <Button variant="outline" onClick={() => query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}
        {data && !data.configured && (
          <div className="tt-notice">
            O módulo está instalado, mas falta ativar a conexão oficial. Veja{" "}
            <button className="underline" onClick={() => setTab("setup")}>
              Como ativar
            </button>
            . Não há publicações reais antes da configuração.
          </div>
        )}
        {tab === "compose" && (
          <div className="tt-grid">
            <section className="tt-card">
              <h2>1. Conta e conteúdo</h2>
              <fieldset disabled={busy || frozen} className="tt-fields">
                <label>
                  Conta do TikTok
                  <select
                    value={accountId}
                    onChange={(e) => {
                      setAccountId(e.target.value);
                      change({ privacy: "", comments: false });
                    }}
                  >
                    <option value="">Escolha a conta</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (@{a.username}){a.paused ? " · pausada" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {creator.isFetching && (
                  <p role="status">Buscando permissões atuais no TikTok…</p>
                )}
                {creator.isError && (
                  <p role="alert">{(creator.error as Error).message}</p>
                )}
                {creator.data && (
                  <p className="tt-muted">
                    Publicar como{" "}
                    <strong>{creator.data.creator_nickname}</strong>
                  </p>
                )}
                <label className="tt-upload">
                  <ImagePlus size={25} />
                  <strong>Adicionar fotos</strong>
                  <span>JPG, PNG ou WebP · até 35 por postagem</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(e) => {
                      void addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <p className="tt-muted">
                  As fotos são preparadas em JPG, com até 1080 px no lado maior
                  e 4 MB. Transparência recebe fundo branco. Confira a prévia
                  antes de enviar.
                </p>
                <div className="tt-photos">
                  {previews.map((src, i) => (
                    <div key={src} className="tt-photo">
                      <img src={src} alt={`Foto ${i + 1}`} />
                      <div>
                        <span>{i + 1}</span>
                        <button
                          type="button"
                          aria-label={`Mover foto ${i + 1} para trás`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowLeft size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Mover foto ${i + 1} para frente`}
                          disabled={i === files.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowRight size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remover foto ${i + 1}`}
                          onClick={() => {
                            setFiles((f) => f.filter((_, n) => n !== i));
                            change({ cover: 0 });
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <label>
                  Título{" "}
                  <Input
                    maxLength={90}
                    value={settings.title}
                    onChange={(e) => change({ title: e.target.value })}
                  />
                  <span className="tt-muted">{settings.title.length}/90</span>
                </label>
                <label>
                  Descrição{" "}
                  <Textarea
                    rows={4}
                    maxLength={4000}
                    value={settings.description}
                    onChange={(e) => change({ description: e.target.value })}
                  />
                  <span className="tt-muted">
                    {settings.description.length}/4000
                  </span>
                </label>
              </fieldset>
            </section>
            <section className="tt-card">
              <h2>2. Revisar e agendar</h2>
              <fieldset disabled={busy || frozen} className="tt-fields">
                <label>
                  Data e horário{" "}
                  <Input
                    type="datetime-local"
                    value={time}
                    onChange={(e) => {
                      setTime(e.target.value);
                      setConsent(false);
                    }}
                  />
                  <span className="tt-muted">
                    Fuso: {Intl.DateTimeFormat().resolvedOptions().timeZone}. A
                    fila é verificada a cada minuto.
                  </span>
                </label>
                <label>
                  Quem pode ver
                  <select
                    value={settings.privacy}
                    onChange={(e) => change({ privacy: e.target.value })}
                  >
                    <option value="">Selecione a privacidade</option>
                    {(creator.data?.privacy_level_options || []).map((p) => (
                      <option
                        key={p}
                        value={p}
                        disabled={settings.branded && p === "SELF_ONLY"}
                      >
                        {privacy[p] || p}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Capa
                  <select
                    value={settings.cover}
                    onChange={(e) => change({ cover: Number(e.target.value) })}
                  >
                    {files.length ? (
                      files.map((_, i) => (
                        <option key={i} value={i}>
                          Foto {i + 1}
                        </option>
                      ))
                    ) : (
                      <option value={0}>Adicione fotos</option>
                    )}
                  </select>
                </label>
                <label className="tt-check">
                  <input
                    type="checkbox"
                    checked={
                      settings.comments && !creator.data?.comment_disabled
                    }
                    disabled={!creator.data || creator.data.comment_disabled}
                    onChange={(e) => change({ comments: e.target.checked })}
                  />
                  Permitir comentários
                </label>
                <label className="tt-check">
                  <input
                    type="checkbox"
                    checked={settings.music}
                    onChange={(e) => change({ music: e.target.checked })}
                  />
                  Adicionar música recomendada pelo TikTok
                </label>
                <label className="tt-check">
                  <input
                    type="checkbox"
                    checked={settings.ai}
                    onChange={(e) => change({ ai: e.target.checked })}
                  />
                  Identificar fotos geradas por IA
                </label>
                <label className="tt-check">
                  <input
                    type="checkbox"
                    checked={settings.commercial}
                    onChange={(e) =>
                      change({
                        commercial: e.target.checked,
                        ownBrand: false,
                        branded: false,
                      })
                    }
                  />
                  Este conteúdo promove uma marca, produto ou serviço
                </label>
                {settings.commercial && (
                  <div className="tt-commercial">
                    <label className="tt-check">
                      <input
                        type="checkbox"
                        checked={settings.ownBrand}
                        onChange={(e) => change({ ownBrand: e.target.checked })}
                      />
                      Minha própria marca
                    </label>
                    <label className="tt-check">
                      <input
                        type="checkbox"
                        checked={settings.branded}
                        disabled={settings.privacy === "SELF_ONLY"}
                        onChange={(e) => change({ branded: e.target.checked })}
                      />
                      Marca de terceiros / parceria paga
                    </label>
                    <p>
                      {settings.branded
                        ? "Sua publicação será identificada como “Parceria paga”."
                        : settings.ownBrand
                          ? "Sua publicação será identificada como “Conteúdo promocional”."
                          : "Selecione pelo menos uma opção."}
                    </p>
                    {settings.privacy === "SELF_ONLY" && (
                      <p>Parceria paga exige outra opção de privacidade.</p>
                    )}
                  </div>
                )}
                <p className="tt-muted">
                  Após sua autorização, as fotos ficam acessíveis por links
                  públicos para o TikTok buscá-las. Não envie arquivos
                  confidenciais. O TikTok pode levar alguns minutos para
                  processar a publicação.
                </p>
                <label className="tt-check tt-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    Revisei as fotos, a conta e o horário. Autorizo o envio e
                    concordo com a{" "}
                    <a
                      href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Confirmação de Uso de Música do TikTok
                    </a>
                    {settings.branded && (
                      <>
                        {" "}
                        e a{" "}
                        <a
                          href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Política de Conteúdo de Marca
                        </a>
                      </>
                    )}
                  </span>
                </label>
              </fieldset>
              <Button
                className="tt-submit"
                disabled={submitDisabled}
                onClick={schedule}
              >
                {busy ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <CalendarClock size={16} />
                )}{" "}
                {frozen ? "Continuar o mesmo envio" : "Autorizar e agendar"}
              </Button>
              <p role="status" className="tt-muted">
                {progress}
              </p>
              {frozen && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void query.refetch();
                      setTab("queue");
                    }}
                  >
                    Consultar fila
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={abandon}>
                    Novo rascunho
                  </Button>
                </>
              )}
            </section>
          </div>
        )}
        {tab === "queue" && (
          <section className="tt-card">
            <div className="tt-section-title">
              <h2>Fila e histórico</h2>
              <Button
                variant="outline"
                disabled={busy || query.isFetching}
                onClick={() => query.refetch()}
              >
                <RefreshCw size={15} /> Atualizar
              </Button>
            </div>
            <p className="tt-muted">
              Últimas 200 postagens. “Processando” ainda não significa
              publicado. Falhas e envios incertos não são repetidos
              automaticamente.
            </p>
            {!data?.posts.length && (
              <div className="tt-empty">
                <CalendarClock />
                <h3>Sua fila está vazia</h3>
                <p>Escolha as fotos e o horário em Nova postagem.</p>
              </div>
            )}
            <div className="tt-posts">
              {data?.posts.map((p) => (
                <article key={p.id}>
                  <div>
                    <strong>{p.settings.title || "Postagem de fotos"}</strong>
                    <p>
                      {accounts.find((a) => a.id === p.account_id)?.name} ·{" "}
                      {p.media.length} foto(s)
                    </p>
                    <p>{new Date(p.scheduled_at).toLocaleString("pt-BR")}</p>
                    <p className="tt-description">{p.settings.description}</p>
                  </div>
                  <div>
                    <span className={`tt-status tt-status-${p.status}`}>
                      {statuses[p.status] || p.status}
                    </span>
                    {p.error_code && (
                      <p role="alert">
                        {messages[p.error_code] || `TikTok: ${p.error_code}`}
                      </p>
                    )}
                    {p.status === "scheduled" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => action("cancel", { id: p.id })}
                      >
                        Cancelar
                      </Button>
                    )}
                    {p.status === "published" &&
                      p.tiktok_post_id &&
                      /^\d+$/.test(p.tiktok_post_id) && (
                        <a
                          href={`https://www.tiktok.com/@${encodeURIComponent(accounts.find((a) => a.id === p.account_id)?.username || "")}/photo/${p.tiktok_post_id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver no TikTok
                        </a>
                      )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {tab === "accounts" && (
          <section className="tt-card">
            <h2>Contas conectadas</h2>
            <p className="tt-muted">
              Cada cliente conecta a própria conta pelo TikTok. Não pedimos a
              senha. Ao retomar uma conta, os posts atrasados também serão
              enviados: cancele os que não quiser antes de retomar.
            </p>
            {!accounts.length && <p>Nenhuma conta conectada.</p>}
            {accounts.map((a) => (
              <article className="tt-account" key={a.id}>
                <div>
                  <strong>{a.name}</strong>
                  <p>
                    @{a.username} ·{" "}
                    {a.reconnect_required
                      ? "Reconexão necessária"
                      : a.paused
                        ? "Pausada"
                        : "Ativa"}
                  </p>
                </div>
                <div>
                  {!a.reconnect_required && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        action("pause", { accountId: a.id, paused: !a.paused })
                      }
                    >
                      {a.paused ? "Retomar" : "Pausar"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => action("disconnect", { accountId: a.id })}
                  >
                    Desconectar
                  </Button>
                </div>
              </article>
            ))}
            <details className="tt-delete">
              <summary>Excluir meus dados do TikTok</summary>
              <p>
                Remove deste módulo todas as contas, fotos, filas e histórico.
                Não apaga posts que já chegaram ao TikTok, nem sua conta
                Organizafy. Envios em andamento podem terminar. Digite EXCLUIR
                para confirmar.
              </p>
              <Input
                aria-label="Confirmação de exclusão"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
              />
              <Button
                variant="destructive"
                disabled={busy || deleteText !== "EXCLUIR"}
                onClick={async () => {
                  await action("delete_data", { confirm: "EXCLUIR" });
                  setDeleteText("");
                }}
              >
                <Trash2 size={16} /> Excluir dados do módulo
              </Button>
            </details>
          </section>
        )}
        {tab === "setup" && (
          <section className="tt-card tt-guide">
            <h2>Ativação pelo administrador</h2>
            <p>
              Este módulo usa a API oficial. Não há assinatura de um publicador
              intermediário. Hospedagem, armazenamento e limites do TikTok
              continuam existindo.
            </p>
            <ol>
              <li>
                Confira as páginas públicas e preencha os dados do responsável e
                o email de suporte.
              </li>
              <li>
                Cadastre o aplicativo Web no TikTok for Developers. Adicione
                Login Kit, Content Posting API e Direct Post com{" "}
                <code>video.publish</code>.
              </li>
              <li>
                Configure as chaves no Supabase, aplique a migração e publique a
                função <code>tiktok-publisher</code>.
              </li>
              <li>
                Verifique o domínio de entrega das fotos. Configure o worker
                para funcionar com o site fechado.
              </li>
              <li>
                Conecte uma conta de teste no Sandbox, teste uma postagem
                privada e grave o fluxo completo.
              </li>
              <li>
                Envie a solicitação de análise e a auditoria do Direct Post.
                Publicações públicas dependem dessa liberação.
              </li>
            </ol>
            <a
              href="https://github.com/vkalves/organizafyd/blob/main/docs/tiktok-publisher.md"
              target="_blank"
              rel="noreferrer"
            >
              Abrir passo a passo completo
            </a>
            <p>
              <CheckCircle2 size={15} className="inline" /> Cada postagem exige
              sua revisão e autorização.
            </p>
          </section>
        )}
      </main>
      <footer className="tt-footer">
        <Link to="/sobre">Sobre</Link>
        <Link to="/privacidade">Privacidade</Link>
        <Link to="/termos">Termos de Uso</Link>
        <Link to="/exclusao-de-dados">Excluir dados</Link>
        <Link to="/contato">Contato</Link>
      </footer>
    </div>
  );
}
