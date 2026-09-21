import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  localInput,
  safeUrl,
  statuses,
  stages,
  priorities,
  taskStatuses,
  metricNames,
  localDay,
  type Table,
} from "./model";
import type { InstagramData } from "./data";
export interface EditRequest {
  table: Exclude<Table, "history" | "account_labels">;
  id?: string;
  values?: Record<string, unknown>;
}
type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: Record<string, string>;
};
export const selectClass =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
export function Editor({
  request,
  data,
  onClose,
  onSave,
  saving,
}: {
  request: EditRequest;
  data: InstagramData;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}) {
  const accountOptions = Object.fromEntries(
    data.accounts.map((a) => [a.id, `@${a.username}`]),
  );
  const defaults: Record<string, unknown> = {
    status:
      request.table === "accounts"
        ? "active"
        : request.table === "contents"
          ? "idea"
          : "todo",
    format: "Reel",
    priority: "medium",
    recorded_on: localDay(),
    ...request.values,
  };
  const [values, setValues] = useState(defaults);
  const [error, setError] = useState("");
  const fields: Record<EditRequest["table"], Field[]> = {
    projects: [
      { key: "name", label: "Nome do projeto", required: true },
      { key: "image_url", label: "Imagem do projeto (URL)", type: "url" },
    ],
    labels: [{ key: "name", label: "Nome da etiqueta", required: true }],
    accounts: [
      { key: "username", label: "@username", required: true },
      { key: "status", label: "Status", options: statuses, required: true },
      { key: "email", label: "E-mail associado", type: "email" },
      { key: "phone", label: "Telefone associado", type: "tel" },
      {
        key: "account_created_on",
        label: "Data de criação da conta",
        type: "date",
      },
      { key: "notes", label: "Observações", type: "textarea" },
    ],
    contents: [
      {
        key: "account_id",
        label: "Conta",
        options: accountOptions,
        required: true,
      },
      { key: "title", label: "Título", required: true },
      {
        key: "format",
        label: "Formato",
        options: Object.fromEntries(
          ["Feed", "Reel", "Story", "Carrossel"].map((x) => [x, x]),
        ),
        required: true,
      },
      { key: "status", label: "Etapa", options: stages, required: true },
      { key: "media_url", label: "Imagem ou vídeo (URL)", type: "url" },
      { key: "thumbnail_url", label: "Miniatura (URL)", type: "url" },
      { key: "caption", label: "Legenda", type: "textarea" },
      { key: "hashtags", label: "Hashtags" },
      { key: "notes", label: "Observações", type: "textarea" },
      {
        key: "planned_at",
        label: "Data e horário planejados",
        type: "datetime-local",
      },
      {
        key: "published_at",
        label: "Data e horário da publicação",
        type: "datetime-local",
      },
      { key: "publication_url", label: "Link da publicação", type: "url" },
    ],
    tasks: [
      {
        key: "account_id",
        label: "Conta",
        options: accountOptions,
        required: true,
      },
      { key: "title", label: "Tarefa", required: true },
      { key: "description", label: "Descrição", type: "textarea" },
      { key: "due_at", label: "Data e horário", type: "datetime-local" },
      {
        key: "priority",
        label: "Prioridade",
        options: priorities,
        required: true,
      },
      { key: "status", label: "Status", options: taskStatuses, required: true },
      { key: "notes", label: "Observações", type: "textarea" },
    ],
    metrics: [
      {
        key: "account_id",
        label: "Conta",
        options: accountOptions,
        required: true,
      },
      {
        key: "recorded_on",
        label: "Data do registro",
        type: "date",
        required: true,
      },
      ...Object.entries(metricNames).map(([key, label]) => ({
        key,
        label,
        type: "number",
      })),
    ],
  };
  const names = {
    projects: "projeto",
    accounts: "conta",
    contents: "conteúdo",
    tasks: "tarefa",
    metrics: "métricas",
    labels: "etiqueta",
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="safe-dialog-content w-[calc(100%_-_1rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {request.id ? "Editar" : "Adicionar"} {names[request.table]}
          </DialogTitle>
          <DialogDescription>
            Preencha os dados. Campos com * são obrigatórios.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const clean: Record<string, unknown> = {};
            for (const f of fields[request.table]) {
              const v = String(values[f.key] ?? "").trim();
              if (f.required && !v) {
                setError(`Preencha ${f.label}.`);
                return;
              }
              if (f.type === "url" && v && !safeUrl(v)) {
                setError("Use links http ou https válidos.");
                return;
              }
              clean[f.key] =
                v === ""
                  ? null
                  : f.type === "number"
                    ? Number(v)
                    : f.type === "datetime-local"
                      ? new Date(v).toISOString()
                      : v;
            }
            if (request.table === "accounts") {
              clean.username = String(clean.username)
                .replace(/^@/, "")
                .toLowerCase();
              if (!/^[a-z0-9._]{1,30}$/.test(String(clean.username))) {
                setError(
                  "Username: use até 30 letras, números, pontos ou sublinhados.",
                );
                return;
              }
              // name continua obrigatório no banco; usa o username quando o campo some do formulário
              clean.name = String(values.name ?? "").trim() || clean.username;
            }
            if (
              request.table === "contents" &&
              clean.status === "published" &&
              !clean.published_at
            ) {
              setError("Informe quando o conteúdo foi publicado.");
              return;
            }
            if (
              request.table === "contents" &&
              clean.status === "scheduled" &&
              !clean.planned_at
            ) {
              setError("Informe a data planejada para agendar.");
              return;
            }
            if (
              request.table === "metrics" &&
              !Object.keys(metricNames).some((k) => clean[k] !== null)
            ) {
              setError("Informe pelo menos uma métrica.");
              return;
            }
            try {
              await onSave(clean);
            } catch {
              setError(
                "Não foi possível salvar. Seus dados continuam neste formulário.",
              );
            }
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields[request.table].map((f) => {
              let value = String(values[f.key] ?? "");
              if (f.type === "datetime-local" && value.endsWith("Z"))
                value = localInput(value);
              return (
                <div
                  key={f.key}
                  className={
                    f.type === "textarea" ? "sm:col-span-2 min-w-0" : "min-w-0"
                  }
                >
                  <Label htmlFor={`ig-${f.key}`}>
                    {f.label}
                    {f.required ? " *" : ""}
                  </Label>
                  {f.options ? (
                    <select
                      id={`ig-${f.key}`}
                      className={selectClass}
                      required={f.required}
                      value={value}
                      onChange={(e) =>
                        setValues({ ...values, [f.key]: e.target.value })
                      }
                    >
                      <option value="">
                        {f.required ? "Selecionar" : "Sem projeto"}
                      </option>
                      {Object.entries(f.options).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "textarea" ? (
                    <Textarea
                      id={`ig-${f.key}`}
                      value={value}
                      onChange={(e) =>
                        setValues({ ...values, [f.key]: e.target.value })
                      }
                    />
                  ) : (
                    <Input
                      id={`ig-${f.key}`}
                      className="h-11"
                      type={f.type || "text"}
                      required={f.required}
                      min={f.type === "number" ? 0 : undefined}
                      max={
                        f.type === "number"
                          ? Number.MAX_SAFE_INTEGER
                          : undefined
                      }
                      step={f.type === "number" ? 1 : undefined}
                      maxLength={
                        f.type === "text" || !f.type ? 2000 : undefined
                      }
                      value={value}
                      onChange={(e) =>
                        setValues({ ...values, [f.key]: e.target.value })
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
