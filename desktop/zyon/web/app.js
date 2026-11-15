// JavaScript / web/app.js / Chrome / local Windows companion
'use strict';
const byId = id => document.getElementById(id);
const token = location.hash.slice(1);
history.replaceState(null, '', '/');
let sinceMs = null;
let codeTimer = null;
let polling = false;
async function api(path, payload) {
  const response = await fetch('/api/' + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Falha na operação.');
  return result;
}
function command(id, action) {
  byId(id).addEventListener('click', async () => {
    byId('error').textContent = '';
    byId(id).disabled = true;
    try { await action(); await refresh(); }
    catch (error) { byId('error').textContent = error.message; }
    finally { byId(id).disabled = false; }
  });
}
function nativeInput() { return { username: byId('username').value, serial: byId('serial').value, endpoint: byId('endpoint').value }; }
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const state = await api('status');
    byId('runtime').textContent = state.windows ? 'Windows · armazenamento DPAPI disponível' : 'Este ambiente não é Windows. Execute start.cmd no Windows para autorizar e armazenar credenciais.';
    byId('message').textContent = state.job.message;
    byId('phase').textContent = state.workflow.phase;
    byId('gmail-status').textContent = state.gmail.connected ? 'Conectado: ' + state.gmail.mailbox : state.gmail.reconnect ? 'Reconecte o Gmail para renovar a autorização.' : 'Gmail não conectado.';
    if (state.workflow.username) byId('identity').textContent = '@' + state.workflow.username;
    if (!byId('username').value) byId('username').value = state.workflow.username || '';
    if (state.job.result?.code) {
      if (byId('code').textContent !== state.job.result.code) {
        byId('code').textContent = state.job.result.code;
        clearTimeout(codeTimer);
        codeTimer = setTimeout(() => { byId('code').textContent = ''; }, Math.max(0, state.job.expiresAt * 1000 - Date.now()));
      }
    } else { byId('code').textContent = ''; }
    const running = state.job.state === 'running';
    for (const id of ['connect', 'disconnect', 'enroll', 'logout', 'browser', 'continue', 'receive', 'confirm-recovery']) byId(id).disabled = running;
    byId('confirm-recovery').disabled ||= state.workflow.phase !== 'two_factor_verified';
    byId('logout').disabled ||= !state.workflow.recoveryConfirmed;
    byId('browser').disabled ||= !['native_complete', 'invitation_pending'].includes(state.workflow.phase);
    byId('continue').disabled ||= state.workflow.phase !== 'invitation_pending';
  } catch (error) { byId('error').textContent = error.message; }
  finally { polling = false; }
}
command('connect', async () => {
  const file = byId('client').files[0];
  if (!file || file.size > 20000) throw new Error('Escolha um JSON OAuth Desktop com até 20 KB.');
  const client = JSON.parse(await file.text());
  await api('gmail/connect', { client, mailbox: byId('mailbox').value });
  byId('client').value = '';
});
command('disconnect', () => api('gmail/disconnect', {}));
command('devices', async () => {
  const { devices } = await api('devices', {});
  byId('serial').replaceChildren(new Option('Selecione o dispositivo', ''));
  for (const device of devices) {
    const option = new Option(device.serial + ' · ' + device.state, device.serial);
    option.disabled = device.state !== 'device';
    byId('serial').append(option);
  }
  const ready = devices.filter(device => device.state === 'device');
  if (ready.length === 1) byId('serial').value = ready[0].serial;
  if (!devices.length) throw new Error('Nenhum telefone encontrado. Confira USB e depuração.');
});
command('enroll', () => api('android/enroll', nativeInput()));
command('confirm-recovery', () => api('recovery/confirm', { confirmed: byId('recovery').checked }));
command('logout', () => api('android/logout', nativeInput()));
command('browser', () => api('browser', {}));
command('continue', () => api('continue', { confirmed: byId('invited').checked }));
command('stop', () => api('stop', {}));
command('challenge', async () => {
  sinceMs = Date.now();
  byId('code').textContent = '';
  byId('challenge-status').textContent = 'Desafio iniciado. Agora solicite o código no Instagram.';
  if (!byId('recipient').value) byId('recipient').value = byId('mailbox').value;
});
command('receive', async () => {
  if (sinceMs === null) throw new Error('Inicie um novo desafio antes de pedir o código.');
  const stamp = sinceMs;
  sinceMs = null;
  byId('challenge-status').textContent = 'Buscando. Para outra tentativa, inicie um novo desafio.';
  await api('gmail/wait', { sender: byId('sender').value, recipient: byId('recipient').value, sinceMs: stamp });
});
refresh();
setInterval(refresh, 1500);
