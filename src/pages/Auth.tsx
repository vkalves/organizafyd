import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Navigate, Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { PublicLinks } from "./PublicInfo";
import { integrationReturnPath } from "@/lib/integration-return";
import AuthLayout from "@/components/layout/AuthLayout";

const Auth = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = integrationReturnPath(location.state?.returnTo);
  const { user, loading, signIn, signUp, confirmSignUp, resendConfirmationCode, resetPassword } = useAuth();
  const [mode, setMode] = useState<"login" | "signup" | "confirm" | "forgot" | "reset_confirm">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
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

  if (user && searchParams.get("welcome") !== "1") return <Navigate to={destination} replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "login") {
        const { error } = await signIn(email, password);
        if (error) {
          if (String(error.code || error.message).includes("UserNotConfirmedException")) {
            await resendConfirmationCode(email);
            toast.info("Confirme o código de 6 dígitos enviado para o seu e-mail.");
            setMode("confirm");
          } else {
            toast.error(error.message);
          }
        } else {
          navigate(destination, { replace: true });
        }
      } else if (mode === "signup") {
        const { error, needsConfirmation } = await signUp(email, password, displayName);
        if (error) {
          toast.error(error.message);
        } else if (needsConfirmation) {
          toast.success("Enviamos um código de 6 dígitos para o seu e-mail! Digite-o abaixo para confirmar.");
          setMode("confirm");
        } else {
          toast.success("Conta criada! Confirme seu e-mail e aguarde a aprovação da administração.");
        }
      } else if (mode === "confirm") {
        const { error } = await confirmSignUp(email, verificationCode);
        if (error) {
          toast.error(error.message || "Código inválido ou expirado.");
        } else {
          toast.success("E-mail confirmado com sucesso!");
          if (password) {
            const loginResult = await signIn(email, password);
            if (!loginResult.error) {
              navigate(destination, { replace: true });
              return;
            }
          }
          setMode("login");
        }
      } else if (mode === "forgot") {
        const { error } = await resetPassword(email);
        if (error) {
          toast.error(error.message);
        } else {
          toast.success("Código de recuperação enviado para seu e-mail!");
          setMode("reset_confirm");
        }
      } else if (mode === "reset_confirm") {
        const { error } = await supabase.auth.updateUser({
          email,
          code: verificationCode,
          password,
        });
        if (error) {
          toast.error(error.message || "Não foi possível redefinir a senha.");
        } else {
          toast.success("Senha atualizada com sucesso! Faça login.");
          setMode("login");
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {user && (
        <div className="mb-5 flex flex-col gap-2">
          <Link
            to={destination}
            className="auth-submit"
          >
            Continuar na minha conta <ArrowRight size={16} />
          </Link>
        </div>
      )}
      <p className="auth-card-eyebrow">
        {mode === "forgot" || mode === "reset_confirm"
          ? "Recuperação de senha"
          : mode === "confirm"
          ? "Verificação de e-mail"
          : "ACESSE SUA OPERAÇÃO"}
      </p>
      <h2>
        {mode === "login"
          ? "Bem-vindo de volta"
          : mode === "signup"
          ? "Criar sua conta"
          : mode === "confirm"
          ? "Confirmar código"
          : mode === "reset_confirm"
          ? "Definir nova senha"
          : "Recuperar acesso"}
      </h2>
      <p className="auth-card-description">
        {mode === "login"
          ? "Acesse sua central de publicação e fluxos conectados."
          : mode === "signup"
          ? "Preencha seus dados para começar."
          : mode === "confirm"
          ? `Digite o código de 6 dígitos enviado para ${email || "o seu e-mail"}.`
          : mode === "reset_confirm"
          ? "Informe o código recebido por e-mail e escolha sua nova senha."
          : "Informe seu email para receber o código de redefinição."}
      </p>

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
        {(mode === "confirm" || mode === "reset_confirm") && (
          <div>
            <div className="auth-field-label">
              <label htmlFor="auth-code">Código de verificação</label>
              {mode === "confirm" && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!email) return;
                    const { error } = await resendConfirmationCode(email);
                    if (error) toast.error(error.message);
                    else toast.success("Novo código enviado para o seu e-mail!");
                  }}
                  className="auth-text-button"
                >
                  Reenviar código
                </button>
              )}
            </div>
            <div className="auth-input-wrap"><KeyRound size={15} /><input
              id="auth-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              placeholder="Ex.: 108306"
            /></div>
          </div>
        )}
        {(mode === "login" || mode === "signup" || mode === "reset_confirm") && (
          <div>
            <div className="auth-field-label">
              <label htmlFor="auth-password">{mode === "reset_confirm" ? "Nova senha" : "Senha"}</label>
              {mode === "login" && <button type="button" onClick={() => setMode("forgot")} className="auth-text-button">Esqueceu a senha?</button>}
            </div>
            <div className="auth-input-wrap"><LockKeyhole size={15} /><input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "login" ? "Sua senha" : "Crie uma senha"}
              minLength={6}
              aria-describedby={mode !== "login" ? "auth-password-hint" : undefined}
            /><button type="button" className="auth-password-toggle" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
            {mode !== "login" && <p id="auth-password-hint" className="auth-field-hint">Use pelo menos 6 caracteres.</p>}
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
            : mode === "confirm"
            ? "Confirmar código e entrar"
            : mode === "reset_confirm"
            ? "Salvar nova senha"
            : "Enviar código de recuperação"}{!submitting && <ArrowRight size={15} />}
        </button>
      </form>

      <div className="auth-switch">
        {mode === "login" && (
          <p>
            Não tem conta?{" "}
            <button type="button" onClick={() => setMode("signup")}>
              Criar conta
            </button>
            {" · "}
            <button type="button" onClick={() => setMode("confirm")}>
              Já tenho um código
            </button>
          </p>
        )}
        {mode === "signup" && (
          <p>
            Já tem conta?{" "}
            <button type="button" onClick={() => setMode("login")}>
              Entrar
            </button>
            {" · "}
            <button type="button" onClick={() => setMode("confirm")}>
              Confirmar código
            </button>
          </p>
        )}
        {(mode === "confirm" || mode === "forgot" || mode === "reset_confirm") && (
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
