import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { adminRequest, type ManagedUser } from "./api";

const GB = 1024 ** 3;
function formatBytes(bytes: number) {
  if (bytes === 0) return "0 GB";
  if (bytes < GB) return `${(bytes / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB`;
  return `${(bytes / GB).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`;
}
export function StoragePermissions({ user, onSaved }: { user: ManagedUser; onSaved: () => void }) {
  const [space, setSpace] = useState(String((user.storage_limit_bytes ?? GB) / GB));
  const bytes = Math.round(Number(space) * GB);
  const valid = space.trim() !== "" && Number.isFinite(Number(space)) && Number(space) >= 0 && Number(space) <= 10000 && Number.isSafeInteger(bytes);
  const save = useMutation({
    mutationFn: (limitBytes: number) => adminRequest("update_storage_limit", { user_id: user.id, limit_bytes: limitBytes }),
    onSuccess: onSaved,
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !user.is_admin) save.mutate(bytes);
  }
  const overLimit = user.storage_limit_bytes !== null && user.storage_used_bytes > user.storage_limit_bytes;
  return <section className="admin-storage" aria-label={`Armazenamento de ${user.email || user.display_name}`}>
    <h3><HardDrive size={16} aria-hidden="true" /> Armazenamento de mídias</h3>
    <p className="admin-usage">Em uso e envios reservados: <strong>{formatBytes(user.storage_used_bytes)}</strong> · Limite: <strong>{user.storage_limit_bytes === null ? "Sem limite" : formatBytes(user.storage_limit_bytes)}</strong></p>
    {user.is_admin ? <p className="admin-note">Administradores têm armazenamento sem limite.</p> : <form className="admin-permissions" onSubmit={submit} aria-label={`Limite de armazenamento de ${user.email || user.display_name}`}>
      <label className="admin-limit">Espaço permitido (GB)<input type="number" min="0" max="10000" step="0.01" required value={space} onChange={event => setSpace(event.target.value)} disabled={save.isPending} /></label>
      <button className="button button-primary" type="submit" disabled={!valid || save.isPending}>{save.isPending ? "Salvando espaço…" : "Salvar armazenamento"}</button>
    </form>}
    {overLimit && <p className="admin-note">Acima do limite. As mídias existentes são preservadas; novos envios ficam bloqueados até haver espaço.</p>}
    {save.isError && <p role="alert" className="admin-error">{save.error.message}</p>}
    {save.isSuccess && <p role="status">Limite de armazenamento salvo.</p>}
  </section>;
}
