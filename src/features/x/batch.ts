import { uploadFiles, xRequest, type XMedia } from "./api";
import { validateFile } from "./clean-media";
import { textWeight } from "../../../supabase/functions/x-publisher/model";
export type BatchState =
  "waiting" | "cleaning" | "uploading" | "scheduling" | "scheduled" | "error";
export interface BatchItem {
  id: string;
  files: File[];
  accountId: string;
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
export function validateBatch(items: BatchItem[], now = Date.now()) {
  if (!items.length || items.length > 30)
    throw new Error("Adicione entre 1 e 30 postagens.");
  if (
    items
      .flatMap((item) => item.files)
      .reduce((sum, file) => sum + file.size, 0) >
    200 * 1024 * 1024
  )
    throw new Error("O lote pode ter até 200 MB.");
  for (const [index, item] of items.entries()) {
    if (item.state === "scheduled") continue;
    const prefix = `Postagem ${index + 1}: `;
    if (!item.accountId) throw new Error(prefix + "selecione a conta.");
    if (textWeight(item.text) > 280)
      throw new Error(prefix + "a legenda ultrapassa 280 caracteres.");
    if (!item.text.trim() && !item.files.length)
      throw new Error(prefix + "adicione uma legenda ou uma mídia.");
    validatePostFiles(item.files);
    const time = Date.parse(item.scheduledAt || "");
    if (
      !Number.isFinite(time) ||
      time < now + 60000 ||
      time > now + 365 * 86400000
    )
      throw new Error(
        prefix + "escolha uma data válida, de 1 minuto até 1 ano à frente.",
      );
  }
}
export function validatePostFiles(files: File[]) {
  if (
    files.length > 4 ||
    (files.some((file) => file.type === "video/mp4") && files.length !== 1)
  )
    throw new Error(
      "Cada postagem aceita até 4 fotos ou 1 vídeo. Não misture fotos e vídeo.",
    );
  files.forEach(validateFile);
}
// Stable UUID and media references survive retries. Successful rows are skipped;
// ambiguous responses retry the same idempotent server request, never a new post.
export async function submitBatch(
  items: BatchItem[],
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
        item.media = await uploadFiles(item.files, userId, (stage) =>
          report(stage),
        );
      }
      report("scheduling");
      await xRequest("schedule", {
        id: item.id,
        accountId: item.accountId,
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
