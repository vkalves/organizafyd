import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
  devices,
  models,
  verifiedStatuses,
  localDay,
  type Table,
} from "./model";
import type { InstagramData } from "./data";
export interface EditRequest {
  table: Exclude<Table, "history" | "account_labels" | "projects" | "labels">;
  id?: string;
  values?: Record<string, unknown>;
  compact?: boolean;
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
    quantity: 1,
    ...request.values,
  };
  const [values, setValues] = useState(defaults);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(
    request.table === "ideas" && Boolean(request.id),
  );
  const formatOptions = Object.fromEntries(
    ["Feed", "Reel", "Story", "Carrossel"].map((x) => [x, x]),
  );
  const fields: Record<EditRequest["table"], Field[]> = {
    accounts: [
      { key: "username", label: "@username", required: true },
      { key: "status", label: "Status", options: statuses, required: true },
      {
        key: "niche",
        label: "Conta verificada?",
        options: verifiedStatuses,
        required: true,
      },
      { key: "email", label: "E-mail associado", type: "email", required: true },
      {
        key: "phone",
        label: "Número associado",
        type: "tel",
        required: true,
      },
      { key: "responsible", label: "Aparelho", options: devices, required: true },
      { key: "category", label: "Modelo", options: models, required: true },
      {
        key: "account_created_on",
        label: "Data de criação da conta",
        type: "date",
        required: true,
      },
      { key: "notes", label: "Observações", type: "textarea" },
    ],
    contents: request.compact
      ? [
          {
            key: "account_id",
            label: "Conta",
            options: accountOptions,
            required: true,
          },
          {
            key: "quantity",
            label: "Quantidade de conteúdos",
            type: "stepper",
            required: true,
          },
          {
            key: "publication_url",
            label: "Grupo de Vídeos",
            required: true,
          },
        ]
      : [
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
        options: formatOptions,
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
    ideas: [
      { key: "content", label: "Detalhes", type: "textarea", required: true },
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
    accounts: "conta",
    contents: "conteúdo",
    tasks: "tarefa",
    metrics: "métricas",
    ideas: "ideia",
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
            {request.table === "ideas" && viewing
              ? "Ideia"
              : `${request.id ? "Editar" : "Adicionar"} ${request.compact ? "conteúdo pendente" : names[request.table]}`}
          </DialogTitle>
          {!(request.table === "ideas" && viewing) && (
            <DialogDescription>
              Preencha os dados. Campos com * são obrigatórios.
            </DialogDescription>
          )}
        </DialogHeader>
        {request.table === "ideas" && viewing ? (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap break-words text-sm">
              {String(values.content || "Sem conteúdo")}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Fechar
              </Button>
              <Button type="button" onClick={() => setViewing(false)}>
                Editar
              </Button>
            </div>
          </div>
        ) : (
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
              clean.name = String(values.name ?? "").trim() || clean.username;
            }
            if (request.table === "contents" && request.compact) {
              const qty = Math.max(1, Math.floor(Number(values.quantity) || 0));
              if (!qty) {
                setError("Preencha a quantidade de conteúdos.");
                return;
              }
              let link = String(values.publication_url || "").trim();
              if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
              const href = safeUrl(link);
              if (!href) {
                setError("Informe um link válido no grupo de vídeos.");
                return;
              }
              let host = "Grupo de vídeos";
              try {
                host = new URL(href).hostname.replace(/^www\./, "");
              } catch {
                /* keep fallback */
              }
              clean.quantity = qty;
              clean.title = host;
              clean.publication_url = href;
              clean.format = "Reel";
              clean.status = "idea";
            }
            if (request.table === "ideas") {
              clean.account_id = values.account_id;
              const text = String(clean.content || "").trim();
              if (!text) {
                setError("Preencha os detalhes.");
                return;
              }
              clean.content = text;
              clean.title = text.split("\n")[0].slice(0, 80);
              if (!clean.account_id) {
                setError("Abra a conta para salvar a ideia.");
                return;
              }
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
                    f.type === "textarea" || f.key === "publication_url"
                      ? "sm:col-span-2 min-w-0"
                      : "min-w-0"
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
                        {f.required ? "Selecionar" : "Opcional"}
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
                  ) : f.type === "stepper" ? (
                    <div className="flex h-11">
                      <Input
                        id={`ig-${f.key}`}
                        className="h-11 rounded-r-none"
                        inputMode="numeric"
                        required={f.required}
                        value={value}
                        onChange={(e) => {
                          const next = e.target.value.replace(/\D/g, "");
                          setValues({
                            ...values,
                            [f.key]: next ? Math.max(1, Number(next)) : "",
                          });
                        }}
                      />
                      <div className="flex w-9 shrink-0 flex-col overflow-hidden rounded-r-md border border-l-0 border-input">
                        <button
                          type="button"
                          className="flex flex-1 items-center justify-center hover:bg-accent"
                          aria-label="Aumentar quantidade"
                          onClick={() =>
                            setValues({
                              ...values,
                              [f.key]: Math.max(1, Number(value) || 0) + 1,
                            })
                          }
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="flex flex-1 items-center justify-center border-t border-input hover:bg-accent"
                          aria-label="Diminuir quantidade"
                          onClick={() =>
                            setValues({
                              ...values,
                              [f.key]: Math.max(1, (Number(value) || 1) - 1),
                            })
                          }
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : f.type === "digits" ? (
                    <Input
                      id={`ig-${f.key}`}
                      className="h-11"
                      inputMode="numeric"
                      required={f.required}
                      value={value}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          [f.key]: e.target.value.replace(/\D/g, ""),
                        })
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
        )}
      </DialogContent>
    </Dialog>
  );
}
