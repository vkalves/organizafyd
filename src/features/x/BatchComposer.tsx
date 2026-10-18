import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Copy,
  Upload,
  Images,
  ChevronRight,
  Files,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { type XAccount } from "./api";
import { MediaDropZone } from "./MediaDropZone";
import {
  batchTimes,
  submitBatch,
  validateBatch,
  validatePostFiles,
  type BatchItem,
  type BatchState,
} from "./batch";
import { textWeight } from "../../../supabase/functions/x-publisher/model";
const labels: Record<BatchState, string> = {
  waiting: "Rascunho",
  cleaning: "Limpando metadados…",
  uploading: "Enviando mídia limpa…",
  scheduling: "Confirmando agendamento…",
  scheduled: "Agendado",
  error: "Precisa de atenção",
};
function firstTime() {
  return new Date(Date.now() + 3600000).toISOString();
}
function localTime(iso: string) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
}
function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return file.type === "video/mp4" ? (
    <video
      src={url}
      controls
      preload="metadata"
      className="h-36 w-full rounded-lg bg-black object-contain"
    />
  ) : (
    <img
      src={url}
      alt={file.name}
      className="h-36 w-full rounded-lg bg-black object-contain"
    />
  );
}
export function BatchComposer({
  accounts,
  userId,
  disabled,
  onBusy,
  onComplete,
}: {
  accounts: XAccount[];
  userId: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onComplete: () => Promise<unknown>;
}) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const activeId = items.some((item) => item.id === selectedId)
    ? selectedId
    : items[0]?.id;
  const jobs = useRef<BatchItem[]>([]);
  const stopping = useRef(false);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [locked, setLocked] = useState(false);
  const [defaultAccount, setDefaultAccount] = useState("");
  const [start, setStart] = useState(() => localTime(firstTime()));
  const [interval, setInterval] = useState(180);
  const [caption, setCaption] = useState("");
  const frozen = disabled || running || locked;
  const completed = items.filter((item) => item.state === "scheduled").length;
  useEffect(() => {
    if (!defaultAccount && accounts.length) setDefaultAccount(accounts[0].id);
  }, [accounts, defaultAccount]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (runningRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function edit(id: string, patch: Partial<BatchItem>) {
    setItems((old) =>
      old.map((item) =>
        item.id === id
          ? { ...item, ...patch, media: undefined, error: undefined }
          : item,
      ),
    );
  }
  function makeItem(files: File[] = []): BatchItem {
    return {
      id: crypto.randomUUID(),
      files,
      accountId: defaultAccount,
      text: caption,
      scheduledAt: firstTime(),
      state: "waiting",
    };
  }
  function addPosts(files?: File[], grouped = false) {
    try {
      const next = [
        ...items,
        ...(files
          ? grouped
            ? [makeItem(files)]
            : files.map((file) => makeItem([file]))
          : [makeItem()]),
      ];
      if (next.length > 30)
        throw new Error("Adicione até 30 postagens por lote.");
      checkSize(next);
      next.forEach((item) => validatePostFiles(item.files));
      setItems(next);
      setSelectedId(next[items.length]?.id || next[0]?.id || "");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  function checkSize(next: BatchItem[]) {
    if (
      next
        .flatMap((item) => item.files)
        .reduce((sum, file) => sum + file.size, 0) >
      200 * 1024 * 1024
    )
      throw new Error("O lote pode ter até 200 MB.");
  }
  function changeFiles(item: BatchItem, files: File[]) {
    try {
      validatePostFiles(files);
      checkSize(
        items.map((row) => (row.id === item.id ? { ...row, files } : row)),
      );
      edit(item.id, { files });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  function move(index: number, step: number) {
    setItems((old) => {
      const next = [...old];
      [next[index], next[index + step]] = [next[index + step], next[index]];
      return next;
    });
  }
  function distribute() {
    try {
      const times = batchTimes(start, interval, items.length);
      setItems((old) =>
        old.map((item, i) => ({ ...item, scheduledAt: times[i] })),
      );
      toast.success("Horários preenchidos. Você pode ajustar cada um abaixo.");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  async function submit() {
    if (runningRef.current) return;
    try {
      if (!locked) {
        validateBatch(items);
        const disconnected = items.find(
          (item) =>
            !accounts.some(
              (account) =>
                account.id === item.accountId && !account.reconnect_required,
            ),
        );
        if (disconnected)
          throw new Error("Selecione uma conta conectada para cada postagem.");
        jobs.current = items.map((item) => ({
          ...item,
          files: [...item.files],
        }));
      }
    } catch (error) {
      toast.error((error as Error).message);
      return;
    }
    setLocked(true);
    setRunning(true);
    runningRef.current = true;
    stopping.current = false;
    onBusy(true);
    try {
      await submitBatch(
        jobs.current,
        userId,
        (next) =>
          setItems((old) =>
            old.map((item) => (item.id === next.id ? next : item)),
          ),
        () => stopping.current,
      );
      const done = jobs.current.filter(
        (item) => item.state === "scheduled",
      ).length;
      toast[done === jobs.current.length ? "success" : "info"](
        `${done} de ${jobs.current.length} postagens agendadas.`,
      );
      await onComplete();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o lote.",
      );
    } finally {
      setRunning(false);
      runningRef.current = false;
      onBusy(false);
    }
  }
  function reset() {
    setItems([]);
    jobs.current = [];
    setSelectedId("");
    setLocked(false);
  }
  return (
    <section className="x-batch" aria-label="Agendar em lote">
      <div className="x-batch-toolbar">
        <div>
          <h2>
            Agendamento em lote <span>{items.length}/30</span>
          </h2>
          <p>Escolha um post na lista para editar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={frozen || items.length >= 30}>
                <Upload size={15} className="mr-2" />
                Importar arquivos
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  document.getElementById("batch-carousel")?.click()
                }
              >
                <Images size={16} className="mr-2" />
                Fotos juntas em um carrossel
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => document.getElementById("batch-files")?.click()}
              >
                <Files size={16} className="mr-2" />
                Um arquivo por postagem separada
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            id="batch-carousel"
            aria-label="Fotos de um novo carrossel"
            type="file"
            multiple
            accept="image/jpeg,image/png"
            className="sr-only"
            disabled={frozen || items.length >= 30}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) {
                if (files.some((file) => !file.type.startsWith("image/")))
                  toast.error(
                    "Selecione apenas fotos JPG ou PNG para o carrossel.",
                  );
                else addPosts(files, true);
              }
              e.target.value = "";
            }}
          />
          <input
            id="batch-files"
            aria-label="Um arquivo por nova postagem"
            type="file"
            multiple
            accept="image/jpeg,image/png,video/mp4"
            className="sr-only"
            disabled={frozen}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) addPosts(files);
              e.target.value = "";
            }}
          />
          <Button
            disabled={frozen || items.length >= 30}
            onClick={() => addPosts()}
          >
            <Plus size={16} className="mr-2" />
            Adicionar postagem
          </Button>
        </div>
      </div>
      <details className="x-batch-tools">
        <summary className="cursor-pointer text-sm font-medium">
          Opções do lote
        </summary>
        <div className="mt-4 space-y-4">
          <div className="space-y-2 min-w-48">
            <Label htmlFor="batch-account">Conta para novos posts</Label>
            <select
              id="batch-account"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={defaultAccount}
              disabled={frozen}
              onChange={(e) => setDefaultAccount(e.target.value)}
            >
              <option value="" disabled>
                Selecione uma conta
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batch-start">Primeiro horário</Label>
              <Input
                id="batch-start"
                type="datetime-local"
                value={start}
                disabled={frozen}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-interval">Intervalo em minutos</Label>
              <Input
                id="batch-interval"
                type="number"
                min={1}
                max={10080}
                value={interval}
                disabled={frozen}
                onChange={(e) => setInterval(Number(e.target.value))}
              />
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={frozen || !items.length}
            onClick={distribute}
          >
            Preencher horários dos cartões
          </Button>
          <p className="text-xs text-muted-foreground">
            Este botão substitui os horários atuais. Depois, cada horário
            continua editável.
          </p>
          <Label htmlFor="batch-caption">Legenda para preencher</Label>
          <Textarea
            id="batch-caption"
            value={caption}
            disabled={frozen}
            onChange={(e) => setCaption(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={frozen || !items.length}
            onClick={() =>
              setItems((old) => old.map((item) => ({ ...item, text: caption })))
            }
          >
            Aplicar legenda a todas
          </Button>
        </div>
      </details>
      <div className="x-batch-workspace">
        <aside className="x-batch-sidebar" aria-label="Postagens do lote">
          <div className="x-batch-list-title">
            <Files size={15} />
            <span>Postagens</span>
            <small>{completed} agendadas</small>
          </div>
          <nav aria-label="Selecionar postagem">
            {items.map((item, index) => {
              const account = accounts.find(
                (account) => account.id === item.accountId,
              );
              const date = new Date(item.scheduledAt || "");
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Editar postagem ${index + 1}`}
                  aria-current={activeId === item.id ? "true" : undefined}
                  className="x-batch-list-item"
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="x-batch-list-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="x-batch-list-copy">
                    <strong>
                      {item.text.trim() ||
                        (item.files.length
                          ? item.files[0].name
                          : "Nova postagem")}
                    </strong>
                    <span>
                      {Number.isFinite(date.getTime())
                        ? new Intl.DateTimeFormat("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(date)
                        : "Definir horário"}
                    </span>
                    <small>
                      @{account?.username || "selecione a conta"} ·{" "}
                      {item.files.length
                        ? `${item.files.length} mídia(s)`
                        : "Só texto"}
                    </small>
                    <em
                      className={
                        item.state === "error"
                          ? "text-destructive"
                          : item.state === "scheduled"
                            ? "text-emerald-300"
                            : ""
                      }
                    >
                      {labels[item.state]}
                    </em>
                  </span>
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </nav>
          {!items.length && (
            <p className="x-batch-list-empty">Seus posts aparecem aqui.</p>
          )}
        </aside>
        <div className="x-batch-editor-wrap">
          {!items.length && (
            <div className="x-batch-empty">
              <span>
                <Plus size={24} />
              </span>
              <h3>Prepare sua primeira postagem</h3>
              <p>
                Adicione um post para escolher a conta, o horário, a legenda e
                os arquivos.
              </p>
              <Button disabled={frozen} onClick={() => addPosts()}>
                Criar primeira postagem
              </Button>
            </div>
          )}
          {items.map((item, index) => {
            const account = accounts.find((a) => a.id === item.accountId);
            return (
              <article
                key={item.id}
                hidden={item.id !== activeId}
                aria-label={`Postagem ${index + 1}`}
                className="x-batch-editor space-y-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">Editar postagem {index + 1}</h4>
                  <span
                    role="status"
                    className={`text-xs ${item.state === "error" ? "text-destructive" : item.state === "scheduled" ? "text-emerald-300" : "text-muted-foreground"}`}
                  >
                    {labels[item.state]}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`account-${item.id}`}>Conta</Label>
                    <select
                      id={`account-${item.id}`}
                      aria-label={`Conta da postagem ${index + 1}`}
                      value={item.accountId}
                      disabled={frozen}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      onChange={(e) =>
                        edit(item.id, { accountId: e.target.value })
                      }
                    >
                      <option value="" disabled>
                        Selecione a conta
                      </option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          @{a.username}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`time-${item.id}`}>Data e horário</Label>
                    <Input
                      id={`time-${item.id}`}
                      aria-label={`Data e horário da postagem ${index + 1}`}
                      type="datetime-local"
                      value={localTime(item.scheduledAt || "")}
                      disabled={frozen}
                      onChange={(e) =>
                        edit(item.id, {
                          scheduledAt: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : "",
                        })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`text-${item.id}`}>Legenda</Label>
                  <Textarea
                    id={`text-${item.id}`}
                    aria-label={`Legenda da postagem ${index + 1}`}
                    value={item.text}
                    disabled={frozen}
                    rows={3}
                    placeholder="Escreva a legenda deste post…"
                    onChange={(e) => edit(item.id, { text: e.target.value })}
                  />
                  <p
                    className={`text-right text-xs ${textWeight(item.text) > 280 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {textWeight(item.text)}/280
                  </p>
                </div>
                <MediaDropZone
                  disabled={frozen}
                  label={`Arrastar arquivos para a postagem ${index + 1}`}
                  onFiles={(files) =>
                    changeFiles(item, [...item.files, ...files])
                  }
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {item.files.some((file) => file.type === "video/mp4")
                          ? "Vídeo desta postagem"
                          : item.files.length >= 2
                            ? "Carrossel de fotos"
                            : "Fotos desta postagem"}
                      </p>
                      <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                        {item.files.some((file) => file.type === "video/mp4")
                          ? "1 vídeo"
                          : `${item.files.length}/4 fotos`}
                      </span>
                    </div>
                    {item.files.length >= 2 && (
                      <p className="text-sm text-emerald-300">
                        As {item.files.length} fotos serão publicadas juntas, no
                        mesmo post.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Até 4 fotos JPG/PNG (5 MB cada) ou 1 vídeo MP4 (20 MB). O
                      envio de mídia é opcional.
                    </p>
                    {item.files.length > 0 && (
                      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                        {item.files.map((file, mediaIndex) => (
                          <div
                            key={`${item.id}-${mediaIndex}-${file.name}`}
                            className="min-w-0 rounded-xl border p-2 space-y-2"
                          >
                            <Preview file={file} />
                            <p className="truncate text-xs" title={file.name}>
                              {file.name}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              <label
                                className={`inline-flex items-center rounded-md border px-2 py-1 text-xs ${frozen ? "opacity-50" : "cursor-pointer hover:bg-muted"}`}
                                htmlFor={`replace-${item.id}-${mediaIndex}`}
                              >
                                Trocar
                              </label>
                              <input
                                className="sr-only"
                                id={`replace-${item.id}-${mediaIndex}`}
                                aria-label={`Trocar arquivo ${mediaIndex + 1} da postagem ${index + 1}`}
                                type="file"
                                accept="image/jpeg,image/png,video/mp4"
                                disabled={frozen}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const next = [...item.files];
                                    next[mediaIndex] = file;
                                    changeFiles(item, next);
                                  }
                                  e.target.value = "";
                                }}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={frozen}
                                aria-label={`Remover arquivo ${mediaIndex + 1} da postagem ${index + 1}`}
                                onClick={() =>
                                  changeFiles(
                                    item,
                                    item.files.filter(
                                      (_, i) => i !== mediaIndex,
                                    ),
                                  )
                                }
                              >
                                <Trash2 size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={frozen || mediaIndex === 0}
                                aria-label={`Mover arquivo ${mediaIndex + 1} da postagem ${index + 1} para antes`}
                                onClick={() => {
                                  const next = [...item.files];
                                  [next[mediaIndex], next[mediaIndex - 1]] = [
                                    next[mediaIndex - 1],
                                    next[mediaIndex],
                                  ];
                                  changeFiles(item, next);
                                }}
                              >
                                <ArrowUp size={14} />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="outline"
                      className="w-full border-dashed"
                      disabled={
                        frozen ||
                        item.files.length === 4 ||
                        item.files.some((file) => file.type === "video/mp4")
                      }
                      onClick={() =>
                        document.getElementById(`files-${item.id}`)?.click()
                      }
                    >
                      <Images size={17} className="mr-2" />
                      {item.files.some((file) => file.type === "video/mp4")
                        ? "Remova o vídeo para adicionar fotos"
                        : item.files.length === 4
                          ? "Carrossel completo: 4 fotos"
                          : item.files.length
                            ? "Adicionar fotos ao carrossel"
                            : "Adicionar fotos ou vídeo"}
                    </Button>
                    {!item.files.some((file) => file.type === "video/mp4") &&
                      item.files.length < 4 && (
                        <p className="text-xs text-muted-foreground">
                          Selecione várias fotos de uma vez ou adicione uma por
                          vez. Todas ficam nesta mesma postagem.
                        </p>
                      )}
                    <Input
                      className="sr-only"
                      id={`files-${item.id}`}
                      aria-label={`Adicionar arquivos à postagem ${index + 1}`}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,video/mp4"
                      disabled={
                        frozen ||
                        item.files.length === 4 ||
                        item.files.some((file) => file.type === "video/mp4")
                      }
                      onChange={(e) => {
                        const next = Array.from(e.target.files || []);
                        if (next.length)
                          changeFiles(item, [...item.files, ...next]);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </MediaDropZone>
                {account?.paused && (
                  <p className="text-sm text-amber-300">
                    Esta conta está pausada. Retome a conta para os posts serem
                    publicados.
                  </p>
                )}
                {account?.reconnect_required && (
                  <p className="text-sm text-amber-300">
                    Reconecte esta conta antes de agendar.
                  </p>
                )}
                {item.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {item.error}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={frozen || index === 0}
                    aria-label={`Mover postagem ${index + 1} para cima`}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={14} className="mr-1" />
                    Subir
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={frozen || index === items.length - 1}
                    aria-label={`Mover postagem ${index + 1} para baixo`}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={14} className="mr-1" />
                    Descer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={frozen || items.length >= 30}
                    aria-label={`Duplicar postagem ${index + 1}`}
                    onClick={() => {
                      try {
                        const next = [...items];
                        next.splice(index + 1, 0, {
                          ...item,
                          id: crypto.randomUUID(),
                          files: [...item.files],
                          media: undefined,
                          error: undefined,
                          state: "waiting",
                        });
                        checkSize(next);
                        setItems(next);
                        setSelectedId(next[index + 1].id);
                      } catch (error) {
                        toast.error((error as Error).message);
                      }
                    }}
                  >
                    <Copy size={14} className="mr-1" />
                    Duplicar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={frozen}
                    aria-label={`Remover postagem ${index + 1}`}
                    onClick={() =>
                      setItems((old) => old.filter((row) => row.id !== item.id))
                    }
                  >
                    <Trash2 size={14} className="mr-1" />
                    Remover postagem
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="x-batch-note">
        <ShieldCheck size={15} />
        <span>Limpeza de metadados automática</span>
        <span>·</span>
        <span>
          Horários: {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
      </div>
      {!!items.length && (
        <>
          <div className="x-batch-footer">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <p className="text-sm">
                {running
                  ? "Mantenha esta guia aberta até terminar."
                  : completed === items.length
                    ? "Lote concluído. Confira os posts na área Postagens."
                    : locked
                      ? "Os itens já agendados não serão repetidos."
                      : "Confira a conta, o horário, a legenda e os arquivos de cada cartão."}
              </p>
              {completed !== items.length && (
                <Button
                  disabled={disabled || running || !accounts.length}
                  onClick={submit}
                >
                  {running ? (
                    <Loader2 size={16} className="mr-2 animate-spin" />
                  ) : (
                    <CalendarClock size={16} className="mr-2" />
                  )}
                  {running
                    ? "Processando lote…"
                    : locked
                      ? "Continuar itens pendentes"
                      : `Limpar e agendar ${items.length} postagens`}
                </Button>
              )}
              {running && (
                <Button
                  variant="outline"
                  onClick={() => {
                    stopping.current = true;
                    toast.info(
                      "O processamento vai parar após a postagem atual.",
                    );
                  }}
                >
                  Parar após esta postagem
                </Button>
              )}
              {locked && !running && completed !== items.length && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Encerrar este lote? Os posts já agendados continuam na fila. Confira a área Postagens antes de recriar um item com erro de conexão.",
                      )
                    )
                      reset();
                  }}
                >
                  Encerrar lote
                </Button>
              )}
              {completed === items.length && (
                <Button variant="outline" onClick={reset}>
                  <CheckCircle2 size={16} className="mr-2" />
                  Novo lote
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
