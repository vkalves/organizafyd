import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import logoImg from "@/assets/logo-organify.png";

const Auth = () => {
  const { user, loading, signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <img src={logoImg} alt="Organify" className="h-10 w-auto invert" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Nome</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Seu nome"
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="seu@email.com"
            />
          </div>
          {mode !== "forgot" && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="••••••••"
                minLength={6}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting
              ? "Aguarde..."
              : mode === "login"
              ? "Entrar"
              : mode === "signup"
              ? "Criar Conta"
              : "Enviar Email"}
          </button>
        </form>

        <div className="text-center space-y-2">
          {mode === "login" && (
            <>
              <button onClick={() => setMode("forgot")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Esqueceu a senha?
              </button>
              <p className="text-xs text-muted-foreground">
                Não tem conta?{" "}
                <button onClick={() => setMode("signup")} className="text-foreground hover:underline">
                  Criar conta
                </button>
              </p>
            </>
          )}
          {mode === "signup" && (
            <p className="text-xs text-muted-foreground">
              Já tem conta?{" "}
              <button onClick={() => setMode("login")} className="text-foreground hover:underline">
                Entrar
              </button>
            </p>
          )}
          {mode === "forgot" && (
            <button onClick={() => setMode("login")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              ← Voltar ao login
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
