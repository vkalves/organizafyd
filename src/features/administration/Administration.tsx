import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, ShieldCheck, Users, Instagram, Ban } from "lucide-react";
import { adminRequest, useAdministrationAccess, type ManagedUser, type UserDirectory } from "./api";
import "./administration.css";

function UserPermissions({ user, onSaved }: { user: ManagedUser; onSaved: () => void }) {
  const [allowed, setAllowed] = useState(user.connection_allowed);
  const [unlimited, setUnlimited] = useState(user.max_accounts === null);
  const [limit, setLimit] = useState(String(user.max_accounts ?? 1));
  const numericLimit = Number(limit);
  const valid = unlimited || (limit.trim() !== "" && Number.isInteger(numericLimit) && numericLimit >= 0 && numericLimit <= 10000);
  const save = useMutation({
    mutationFn: () => adminRequest("update_access", {
      user_id: user.id, connection_allowed: allowed, max_accounts: unlimited ? null : numericLimit,
    }),
    onSuccess: onSaved,
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }
  return (
    <article className="admin-user">
      <div className="admin-user-heading">
        <div><h2>{user.display_name || user.email || "Usuário sem nome"}</h2>{user.display_name && <p>{user.email}</p>}</div>
        {user.is_admin && <span className="admin-badge"><ShieldCheck size={14} /> Administrador</span>}
      </div>
      <p className="admin-usage"><strong>{user.connected_accounts}</strong> conta(s) conectada(s) · Limite atual: <strong>{user.max_accounts === null ? "Sem limite" : user.max_accounts}</strong> · {user.connection_allowed ? "Novas conexões liberadas" : "Novas conexões bloqueadas"}</p>
      <form onSubmit={submit} className="admin-permissions" aria-label={`Permissões de ${user.email || user.display_name}`}>
        <label className="admin-check"><input type="checkbox" checked={allowed} onChange={e => setAllowed(e.target.checked)} disabled={save.isPending} /> Permitir novas conexões</label>
        <label className="admin-check"><input type="checkbox" checked={unlimited} onChange={e => setUnlimited(e.target.checked)} disabled={save.isPending} /> Sem limite</label>
        <label className="admin-limit">Máximo de contas<input type="number" min="0" max="10000" step="1" required={!unlimited} value={limit} disabled={unlimited || save.isPending} onChange={e => setLimit(e.target.value)} /></label>
        <button className="button button-primary" type="submit" disabled={!valid || save.isPending}>{save.isPending ? "Salvando…" : "Salvar permissões"}</button>
      </form>
      {user.max_accounts !== null && user.connected_accounts > user.max_accounts && <p className="admin-note">Acima do limite. As contas atuais continuam conectadas; novas conexões ficam bloqueadas até haver uma vaga.</p>}
      {save.isError && <p role="alert" className="admin-error">{save.error.message}</p>}
      {save.isSuccess && <p role="status">Permissões salvas.</p>}
    </article>
  );
}

export default function Administration() {
  const access = useAdministrationAccess();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const directory = useQuery({
    queryKey: ["avanca-admin-users", filter, page],
    queryFn: () => adminRequest<UserDirectory>("users", { search: filter, page }),
    enabled: access.data?.is_admin === true,
    retry: false,
  });
  function onSaved() {
    void client.invalidateQueries({ queryKey: ["avanca-admin-users"] });
    void client.invalidateQueries({ queryKey: ["avanca-access"] });
  }
  if (access.isPending) return <p role="status">Verificando acesso administrativo…</p>;
  if (access.isError) return <section className="panel"><p role="alert">{access.error.message}</p><button className="button button-secondary" onClick={() => void access.refetch()}>Tentar novamente</button></section>;
  if (!access.data?.is_admin) return <section className="panel"><h1 className="page-title">Acesso restrito</h1><p>Esta área é exclusiva de administradores.</p><Link className="button button-secondary" to="/avanca">Voltar à dashboard</Link></section>;
  return (
    <div className="admin-panel">
      <header className="topbar"><div><div className="eyebrow">Administração</div><h1 className="page-title">Usuários e limites</h1><p className="page-subtitle">Controle quem pode conectar contas do Instagram e quantas contas cada usuário pode ter.</p></div></header>
      <p className="panel admin-explanation">Os limites valem para novas conexões. Reduzir o limite ou bloquear um usuário não desconecta contas existentes nem interrompe suas publicações. Reconectar uma conta já vinculada continua permitido.</p>
      {directory.data && <div className="admin-stats">
        <div className="panel"><Users aria-hidden="true" /><strong>{directory.data.summary.users}</strong><span>Usuários cadastrados</span></div>
        <div className="panel"><Instagram aria-hidden="true" /><strong>{directory.data.summary.accounts}</strong><span>Contas conectadas</span></div>
        <div className="panel"><Ban aria-hidden="true" /><strong>{directory.data.summary.blocked}</strong><span>Usuários com novas conexões bloqueadas</span></div>
      </div>}
      <form className="admin-search" onSubmit={event => { event.preventDefault(); setPage(1); setFilter(search.trim()); }}>
        <label htmlFor="admin-search">Buscar usuário por nome ou e-mail</label>
        <div><input id="admin-search" type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome ou e-mail" /><button className="button button-secondary" type="submit"><Search size={16} /> Buscar</button></div>
      </form>
      {directory.isPending && <p role="status">Carregando usuários…</p>}
      {directory.isError && <div className="panel"><p role="alert">{directory.error.message}</p><button className="button button-secondary" onClick={() => void directory.refetch()}>Tentar novamente</button></div>}
      {directory.data && <>
        <p>{directory.data.total} usuário(s) encontrado(s). Sem configuração individual, cada usuário pode conectar até 10 contas.</p>
        {directory.data.users.length === 0 && <p className="panel">Nenhum usuário encontrado.</p>}
        {directory.data.users.map(user => <UserPermissions key={user.id} user={user} onSaved={onSaved} />)}
        <nav className="admin-pagination" aria-label="Páginas de usuários"><button className="button button-secondary" disabled={page === 1 || directory.isFetching} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil(directory.data.total / 50))}</span><button className="button button-secondary" disabled={page * 50 >= directory.data.total || directory.isFetching} onClick={() => setPage(p => p + 1)}>Próxima</button></nav>
      </>}
    </div>
  );
}

