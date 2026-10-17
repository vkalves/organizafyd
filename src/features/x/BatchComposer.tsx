import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Copy,
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
import { type XAccount } from "./api";
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
  function addPosts(files?: File[]) {
    try {
      const next = [
        ...items,
        ...(files ? files.map((file) => makeItem([file])) : [makeItem()]),
      ];
      if (next.length > 30)
        throw new Error("Adicione até 30 postagens por lote.");
      checkSize(next);
      next.forEach((item) => validatePostFiles(item.files));
      setItems(next);
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
    setLocked(false);
  }
  return (
    <section className="space-y-5" aria-label="Agendar em lote">
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Files size={20} />
            Monte cada postagem do seu jeito
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Cada cartão tem sua própria conta, data, horário, legenda e mídias.
            Mudar a ordem dos cartões não muda os horários.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
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
          <Button
            disabled={frozen || items.length >= 30}
            onClick={() => addPosts()}
          >
            <Plus size={16} className="mr-2" />
            Adicionar postagem
          </Button>
        </div>
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Importar vários arquivos como posts separados
          </summary>
          <div className="mt-3 space-y-2">
            <Label htmlFor="batch-files">Um arquivo por nova postagem</Label>
            <Input
              id="batch-files"
              type="file"
              multiple
              accept="image/jpeg,image/png,video/mp4"
              disabled={frozen}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length) addPosts(files);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              Depois, escolha o horário e a legenda de cada um. Até 30 postagens
              e 200 MB por lote.
            </p>
          </div>
        </details>
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Preencher vários posts de uma vez (opcional)
          </summary>
          <div className="mt-4 space-y-4">
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
                setItems((old) =>
                  old.map((item) => ({ ...item, text: caption })),
                )
              }
            >
              Aplicar legenda a todas
            </Button>
          </div>
        </details>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck size={16} className="shrink-0 text-emerald-300" />A
          limpeza de metadados continua automática antes do envio. Vídeos são
          reprocessados e podem mudar de tamanho e qualidade.
        </p>
      </div>
      {!items.length && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Clique em Adicionar postagem para escolher todos os detalhes do
          primeiro post.
        </div>
      )}
      {!!items.length && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">
              {items.length} postagens · {completed} agendadas
            </h3>
            <p className="text-xs text-muted-foreground">
              Horários no fuso do dispositivo:{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          </div>
          <div className="space-y-5">
            {items.map((item, index) => {
              const account = accounts.find((a) => a.id === item.accountId);
              return (
                <article
                  key={item.id}
                  aria-label={`Postagem ${index + 1}`}
                  className="rounded-2xl border bg-card p-4 md:p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold">Postagem {index + 1}</h4>
                    <span
                      role="status"
                      className={`text-xs ${item.state === "error" ? "text-destructive" : item.state === "scheduled" ? "text-emerald-300" : "text-muted-foreground"}`}
                    >
                      {labels[item.state]}
                    </span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`account-${item.id}`}>
                        Conta da postagem {index + 1}
                      </Label>
                      <select
                        id={`account-${item.id}`}
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
                      <Label htmlFor={`time-${item.id}`}>
                        Data e horário da postagem {index + 1}
                      </Label>
                      <Input
                        id={`time-${item.id}`}
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
                    <Label htmlFor={`text-${item.id}`}>
                      Legenda da postagem {index + 1}
                    </Label>
                    <Textarea
                      id={`text-${item.id}`}
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
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      Arquivos desta postagem
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Até 4 fotos JPG/PNG (5 MB cada) ou 1 vídeo MP4 (20 MB).
                      Você também pode publicar só texto.
                    </p>
                    {item.files.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                    <Label className="block" htmlFor={`files-${item.id}`}>
                      Adicionar arquivos à postagem {index + 1}
                    </Label>
                    <Input
                      id={`files-${item.id}`}
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
                  {account?.paused && (
                    <p className="text-sm text-amber-300">
                      Esta conta está pausada. Retome a conta para os posts
                      serem publicados.
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
                        setItems((old) =>
                          old.filter((row) => row.id !== item.id),
                        )
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
          <div className="sticky bottom-3 rounded-xl border bg-background/95 p-4 shadow-xl backdrop-blur space-y-3">
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
