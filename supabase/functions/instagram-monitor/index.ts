import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { classify, transition, type HealthState } from './health.ts';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const origins = new Set(['https://organizafyd.vercel.app', 'https://organizafy.site', 'https://www.organizafy.site']);
function checked<T>({ data, error }: { data: T; error: unknown }): T { if (error) throw new Error('database_error'); return data; }
async function check(row: { account_id: string; state: HealthState; candidate: HealthState; failures: number; lease: string }) {
  const c = checked(await db.from('ig_publisher_connections').select('graph_id,secret_id,provider').eq('account_id', row.account_id).maybeSingle());
  if (!c) return;
  let result: HealthState = 'temporary';
  let errorCode: string | null = null;
  // Vault/database failures must fail the run, never become "account down" alerts.
  const token = checked(await db.rpc('ig_vault_read', { p_id: c.secret_id }));
  if (!token) { result = 'reconnect'; errorCode = 'credential_missing'; }
  else {
    try {
      const host = c.provider === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
      const url = new URL(`https://${host}/v24.0/${encodeURIComponent(c.graph_id)}`);
      url.searchParams.set('fields', 'id,username');
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      if (response.ok && !data.error && String(data.id) === c.graph_id) result = 'healthy';
      else { result = classify(data.error?.code, response.status); errorCode = `meta_${Number(data.error?.code) || response.status}`; }
    } catch { result = 'temporary'; errorCode = 'network_unavailable'; }
  }
  const update = transition(row, result);
  checked(await db.from('ig_account_health').update({ ...update, checked_at: new Date().toISOString(), error_code: errorCode, ...(result === 'healthy' ? { last_healthy_at: new Date().toISOString() } : {}) }).eq('account_id', row.account_id).eq('lease', row.lease));
}
Deno.serve(async req => {
  const origin = req.headers.get('origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://organizafyd.vercel.app', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', Vary: 'Origin' };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 2000) return reply({ error: 'request_too_large' }, 413);
    const body = JSON.parse(raw);
    if (body.action === 'worker') {
      const key = checked(await db.rpc('ig_worker_key'));
      if (!key || req.headers.get('x-worker-secret') !== key) return reply({ error: 'unauthorized' }, 401);
      const rows = checked(await db.rpc('ig_claim_health_checks'));
      let failures = 0;
      for (let i = 0; i < rows.length; i += 5) {
        const results = await Promise.allSettled(rows.slice(i, i + 5).map(check));
        failures += results.filter(r => r.status === 'rejected').length;
      }
      return reply({ checked: rows.length - failures, failures }, failures ? 503 : 200);
    }
    const jwt = req.headers.get('authorization')?.replace(/^Bearer /i, '');
    if (!jwt) return reply({ error: 'unauthorized' }, 401);
    const { data: { user }, error } = await db.auth.getUser(jwt);
    if (error || !user) return reply({ error: 'unauthorized' }, 401);
    if (body.action === 'status') {
      const [health, alerts] = await Promise.all([
        db.from('ig_account_health').select('account_id,state,checked_at,last_healthy_at,error_code').eq('user_id', user.id),
        db.from('ig_account_alerts').select('id,account_id,state,created_at,read_at,resolved_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      ]);
      return reply({ health: checked(health), alerts: checked(alerts) });
    }
    if (body.action === 'read' && typeof body.id === 'string') {
      checked(await db.from('ig_account_alerts').update({ read_at: new Date().toISOString() }).eq('id', body.id).eq('user_id', user.id));
      return reply({ ok: true });
    }
    return reply({ error: 'invalid_action' }, 400);
  } catch { return reply({ error: 'monitor_unavailable' }, 500); }
});
