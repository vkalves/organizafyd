import { LocalMediaPreviews } from "./LocalMediaPreviews";
import { MediaPreview } from "./MediaPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Upload,
  RefreshCw,
  Play,
  FolderPlus,
  ShieldCheck,
  Shuffle,
  CalendarClock,
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
  cancelFlow,
  previewMedia,
  type Media,
} from "./flows-api";
import type { Connection } from "./api";
import type { Post } from "./model";
import type { FlowInput } from "../../../supabase/functions/instagram-publisher/flow";
import { playConfirmation, unlockAudio } from "./sound";
import "./flows.css";
const field =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
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
  const [preview, setPreview] = useState<{
    url: string;
    video: boolean;
  } | null>(null);
  const [chosenFiles, setChosenFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<"posts" | "stories">("posts");
  const [selected, setSelected] = useState<string[]>([]),
    [accountIds, setAccounts] = useState<string[]>([]);
  const [folder, setFolder] = useState("*"),
    [newFolder, setNewFolder] = useState("");
  const [name, setName] = useState(""),
    [caption, setCaption] = useState(""),
    [gap, setGap] = useState(1),
    [unit, setUnit] = useState(60);
  const [random, setRandom] = useState(true),
    [distribution, setDistribution] = useState<"all" | "split">("all"),
    [format, setFormat] = useState<FlowInput["format"]>("auto");
  const [when, setWhen] = useState("now"),
    [start, setStart] = useState(""),
    [coverId, setCoverId] = useState<string | null>(null);
  const [variations, setVariations] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [showCaptions, setShowCaptions] = useState(false),
    [showSaved, setShowSaved] = useState(false);
  const submitting = useRef(false);
  const [flowId, setFlowId] = useState(() => crypto.randomUUID());
  const media = query.data?.media ?? [],
    prefs = query.data?.prefs;
  const visible = media.filter(
    (m) => m.kind === kind && (folder === "*" || m.folder === folder),
  );
  const picked = media.filter(
    (m) => selected.includes(m.id) && m.kind === kind,
  );
  const available = accountIds.filter((id) =>
    connections.some(
      (c) => c.account_id === id && !c.paused && !c.reconnect_required,
    ),
  );
  const total =
    distribution === "all" ? picked.length * available.length : picked.length;
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
  async function upload(files: File[], target: Media["kind"] = kind) {
    if (!user || !files.length || submitting.current) return;
    setChosenFiles(files);
    unlockAudio();
    await perform(async () => {
      if (
        target === "cover" &&
        (files.length !== 1 || !files[0].type.startsWith("image/"))
      )
        throw new Error("Escolha uma imagem JPG ou PNG para a capa.");
      const ids = await addMedia(
        files,
        user.id,
        target,
        folder === "*" ? "" : folder,
        setProgress,
      );
      if (files.some((file) => file.type === "video/mp4"))
        playConfirmation("uploaded");
      if (target === "cover") setCoverId(ids[0]);
      else setSelected((prev) => [...prev, ...ids]);
      setChosenFiles([]);
      toast.success(
        "Mídias prontas. Metadados removidos antes do armazenamento.",
      );
    });
  }
  function submit() {
    unlockAudio();
    void perform(async () => {
      if (!picked.length || !available.length)
        throw new Error("Selecione ao menos uma conta ativa e uma mídia.");
      if (gap * unit < 3 || !Number.isFinite(gap * unit))
        throw new Error("O intervalo mínimo é de 3 minutos.");
      if (when === "schedule" && (!start || Date.parse(start) <= Date.now()))
        throw new Error("Escolha uma data futura.");
      const input: FlowInput = {
        id: flowId,
        name,
        accountIds: available,
        mediaIds: picked.map((m) => m.id),
        gapMinutes: gap * unit,
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
  if (query.isLoading) return <p role="status">Carregando seus Fluxos…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>{query.error.message}</p>
        <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
      </div>
    );
  return (
    <div className="ig-flows">
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prévia da mídia</DialogTitle>
          </DialogHeader>
          {preview &&
            (preview.video ? (
              <video
                src={preview.url}
                controls
                className="max-h-[65vh] w-full"
              />
            ) : (
              <img
                src={preview.url}
                alt="Mídia selecionada para publicação"
                className="max-h-[65vh] w-full object-contain"
              />
            ))}
        </DialogContent>
      </Dialog>
      <div className="ig-flow-intro">
        <div>
          <h2>Do upload à publicação, em um fluxo.</h2>
          <p>
            Organize suas mídias, escolha os perfis e acompanhe os envios
            confirmados.
          </p>
        </div>
        <span className="ig-pill">
          <ShieldCheck size={14} /> Limpeza de metadados no upload
        </span>
      </div>
      <section
        className="operation-panel ig-panel space-y-4"
        aria-labelledby="ig-library-heading"
      >
        <div className="ig-panel-head">
          <h2 id="ig-library-heading">
            <span className="ig-step">1</span> Biblioteca de mídias
          </h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void query.refetch()}
            aria-label="Atualizar biblioteca"
          >
            <RefreshCw size={16} />
          </Button>
        </div>
        <div className="ig-flow-options" aria-label="Tipo de mídia">
          {(["posts", "stories"] as const).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              disabled={busy}
              onClick={() => {
                setKind(k);
                setSelected([]);
                setCoverId(null);
                setFlowId(crypto.randomUUID());
              }}
            >
              {k === "posts" ? "Reels e posts" : "Stories"} (
              {media.filter((m) => m.kind === k).length})
            </button>
          ))}
        </div>
        <div className="ig-flow-options" aria-label="Pastas">
          {["*", "", ...(prefs?.folders ?? [])].map((f) => (
            <button
              key={f}
              aria-pressed={folder === f}
              onClick={() => setFolder(f)}
            >
              {f === "*" ? "Todas" : f === "" ? "Sem pasta" : f}
            </button>
          ))}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!prefs || !newFolder.trim()) return;
            void perform(async () => {
              await savePrefs({
                ...prefs,
                folders: [...new Set([...prefs.folders, newFolder.trim()])],
              });
              setFolder(newFolder.trim());
              setNewFolder("");
            });
          }}
        >
          <Input
            aria-label="Nome da nova pasta"
            value={newFolder}
            maxLength={80}
            onChange={(e) => setNewFolder(e.target.value)}
            className="max-w-64"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !newFolder.trim()}
          >
            <FolderPlus size={16} />
            Nova pasta
          </Button>
        </form>
        <label
          className={`ig-upload-zone ${busy ? "is-busy" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void upload(Array.from(e.dataTransfer.files));
          }}
        >
          <Upload size={22} />
          <strong>Clique ou arraste suas mídias</strong>
          <span>JPG, PNG ou MP4 · até 100 MB por arquivo</span>
          <input
            type="file"
            accept="image/jpeg,image/png,video/mp4"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <span>
            Fotos e vídeos são reconstruídos para remover os metadados antes do
            envio.
          </span>
        </label>
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {progress || `${picked.length} mídia(s) selecionada(s) para o fluxo.`}
        </p>
        <LocalMediaPreviews files={chosenFiles} />
        {!!picked.length && (
          <section
            aria-label="Mídias selecionadas para o fluxo"
            className="space-y-3"
          >
            <h3>Prévia do fluxo · {picked.length} mídia(s)</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {picked.map((m, i) => (
                <MediaPreview
                  key={m.id}
                  url={m.url}
                  label={`Selecionada ${i + 1}`}
                />
              ))}
            </div>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !visible.length}
            onClick={() =>
              setSelected((prev) => [
                ...new Set([...prev, ...visible.map((m) => m.id)]),
              ])
            }
          >
            Selecionar todas nesta pasta
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSelected([])}
            disabled={busy}
          >
            Limpar seleção
          </Button>
        </div>
        <details open>
          <summary className="cursor-pointer text-sm">
            Ver mídias ({visible.length})
          </summary>
          <div className="ig-library-list">
            {visible.map((m, i) => (
              <article key={m.id} className="ig-library-item">
                <MediaPreview
                  url={m.url}
                  label={`Prévia de ${m.url.endsWith(".mp4") ? "vídeo" : "foto"} ${i + 1}`}
                  compact
                />
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(m.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, m.id]
                          : prev.filter((id) => id !== m.id),
                      )
                    }
                  />
                  <span>
                    {m.url.endsWith(".mp4") ? "Vídeo" : "Foto"} {i + 1}
                  </span>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const url = await previewMedia(m.url);
                      setPreview({ url, video: m.url.endsWith(".mp4") });
                    })
                  }
                >
                  Visualizar
                </Button>
                <select
                  aria-label={`Pasta da mídia ${i + 1}`}
                  value={m.folder}
                  disabled={busy}
                  onChange={(e) =>
                    void perform(() =>
                      setMedia(m.id, { folder: e.target.value }),
                    )
                  }
                >
                  <option value="">Sem pasta</option>
                  {prefs?.folders.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </article>
            ))}
          </div>
          {!visible.length && (
            <p className="ig-empty">Adicione mídias para começar.</p>
          )}
        </details>
      </section>
      <section
        className="operation-panel ig-panel space-y-5"
        aria-labelledby="ig-new-flow-heading"
      >
        <h2 id="ig-new-flow-heading">
          <span className="ig-step">2</span>{" "}
          {kind === "stories"
            ? "Story em várias contas"
            : "Novo fluxo de postagem"}
        </h2>
        {kind === "stories" && (
          <p className="text-sm text-muted-foreground">
            Use imagens ou vídeos verticais 9:16. A Meta verifica a duração e a
            compatibilidade antes de publicar.
          </p>
        )}
        <div>
          <Label htmlFor="flow-name">Nome do fluxo (opcional)</Label>
          <Input
            id="flow-name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Reels de novembro"
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            Contas que vão postar
          </legend>
          <div className="ig-flow-options">
            {accounts.map((a) => {
              const c = connections.find((c) => c.account_id === a.id),
                disabled = !c || c.paused || c.reconnect_required;
              return (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    disabled={busy || disabled}
                    checked={accountIds.includes(a.id)}
                    onChange={(e) =>
                      setAccounts((prev) =>
                        e.target.checked
                          ? [...prev, a.id]
                          : prev.filter((id) => id !== a.id),
                      )
                    }
                  />
                  @{a.username}
                  {disabled ? " · reconecte ou retome" : ""}
                </label>
              );
            })}
          </div>
          {!accounts.length && (
            <p className="text-sm text-muted-foreground">
              Conecte seus perfis na aba Contas para começar.
            </p>
          )}
        </fieldset>
        {kind === "posts" && (
          <>
            <div>
              <Label htmlFor="flow-caption">Legenda automática</Label>
              <Textarea
                id="flow-caption"
                rows={3}
                maxLength={2200}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Aplicada às mídias sem legenda própria"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCaptions((v) => !v)}
                aria-expanded={showCaptions}
              >
                Legendas por mídia ({picked.length})
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowSaved((v) => !v)}
                aria-expanded={showSaved}
              >
                Legendas salvas
              </Button>
              <Button
                variant="outline"
                disabled={!caption.trim()}
                onClick={() =>
                  setVariations(
                    [
                      caption,
                      caption.split(/\n+/).reverse().join("\n"),
                      caption.replace(/([.!?])\s+/g, "$1\n\n"),
                    ]
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join("\n---\n"),
                  )
                }
              >
                Gerar variações
              </Button>
            </div>
            {showSaved && (
              <div className="space-y-2 rounded-lg border p-3">
                <Button
                  size="sm"
                  disabled={busy || !caption.trim()}
                  onClick={() =>
                    prefs &&
                    void perform(async () => {
                      await savePrefs({
                        ...prefs,
                        captions: [...new Set([...prefs.captions, caption])],
                      });
                      toast.success("Legenda salva.");
                    })
                  }
                >
                  Salvar legenda atual
                </Button>
                {prefs?.captions.map((text, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      className="truncate text-left text-sm flex-1"
                      onClick={() => setCaption(text)}
                    >
                      {text}
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          savePrefs({
                            ...prefs,
                            captions: prefs.captions.filter((_, n) => n !== i),
                          }),
                        )
                      }
                    >
                      Excluir
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {showCaptions && (
              <div className="space-y-3">
                {picked.map((m, i) => (
                  <MediaCaption
                    key={m.id}
                    media={m}
                    index={i}
                    busy={busy}
                    save={(text) =>
                      perform(() => setMedia(m.id, { caption: text }))
                    }
                  />
                ))}
              </div>
            )}
            <details open={!!variations}>
              <summary className="cursor-pointer text-sm">
                Variações de legenda
              </summary>
              <Label htmlFor="flow-variations">
                Revise os textos; separe cada variação com uma linha contendo
                ---
              </Label>
              <Textarea
                id="flow-variations"
                rows={5}
                value={variations}
                onChange={(e) => setVariations(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                As variações reorganizam seu texto e são alternadas entre as
                mídias. Uma legenda por mídia tem prioridade.
              </p>
            </details>
          </>
        )}
        <div className="ig-flow-grid">
          <div>
            <Label htmlFor="flow-gap">Intervalo entre postagens (GAP)</Label>
            <div className="flex gap-2">
              <Input
                id="flow-gap"
                type="number"
                min={unit === 60 ? 0.05 : 3}
                step="any"
                value={gap}
                onChange={(e) => setGap(Number(e.target.value))}
              />
              <select
                className={field}
                aria-label="Unidade do intervalo"
                value={unit}
                onChange={(e) => setUnit(Number(e.target.value))}
              >
                <option value={60}>horas</option>
                <option value={1}>minutos</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Mínimo de 3 minutos por conta. O intervalo não garante ausência de
              restrições do Instagram.
            </p>
          </div>
          <fieldset>
            <legend>Ordem das mídias</legend>
            <div className="ig-flow-options">
              <button aria-pressed={random} onClick={() => setRandom(true)}>
                <Shuffle size={14} />
                Randomizar por conta
              </button>
              <button aria-pressed={!random} onClick={() => setRandom(false)}>
                Manter ordem
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>Distribuição</legend>
            <div className="ig-flow-options">
              <button
                aria-pressed={distribution === "all"}
                onClick={() => setDistribution("all")}
              >
                Todas as contas postam tudo
              </button>
              <button
                aria-pressed={distribution === "split"}
                onClick={() => setDistribution("split")}
              >
                Dividir entre as contas
              </button>
            </div>
          </fieldset>
          {kind === "posts" && (
            <fieldset>
              <legend>Formato</legend>
              <div className="ig-flow-options">
                {(["auto", "Reel", "Feed"] as const).map((f) => (
                  <button
                    key={f}
                    aria-pressed={format === f}
                    onClick={() => setFormat(f)}
                  >
                    {f === "auto" ? "Automático" : f === "Feed" ? "Post" : f}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </div>
        {kind === "posts" && (
          <div>
            <Label htmlFor="flow-cover">Capa do Reel (opcional)</Label>
            <Input
              id="flow-cover"
              type="file"
              accept="image/jpeg,image/png"
              disabled={busy}
              onChange={(e) => {
                void upload(Array.from(e.target.files ?? []), "cover");
                e.target.value = "";
              }}
            />
            <select
              aria-label="Capa selecionada"
              className={`${field} mt-2`}
              value={coverId ?? ""}
              onChange={(e) => setCoverId(e.target.value || null)}
            >
              <option value="">Sem capa</option>
              {media
                .filter((m) => m.kind === "cover")
                .map((m, i) => (
                  <option key={m.id} value={m.id}>
                    Capa {i + 1}
                  </option>
                ))}
            </select>
            <p className="text-xs text-muted-foreground">
              JPG/PNG convertido para JPG e sem metadados. Aplicada apenas aos
              Reels.
            </p>
          </div>
        )}
        <fieldset>
          <legend>Quando publicar</legend>
          <div className="ig-flow-options">
            <button
              aria-pressed={when === "now"}
              onClick={() => setWhen("now")}
            >
              <Play size={14} />
              Publicar agora
            </button>
            <button
              aria-pressed={when === "schedule"}
              onClick={() => setWhen("schedule")}
            >
              <CalendarClock size={14} />
              Agendar
            </button>
          </div>
          {when === "schedule" && (
            <div className="mt-3">
              <Label htmlFor="flow-start">Início do fluxo</Label>
              <Input
                id="flow-start"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Fuso: {Intl.DateTimeFormat().resolvedOptions().timeZone}. O envio
            começa pela fila automática, verificada a cada minuto.
          </p>
        </fieldset>
        <div className="ig-flow-summary">
          <strong>
            {available.length} conta(s) · {picked.length} mídia(s) · {total}{" "}
            publicação(ões)
          </strong>
          <p>
            As mídias são removidas da biblioteca quando todos os envios forem
            concluídos, preservando arquivos usados por outros agendamentos.
          </p>
        </div>
        <Button
          className="w-full"
          disabled={
            busy ||
            !picked.length ||
            !available.length ||
            total > 500 ||
            gap * unit < 3
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
          <p role="alert">Divida o lote em fluxos com até 500 publicações.</p>
        )}
      </section>
      <section className="operation-panel ig-panel space-y-4">
        <div className="ig-panel-head">
          <h2>
            <span className="ig-step">3</span> Seus fluxos
          </h2>
          <Button
            aria-label="Atualizar fluxos"
            size="sm"
            variant="ghost"
            onClick={() => {
              void query.refetch();
              void onCreated();
            }}
          >
            <RefreshCw size={16} />
          </Button>
        </div>
        {!query.data?.flows.length && (
          <p className="ig-empty">Nenhum fluxo criado ainda.</p>
        )}
        {query.data?.flows.map((flow) => {
          const jobs = posts.filter((p) => p.flow_id === flow.id),
            done = jobs.filter((p) => p.status === "published").length,
            pending = jobs.filter((p) => p.status === "scheduled").length;
          return (
            <article key={flow.id} className="ig-flow-card">
              <div>
                <strong>{flow.name}</strong>
                <p>{new Date(flow.created_at).toLocaleString("pt-BR")}</p>
                <p>
                  {done} confirmado(s) · {pending} agendado(s) ·{" "}
                  {
                    jobs.filter(
                      (p) => p.status === "failed" || p.status === "uncertain",
                    ).length
                  }{" "}
                  para revisar
                </p>
                <small>
                  Contagem nos 200 registros recentes. Veja a fila para
                  detalhes.
                </small>
              </div>
              {pending > 0 && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await cancelFlow(flow.id);
                      await onCreated();
                      toast.success("Envios pendentes cancelados.");
                    })
                  }
                >
                  Cancelar pendentes
                </Button>
              )}
            </article>
          );
        })}
      </section>
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
    <div>
      <Label htmlFor={`caption-${media.id}`}>
        Legenda da mídia {index + 1}
      </Label>
      <Textarea
        id={`caption-${media.id}`}
        value={text}
        maxLength={2200}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || text === media.caption}
        onClick={() => void save(text)}
      >
        Salvar legenda desta mídia
      </Button>
    </div>
  );
}
