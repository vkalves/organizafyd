import { useAdministrationAccess } from "./api";

export default function ConnectionAccessSummary() {
  const access = useAdministrationAccess();
  if (access.isPending) return <p role="status">Consultando limite de contas…</p>;
  if (access.isError) return <p role="alert">Não foi possível consultar seu limite de contas. Tente atualizar a página.</p>;
  if (!access.data) return null;
  const { connected_accounts: count, max_accounts: max, connection_allowed: allowed } = access.data;
  return <section className="panel"><h2 className="panel-title">Suas conexões</h2><p>{count} conta(s) conectada(s) · {max === null ? "Sem limite definido" : `Limite: ${max}`}</p>{!allowed ? <p>Novas conexões bloqueadas pelo administrador. Você ainda pode reconectar contas já vinculadas.</p> : max !== null && count >= max ? <p>Limite atingido. Para conectar outra conta, libere uma vaga ou solicite um aumento ao administrador.</p> : null}</section>;
}
