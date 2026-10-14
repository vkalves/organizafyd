import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import AuthLayout from "@/components/layout/AuthLayout";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("type=recovery")) {
      navigate("/auth");
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) toast.error(error.message);
    else {
      toast.success("Senha atualizada com sucesso!");
      navigate("/");
    }
    setSubmitting(false);
  };

  return (
    <AuthLayout>
        <p className="auth-card-eyebrow">UM NOVO COMEÇO</p>
        <h2>Defina sua nova senha.</h2>
        <p className="auth-card-description">Escolha uma senha para voltar ao seu espaço de organização.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <div>
            <div className="auth-field-label"><label htmlFor="reset-password">Nova senha</label></div>
            <div className="auth-input-wrap"><LockKeyhole size={15} /><input
              id="reset-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Crie sua nova senha"
              aria-describedby="reset-password-hint"
            /><button type="button" className="auth-password-toggle" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
            <p id="reset-password-hint" className="auth-field-hint">Use pelo menos 6 caracteres.</p>
          </div>
          <button type="submit" disabled={submitting} className="auth-submit">
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}{submitting ? "Atualizando..." : "Atualizar senha"}{!submitting && <ArrowRight size={15} />}
          </button>
        </form>
    </AuthLayout>
  );
};

export default ResetPassword;
