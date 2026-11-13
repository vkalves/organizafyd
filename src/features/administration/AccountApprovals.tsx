import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { adminRequest, type ManagedUser } from "./api";

type ApprovalAccount = Pick<ManagedUser, "id" | "email" | "display_name" | "account_status" | "is_admin">;
const labels = { pending: "Aguardando aprovação", approved: "Aprovado", rejected: "Rejeitado" };
export function AccountDecision({ user, onSaved }: { user: ApprovalAccount; onSaved: () => void }) {
  const [confirmation, setConfirmation] = useState(false);
  const decision = useMutation({
    mutationFn: (status: "approved" | "rejected") => adminRequest("approve_account", { user_id: user.id, status }),
    onSuccess: () => { setConfirmation(false); onSaved(); },
  });
  return <section aria-label={`Aprovação de ${user.email || user.display_name}`}>
    <p>Status do cadastro: <strong>{labels[user.account_status] || "Status indisponível"}</strong></p>
    {!user.is_admin && user.account_status !== "approved" && <div className="admin-permissions">
      <button className="button button-primary" disabled={decision.isPending} onClick={() => decision.mutate("approved")}>Aprovar conta</button>
      {user.account_status === "pending" && (confirmation ? <><span>Rejeitar o cadastro de {user.email || user.display_name}?</span><button className="button button-secondary" disabled={decision.isPending} onClick={() => decision.mutate("rejected")}>Confirmar rejeição</button><button className="button button-secondary" disabled={decision.isPending} onClick={() => setConfirmation(false)}>Cancelar</button></> : <button className="button button-secondary" disabled={decision.isPending} onClick={() => setConfirmation(true)}>Rejeitar conta</button>)}
    </div>}
    {decision.isError && <p role="alert">{decision.error.message}</p>}
    {decision.isSuccess && <p role="status">Decisão salva.</p>}
  </section>;
}

export function AccountApprovals({ onSaved }: { onSaved: () => void }) {
  const [page, setPage] = useState(1);
  const queue = useQuery({
    queryKey: ["avanca-pending-accounts", page],
    queryFn: () => adminRequest<{ users: ApprovalAccount[]; total: number }>("pending_accounts", { page }),
    retry: false,
    refetchInterval: 30_000,
  });
  return <section className="panel admin-approvals" aria-label="Aprovação de novos cadastros">
    <h2>Aprovação de novos cadastros</h2><p>Novos usuários aguardam sua aprovação antes de acessar o site.</p>
    {queue.isPending && <p role="status">Carregando cadastros pendentes…</p>}
    {queue.isError && <><p role="alert">{queue.error.message}</p><button className="button button-secondary" onClick={() => void queue.refetch()}>Tentar novamente</button></>}
    {queue.data && <><p>{queue.data.total} cadastro(s) aguardando aprovação.</p>{queue.data.users?.map(user => <article className="admin-user" key={user.id}><h3>{user.display_name || user.email}</h3><p>{user.email}</p><AccountDecision user={user} onSaved={onSaved} /></article>)}
      <nav className="admin-pagination" aria-label="Páginas de cadastros pendentes"><button className="button button-secondary" disabled={page === 1 || queue.isFetching} onClick={() => setPage(p => p - 1)}>Anteriores</button><span>Página {page}</span><button className="button button-secondary" disabled={page * 50 >= queue.data.total || queue.isFetching} onClick={() => setPage(p => p + 1)}>Próximos</button></nav>
    </>}
  </section>;
}
