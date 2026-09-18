import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { toast } from "sonner";
import logoImg from "@/assets/logo-organify.png";
import { useAuth } from "@/contexts/AuthContext";

type AuthMode = "login" | "signup" | "forgot";

const authErrorMessage = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "Email ou senha incorretos.";
  if (normalized.includes("user already registered")) return "Este email já está cadastrado. Tente entrar.";
  if (normalized.includes("email not confirmed")) return "Confirme seu email antes de entrar.";
  if (normalized.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  return "Não foi possível concluir a operação. Tente novamente.";
};

const Auth = () => {
  const { user, loading, signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("confirmed") === "1") {
      toast.success("Email confirmado. Você já pode entrar.");
      window.history.replaceState({}, document.title, "/auth");
    }
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          Carregando…
        </div>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const copy = {
    login: { eyebrow: "Bem-vindo de volta", title: "Entre no seu espaço", description: "Organize seu dia com clareza.", submit: "Entrar" },
    signup: { eyebrow: "Comece hoje", title: "Crie sua conta", description: "Um só lugar para tudo que move seu negócio.", submit: "Criar conta" },
    forgot: { eyebrow: "Recuperação", title: "Redefina sua senha", description: "Enviaremos um link seguro para o seu email.", submit: "Enviar link" },
  }[mode];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "login") {
        const { error } = await signIn(email.trim(), password);
        if (error) toast.error(authErrorMessage(error.message));
      } else if (mode === "signup") {
        const { error } = await signUp(email.trim(), password, displayName.trim());
        if (error) toast.error(authErrorMessage(error.message));
        else toast.success("Conta criada! Verifique seu email para confirmar.");
      } else {
        const { error } = await resetPassword(email.trim());
        if (error) toast.error(authErrorMessage(error.message));
        else toast.success("Email de recuperação enviado!");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl shadow-black/20 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
          <img src={logoImg} alt="Organizafy" className="h-9 w-auto object-contain object-left brightness-0 invert" />
          <div>
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-primary-foreground/70">Organizafy</p>
            <h2 className="max-w-sm text-3xl font-semibold leading-tight">Menos abas. Mais foco no que importa.</h2>
            <p className="mt-4 max-w-sm text-sm leading-6 text-primary-foreground/75">Tarefas, funis, finanças, notas e rotina de conteúdo em um painel simples.</p>
          </div>
          <p className="text-xs text-primary-foreground/60">Seu trabalho, organizado com intenção.</p>
        </aside>

        <section className="p-6 sm:p-10">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src={logoImg} alt="Organizafy" className="h-8 w-auto" />
          </div>
          <div className="mb-8">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{copy.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{copy.description}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" aria-label={copy.title}>
            {mode === "signup" && (
              <div className="form-field">
                <label htmlFor="display-name"><UserRound className="h-3.5 w-3.5" /> Nome</label>
                <input className="field" id="display-name" type="text" autoComplete="name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Seu nome" />
              </div>
            )}
            <div className="form-field">
              <label htmlFor="auth-email"><Mail className="h-3.5 w-3.5" /> Email</label>
              <input className="field" id="auth-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" />
            </div>
            {mode !== "forgot" && (
              <div className="form-field">
                <label htmlFor="auth-password"><LockKeyhole className="h-3.5 w-3.5" /> Senha</label>
                <input className="field" id="auth-password" type="password" required autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" minLength={6} />
              </div>
            )}
            <button type="submit" disabled={submitting} className="action-primary mt-2 w-full justify-center">
              {submitting ? "Aguarde…" : copy.submit}
              {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </form>

          <div className="mt-7 space-y-3 text-center text-sm text-muted-foreground">
            {mode === "login" && (
              <>
                <button type="button" onClick={() => setMode("forgot")} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Esqueci minha senha</button>
                <p>Não tem conta? <button type="button" onClick={() => setMode("signup")} className="font-medium text-foreground underline-offset-4 hover:underline">Criar conta</button></p>
              </>
            )}
            {mode === "signup" && <p>Já tem conta? <button type="button" onClick={() => setMode("login")} className="font-medium text-foreground underline-offset-4 hover:underline">Entrar</button></p>}
            {mode === "forgot" && <button type="button" onClick={() => setMode("login")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">← Voltar ao login</button>}
          </div>
          <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Seus dados ficam protegidos por políticas de acesso.</p>
        </section>
      </div>
    </main>
  );
};

export default Auth;
