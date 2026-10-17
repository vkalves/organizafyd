import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useSearchParams, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { PublicLinks } from "./PublicInfo";
import AuthLayout from "@/components/layout/AuthLayout";

const Auth = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading, signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (loading) {
    return (
      <AuthLayout>
        <div className="auth-loading" role="status"><Loader2 size={18} className="animate-spin" /> Carregando seu espaço...</div>
      </AuthLayout>
    );
  }

  if (user) return <Navigate to={searchParams.get("next") === "tiktok" ? `/tiktok${location.hash}` : searchParams.get("next") === "x" ? `/x${location.hash}` : "/"} replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "login") {
        const { error } = await signIn(email, password);
        if (error) toast.error(error.message);
      } else if (mode === "signup") {
        const { error } = await signUp(email, password, displayName);
        if (error) toast.error(error.message);
        else toast.success("Conta criada! Verifique seu email para confirmar.");
      } else {
        const { error } = await resetPassword(email);
        if (error) toast.error(error.message);
        else toast.success("Email de recuperação enviado!");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
        <p className="auth-card-eyebrow">{mode === "forgot" ? "RECUPERE SEU ACESSO" : "SEU ESPAÇO DE ORGANIZAÇÃO"}</p>
        <h2>{mode === "login" ? "Bem-vindo de volta." : mode === "signup" ? "Sua rotina começa aqui." : "Vamos recuperar sua conta."}</h2>
        <p className="auth-card-description">{mode === "login" ? "Entre na sua conta e coloque o dia em ordem." : mode === "signup" ? "Crie sua conta e dê espaço para o que importa." : "Informe seu email para receber o link de recuperação."}</p>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "signup" && (
            <div>
              <div className="auth-field-label"><label htmlFor="auth-name">Seu nome</label></div>
              <div className="auth-input-wrap"><UserRound size={15} /><input
                id="auth-name"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Como podemos chamar você?"
              /></div>
            </div>
          )}
          <div>
            <div className="auth-field-label"><label htmlFor="auth-email">Email</label></div>
            <div className="auth-input-wrap"><Mail size={15} /><input
              id="auth-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
            /></div>
          </div>
          {mode !== "forgot" && (
            <div>
              <div className="auth-field-label"><label htmlFor="auth-password">Senha</label>{mode === "login" && <button type="button" onClick={() => setMode("forgot")} className="auth-text-button">Esqueceu a senha?</button>}</div>
              <div className="auth-input-wrap"><LockKeyhole size={15} /><input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "Crie uma senha" : "Sua senha"}
                minLength={6}
                aria-describedby={mode === "signup" ? "auth-password-hint" : undefined}
              /><button type="button" className="auth-password-toggle" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
              {mode === "signup" && <p id="auth-password-hint" className="auth-field-hint">Use pelo menos 6 caracteres.</p>}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="auth-submit"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}{submitting
              ? "Aguarde..."
              : mode === "login"
              ? "Entrar"
              : mode === "signup"
              ? "Criar minha conta"
              : "Enviar link de recuperação"}{!submitting && <ArrowRight size={15} />}
          </button>
        </form>

        <div className="auth-switch">
          {mode === "login" && (
              <p>
                Não tem conta?{" "}
                <button type="button" onClick={() => setMode("signup")}>
                  Criar conta
                </button>
              </p>
          )}
          {mode === "signup" && (
            <p>
              Já tem conta?{" "}
              <button type="button" onClick={() => setMode("login")}>
                Entrar
              </button>
            </p>
          )}
          {mode === "forgot" && (
            <button type="button" onClick={() => setMode("login")}>
              ← Voltar ao login
            </button>
          )}
        </div>
      <div className="auth-public-links"><PublicLinks /></div>
    </AuthLayout>
  );
};

export default Auth;
