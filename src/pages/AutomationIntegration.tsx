import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { automationApi, type FlowIntegrationResult, type VerifiedAutomationAccount } from "@/features/instagram-publisher/automation-api";

type FlowChoice = { id: string; user_id: string; name: string; state: string };
type Schema = { public: { Tables: { ig_flows: { Row: FlowChoice; Insert: Partial<FlowChoice>; Update: Partial<FlowChoice>; Relationships: [] } }; Views: Record<string, never>; Functions: Record<string, never> } };
const db = supabase as unknown as SupabaseClient<Schema>;
export default function AutomationIntegration() {
  const { user } = useAuth();
  const [expectedUsername, setExpectedUsername] = useState("");
  const [flowId, setFlowId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState<VerifiedAutomationAccount | null>(null);
  const [result, setResult] = useState<FlowIntegrationResult | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const flows = useQuery({
    queryKey: ["integration-active-flows", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error: readError } = await db.from("ig_flows").select("id,user_id,name,state").eq("user_id", user!.id).eq("state", "active").order("name");
      if (readError) throw new Error("Não foi possível consultar os fluxos ativos. Tente novamente.");
      return data || [];
    },
    retry: false,
  });
  function resetConfirmation() { setVerified(null); setResult(null); setError(""); }
  async function execute(sync: boolean) {
    if (inFlight.current || !confirmed || !expectedUsername.trim() || (sync && !flowId)) return;
    inFlight.current = true; setBusy(true); setError(""); setResult(null);
    // Capture the explicit expectation; edits cannot change an in-flight operation.
    const input = { expectedUsername, ...(verified ? { accountId: verified.accountId, expectedGraphId: verified.graphId } : {}) };
    try {
      if (sync) {
        const integrated = await automationApi.syncToFlow({ ...input, flowId });
        setVerified(integrated); setResult(integrated);
      } else {
        setVerified(await automationApi.preflight(input));
      }
    } catch (failure) {
      setVerified(null);
      setError(failure instanceof Error ? failure.message : "Não foi possível confirmar a integração. Consulte o estado antes de repetir.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <Link to="/avanca/conectar" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} /> Voltar às conexões</Link>
    <header className="space-y-2"><p className="text-xs uppercase tracking-widest text-muted-foreground">Integração com identidade verificada</p><h1 className="text-2xl font-semibold">Mesmo Instagram, do aparelho ao fluxo</h1><p className="text-sm text-muted-foreground">Confira a conta conectada à Meta e adicione-a a um fluxo ativo existente.</p></header>
    <section className="panel space-y-4 p-5" aria-label="Pré-requisitos">
      <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} /> Antes de sincronizar</h2>
      <p className="text-sm text-muted-foreground">Conclua a configuração no Android, a 2FA e o logout nativo. No Chrome, use o mesmo @, aceite o convite do testador quando necessário e conclua a autorização Meta.</p>
      <p className="text-sm text-muted-foreground">A verificação abaixo consulta a identidade ao vivo na Meta. Ela não controla o aparelho nem comprova automaticamente a configuração da 2FA.</p>
      <Link to="/avanca/conectar" className="inline-block text-sm underline">Conectar ou autorizar meu Instagram</Link>
    </section>
    <form className="panel space-y-5 p-5" onSubmit={event => { event.preventDefault(); void execute(true); }}>
      <fieldset disabled={busy} className="space-y-5">
        <legend className="sr-only">Identidade e fluxo de destino</legend>
        <div className="space-y-2"><Label htmlFor="integration-handle">@ usado no Android e no Chrome</Label><Input id="integration-handle" autoComplete="off" value={expectedUsername} placeholder="seu.usuario" maxLength={31} onChange={event => { setExpectedUsername(event.target.value); resetConfirmation(); }} /></div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); resetConfirmation(); }} className="mt-1" /><span>Conferi este mesmo @ no Android e no Chrome e concluí os pré-requisitos acima.</span></label>
        <div className="space-y-2"><Label htmlFor="integration-flow">Fluxo ativo existente</Label><select id="integration-flow" value={flowId} onChange={event => { setFlowId(event.target.value); setResult(null); }} className="w-full rounded-md border border-input bg-background p-2 text-sm" disabled={busy || flows.isPending || flows.isError}>
          <option value="">{flows.isPending ? "Carregando fluxos…" : "Selecione o fluxo"}</option>
          {flows.data?.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
        </select>{flows.isError && <div role="alert" className="text-sm text-destructive"><p>{flows.error.message}</p><Button type="button" variant="outline" onClick={() => void flows.refetch()}>Consultar novamente</Button></div>}{flows.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum fluxo ativo disponível. Confira os fluxos existentes antes de continuar.</p>}</div>
        <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={!confirmed || !expectedUsername.trim()} onClick={() => void execute(false)}>Verificar identidade</Button><Button type="submit" disabled={!confirmed || !expectedUsername.trim() || !flowId || !verified}>Verificar e sincronizar</Button></div>
      </fieldset>
      {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" /> Conferindo sessão, identidade e estado do fluxo…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {verified && !result && <p role="status" className="text-sm">Identidade confirmada na Meta: <strong>@{verified.username}</strong>. Selecione o fluxo e sincronize.</p>}
    </form>
    {result && <section role="status" className="panel space-y-3 border-emerald-800 p-5"><h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} /> Associação confirmada</h2><p><strong>@{result.username}</strong> está associado ao fluxo <strong>{result.flowName}</strong>.</p><p className="text-sm text-muted-foreground">{result.alreadyAssociated ? "A conta já fazia parte do fluxo. Nenhuma nova sincronização foi enviada." : result.recoveredAfterWriteError ? "A resposta de sincronização foi interrompida, mas a associação foi confirmada ao consultar o fluxo novamente." : "A associação foi confirmada consultando o fluxo após a sincronização."}</p><p className="text-sm text-muted-foreground">Ao entrar pela primeira vez, a conta ignora o próximo horário de publicação e participa dos seguintes. Repetir a consulta não cria outro fluxo.</p><Link to="/avanca/fluxos" className="inline-block text-sm underline">Abrir Modo Fluxo</Link></section>}
  </div>;
}
