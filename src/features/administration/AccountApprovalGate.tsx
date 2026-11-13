import AuthLayout from "@/components/layout/AuthLayout";
import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdministrationAccess } from "./api";

export function AccountApprovalGate({ children }: { children: ReactNode }) {
  const access = useAdministrationAccess();
  const { signOut } = useAuth();
  if (access.isPending) return <p role="status">Verificando aprovação da conta…</p>;
  if (access.isError) {
    return (
      <AuthLayout>
        <h2>Não foi possível verificar seu acesso</h2>
        <p className="auth-card-description" role="alert">{access.error.message}</p>
        <div className="auth-form">
          <button className="auth-submit" onClick={() => void access.refetch()}>Tentar novamente</button>
          <button className="auth-text-button" onClick={() => void signOut()}>Sair</button>
        </div>
      </AuthLayout>
    );
  }
  if (access.data?.account_status !== "approved") {
    const rejected = access.data?.account_status === "rejected";
    return (
      <AuthLayout>
        <h2>{rejected ? "Cadastro não aprovado" : "Aguardando aprovação"}</h2>
        <p className="auth-card-description">{rejected
          ? "Seu cadastro não foi aprovado pela administração. Entre em contato com o responsável pelo site."
          : "Recebemos seu cadastro. Um administrador precisa aprovar sua conta para liberar o acesso."}</p>
        <div className="auth-form">
          <button className="auth-submit" disabled={access.isFetching} onClick={() => void access.refetch()}>Verificar novamente</button>
          <button className="auth-text-button" onClick={() => void signOut()}>Sair</button>
        </div>
      </AuthLayout>
    );
  }
  return children;
}
