import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Files,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { type XAccount } from "./api";
import { validateFile } from "./clean-media";
import {
  batchTimes,
  submitBatch,
  validateBatch,
  type BatchItem,
  type BatchState,
} from "./batch";
import { textWeight } from "../../../supabase/functions/x-publisher/model";
const labels: Record<BatchState, string> = {
  waiting: "Aguardando",
  cleaning: "Limpando metadados…",
  uploading: "Enviando mídia limpa…",
  scheduling: "Confirmando agendamento…",
  scheduled: "Agendado",
  error: "Precisa de atenção",
};
const format = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});
function firstTime() {
  const value = new Date(Date.now() + 3600000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
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
  const [accountId, setAccountId] = useState("");
  const [start, setStart] = useState(firstTime);
  const [interval, setInterval] = useState(180);
  const [caption, setCaption] = useState("");
  const selected = accounts.find((a) => a.id === accountId);
  const frozen = disabled || running || locked;
  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);
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
  const completed = items.filter((i) => i.state === "scheduled").length;
  function add(files: File[]) {
    try {
      if (items.length + files.length > 30)
        throw new Error("Envie até 30 arquivos por lote.");
      if (
        [...items.map((i) => i.file), ...files].reduce(
          (sum, f) => sum + f.size,
          0,
        ) >
        200 * 1024 * 1024
      )
        throw new Error(
          "O lote pode ter até 200 MB. Divida os arquivos em lotes menores.",
        );
      files.forEach(validateFile);
      setItems((old) => [
        ...old,
        ...files.map((file) => ({
          id: crypto.randomUUID(),
          file,
          text: caption,
          state: "waiting" as const,
        })),
      ]);
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
  async function submit() {
    if (runningRef.current || !selected || selected.reconnect_required) return;
    try {
      validateBatch(items);
      if (!locked) {
        const times = batchTimes(start, interval, items.length);
        jobs.current = items.map((item, i) => ({
          ...item,
          scheduledAt: times[i],
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
        accountId,
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
  return (
    <section className="space-y-5" aria-label="Agendar em lote">
      <div className="rounded-2xl border bg-card p-5 space-y-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Files size={20} />
            Agendar várias postagens
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Cada arquivo vira uma postagem. Ajuste as legendas, a ordem e o
            intervalo antes de confirmar.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="batch-account">Conta do lote</Label>
            <select
              id="batch-account"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={accountId}
              disabled={frozen}
              onChange={(e) => setAccountId(e.target.value)}
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
            <Label htmlFor="batch-start">Primeira postagem</Label>
            <Input
              id="batch-start"
              type="datetime-local"
              value={start}
              disabled={frozen}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="batch-interval">Intervalo entre posts</Label>
            <select
              id="batch-interval"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={interval}
              disabled={frozen}
              onChange={(e) => setInterval(Number(e.target.value))}
            >
              {[
                [30, "30 minutos"],
                [60, "1 hora"],
                [120, "2 horas"],
                [180, "3 horas"],
                [360, "6 horas"],
                [720, "12 horas"],
                [1440, "1 dia"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="batch-caption">Legenda padrão (opcional)</Label>
          <Textarea
            id="batch-caption"
            value={caption}
            disabled={frozen}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Você também pode escrever uma legenda diferente em cada postagem."
          />
          <Button
            size="sm"
            variant="outline"
            disabled={frozen || !items.length}
            onClick={() =>
              setItems((old) => old.map((item) => ({ ...item, text: caption })))
            }
          >
            Aplicar legenda a todas
          </Button>
        </div>
        <div className="rounded-xl border border-dashed p-5 space-y-3">
          <Label htmlFor="batch-files">Adicionar fotos ou vídeos</Label>
          <Input
            id="batch-files"
            type="file"
            accept="image/jpeg,image/png,video/mp4"
            multiple
            disabled={frozen}
            onChange={(e) => {
              add(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <p className="text-xs text-muted-foreground">
            Até 30 arquivos, 200 MB no total. JPG/PNG: 5 MB cada. MP4: 20 MB
            cada.
          </p>
        </div>
        <div className="flex gap-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" />
          <div className="text-sm">
            <strong>Limpeza de metadados automática</strong>
            <p className="mt-1 text-muted-foreground">
              As mídias são reconstruídas antes do envio, sem copiar
              localização, câmera, autor, datas e nomes originais. Dados
              técnicos necessários, como resolução e duração, permanecem. Vídeos
              são reprocessados e podem mudar de tamanho e qualidade.
            </p>
          </div>
        </div>
        {selected?.paused && (
          <p className="text-sm text-amber-300">
            Esta conta está pausada. Os posts serão agendados, mas só serão
            publicados depois que você retomar a conta.
          </p>
        )}
        {selected?.reconnect_required && (
          <p className="text-sm text-amber-300">
            Reconecte esta conta na área Contas antes de agendar.
          </p>
        )}
      </div>
      {!!items.length && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">
              {items.length} postagens · {completed} agendadas
            </h3>
            <span className="text-xs text-muted-foreground">
              Horário: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
          </div>
          <div className="space-y-3">
            {items.map((item, index) => {
              const date = item.scheduledAt
                ? Date.parse(item.scheduledAt)
                : Date.parse(start) + interval * index * 60000;
              return (
                <article
                  key={item.id}
                  className="rounded-xl border bg-card p-4 grid gap-4 md:grid-cols-[160px_1fr]"
                >
                  <Preview file={item.file} />
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm">
                        {index + 1}.{" "}
                        {Number.isFinite(date)
                          ? format.format(date)
                          : "Escolha o horário"}
                      </strong>
                      <span
                        role="status"
                        className={`text-xs ${item.state === "error" ? "text-destructive" : item.state === "scheduled" ? "text-emerald-300" : "text-muted-foreground"}`}
                      >
                        {labels[item.state]}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.file.name}
                    </p>
                    <Textarea
                      aria-label={`Legenda da postagem ${index + 1}`}
                      value={item.text}
                      disabled={frozen}
                      rows={2}
                      onChange={(e) =>
                        setItems((old) =>
                          old.map((i) =>
                            i.id === item.id
                              ? { ...i, text: e.target.value }
                              : i,
                          ),
                        )
                      }
                    />
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs ${textWeight(item.text) > 280 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {textWeight(item.text)}/280
                      </span>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Mover postagem ${index + 1} para cima`}
                          disabled={frozen || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Mover postagem ${index + 1} para baixo`}
                          disabled={frozen || index === items.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown size={15} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remover postagem ${index + 1}`}
                          disabled={frozen}
                          onClick={() =>
                            setItems((old) =>
                              old.filter((i) => i.id !== item.id),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </div>
                    {item.error && (
                      <p role="alert" className="text-sm text-destructive">
                        {item.error}
                      </p>
                    )}
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
                    ? "Lote concluído. Você pode conferir os posts na área Postagens."
                    : locked
                      ? "Os itens já agendados não serão repetidos."
                      : "Confira a ordem e os horários antes de agendar."}
              </p>
              {completed !== items.length && (
                <Button
                  disabled={
                    disabled ||
                    running ||
                    !selected ||
                    selected.reconnect_required
                  }
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
                      "O processamento vai parar após o arquivo atual.",
                    );
                  }}
                >
                  Parar após este arquivo
                </Button>
              )}
              {locked && !running && completed !== items.length && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Encerrar este lote? Os posts já enviados para agendamento continuam na fila. Confira a área Postagens antes de criar novamente um item com erro de conexão.",
                      )
                    ) {
                      setItems([]);
                      jobs.current = [];
                      setLocked(false);
                      setStart(firstTime());
                    }
                  }}
                >
                  Encerrar lote
                </Button>
              )}
              {completed === items.length && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setItems([]);
                    jobs.current = [];
                    setLocked(false);
                    setStart(firstTime());
                  }}
                >
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
