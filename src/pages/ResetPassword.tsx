import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import logoImg from "@/assets/logo-organify.png";
import { supabase } from "@/integrations/supabase/client";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!window.location.hash.includes("type=recovery")) navigate("/auth", { replace: true });
  }, [navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 6) {
      toast.error("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmation) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) toast.error("Não foi possível atualizar a senha. Solicite um novo link.");
    else {
      toast.success("Senha atualizada com sucesso!");
      navigate("/", { replace: true });
    }
    setSubmitting(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl shadow-black/20 sm:p-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={logoImg} alt="Organizafy" className="h-9 w-auto" />
          <p className="eyebrow mt-7">Recuperação de acesso</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Crie uma nova senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">Escolha uma senha que você ainda não tenha usado.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-field">
            <label htmlFor="new-password"><LockKeyhole className="h-3.5 w-3.5" /> Nova senha</label>
            <input className="field" id="new-password" type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" />
          </div>
          <div className="form-field">
            <label htmlFor="confirm-password"><LockKeyhole className="h-3.5 w-3.5" /> Confirme a senha</label>
            <input className="field" id="confirm-password" type="password" required minLength={6} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite novamente" />
          </div>
          <button type="submit" disabled={submitting} className="action-primary mt-2 w-full justify-center">
            {submitting ? "Atualizando…" : "Atualizar senha"}
            {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </form>
      </section>
    </main>
  );
};

export default ResetPassword;
