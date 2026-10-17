import { uploadFiles, xRequest, type XMedia } from "./api";
import { textWeight } from "../../../supabase/functions/x-publisher/model";
export type BatchState =
  "waiting" | "cleaning" | "uploading" | "scheduling" | "scheduled" | "error";
export interface BatchItem {
  id: string;
  file: File;
  text: string;
  state: BatchState;
  error?: string;
  media?: XMedia[];
  scheduledAt?: string;
}
export function batchTimes(
  start: string,
  interval: number,
  count: number,
  now = Date.now(),
) {
  const first = Date.parse(start);
  if (!Number.isFinite(first) || first < now + 60000)
    throw new Error(
      "Escolha o primeiro horário com pelo menos 1 minuto de antecedência.",
    );
  if (!Number.isFinite(interval) || interval < 1 || interval > 10080)
    throw new Error("Use um intervalo entre 1 minuto e 7 dias.");
  const times = Array.from({ length: count }, (_, i) =>
    new Date(first + i * interval * 60000).toISOString(),
  );
  if (
    times.length &&
    Date.parse(times[times.length - 1]) > now + 365 * 86400000
  )
    throw new Error("Todas as postagens precisam estar dentro de um ano.");
  return times;
}
export function validateBatch(items: BatchItem[]) {
  if (!items.length || items.length > 30)
    throw new Error("Selecione entre 1 e 30 arquivos.");
  if (items.some((item) => textWeight(item.text) > 280))
    throw new Error("Uma das legendas ultrapassa 280 caracteres.");
}
// Stable UUID and media references survive retries. Successful rows are skipped;
// ambiguous responses retry the same idempotent server request, never a new post.
export async function submitBatch(
  items: BatchItem[],
  accountId: string,
  userId: string,
  update: (item: BatchItem) => void,
  shouldStop: () => boolean = () => false,
) {
  for (const item of items) {
    if (shouldStop()) break;
    if (item.state === "scheduled") continue;
    const report = (state: BatchState, error?: string) => {
      item.state = state;
      item.error = error;
      update({ ...item });
    };
    try {
      if (!item.media) {
        report("cleaning");
        item.media = await uploadFiles([item.file], userId, (stage) =>
          report(stage),
        );
      }
      report("scheduling");
      await xRequest("schedule", {
        id: item.id,
        accountId,
        text: item.text,
        media: item.media,
        scheduledAt: item.scheduledAt,
      });
      report("scheduled");
    } catch (error) {
      report(
        "error",
        error instanceof Error
          ? error.message
          : "Não foi possível agendar esta postagem.",
      );
    }
  }
}
