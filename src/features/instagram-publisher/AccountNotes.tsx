import { useId, useState } from "react";
import { Loader2, NotebookPen } from "lucide-react";

export function AccountNotes({
  username,
  value,
  savedValue,
  onChange,
  onSave,
}: {
  username: string;
  value: string;
  savedValue: string;
  onChange: (value: string) => void;
  onSave: (value: string) => Promise<void>;
}) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = value !== savedValue;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError("");
    try {
      await onSave(value);
      setSaved(true);
    } catch {
      setError(
        "Não foi possível salvar. Seu texto continua aqui; tente novamente.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="ig-account-notes"
      onSubmit={save}
      aria-label={`Bloco de notas de @${username}`}
    >
      <label htmlFor={id}>
        <NotebookPen size={15} aria-hidden="true" /> Bloco de notas
      </label>
      <p id={`${id}-help`}>
        Anote futuras contas, perfis de reserva e próximos passos.
      </p>
      <textarea
        id={id}
        aria-label={`Anotações de @${username}`}
        aria-describedby={`${id}-help`}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setError("");
        }}
        maxLength={20000}
        rows={4}
        placeholder={
          "Ex.: Próxima conta: @novo_perfil\nConectar quando o perfil estiver pronto."
        }
      />
      <div className="ig-account-notes-footer">
        <span role="status">
          {saving
            ? "Salvando…"
            : dirty
              ? "Alterações não salvas"
              : saved
                ? "Anotações salvas"
                : value
                  ? "Salvo na sua conta"
                  : "As notas ficam salvas na sua conta da Avança."}
        </span>
        <button
          type="submit"
          className="button button-secondary"
          disabled={saving || !dirty}
        >
          {saving && (
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          )}{" "}
          Salvar anotações
        </button>
      </div>
      {error && (
        <p className="ig-account-notes-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
