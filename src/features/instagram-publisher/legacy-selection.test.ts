import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createAccountSelection, readAccountSelection, type SelectionStore } from '../../../supabase/functions/instagram-login/account-selection';
import { upgradeLegacySelection, type LegacySelectionStore } from '../../../supabase/functions/instagram-login/legacy-selection';
import { openGrant, type RecoveryRow } from '../../../supabase/functions/instagram-login/recovery';
import { vi } from 'vitest';
const proof='a'.repeat(64),key='fixture-server-key',app='11111111-1111-4111-8111-111111111111';
const grant={token:'PROVIDER-CREDENTIAL-NEVER-RETURN',businessId:'12345',expiresAt:null,metaAppId:app,metaAppClientId:'123456',metaAppConfigId:'234567',accounts:[{id:'12345',username:'expected.user'},{id:'23456',username:'another.user'}]};
function stores(){
 const rows=new Map<string,RecoveryRow>();let swaps=0,consumes=0;
 const selection:SelectionStore={
  async insert(row){rows.set(row.state_hash,{...row,meta_app_id:null,expected_username:null,expected_graph_id:null,operation_status:'pending',operation_updated_at:new Date().toISOString(),selection_hash:null,selected_graph_id:null,operation_result:null});},
  async find(hash,proof,now){const row=rows.get(hash);return row&&row.verifier_hash===proof&&row.expires_at>now?{...row}:null;},
  async consume(){consumes++;return false;},
 };
 const legacy:LegacySelectionStore={
  async findLegacy(hash,proof,now){const row=rows.get(hash);return row&&row.verifier_hash===proof&&row.expires_at>now&&row.operation_status==='pending'&&row.selection_hash===null&&row.pending_grant?{...row}:null;},
  async upgrade(previous,next,now){const current=rows.get(previous.state_hash);if(!current||current.verifier_hash!==previous.verifier_hash||current.user_id!==previous.user_id||current.pending_grant!==previous.pending_grant||current.operation_status!=='pending'||current.selection_hash!==null||current.expires_at<=now)return null;rows.set(current.state_hash,{...next});swaps++;return {...next};},
  async findCurrent(hash,proof,now){const row=[...rows.values()].find(r=>r.selection_hash===hash&&r.verifier_hash===proof&&r.expires_at>now);return row?{...row}:null;},
 };
 return{rows,selection,legacy,counts:()=>({swaps,consumes})};
}
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));afterEach(()=>vi.unstubAllGlobals());
describe('legacy OAuth selection rolling-upgrade compatibility',()=>{
 it('reads old ciphertext without consuming the selection',async()=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection);
  expect((await readAccountSelection(choice.selection,proof,key,s.selection)).grant).toEqual(grant);
  expect(s.rows.size).toBe(1);expect(s.counts()).toEqual({swaps:0,consumes:0});
 });
 it('upgrades old grant encryption atomically and preserves provider app and expiry',async()=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection),before=[...s.rows.values()][0];
  const upgraded=await upgradeLegacySelection(choice.selection,proof,key,s.legacy);
  expect(upgraded).not.toBeNull();expect(upgraded!.meta_app_id).toBe(app);expect(upgraded!.expires_at).toBe(before.expires_at);
  expect(upgraded!.operation_status).toBe('selection_required');expect(upgraded!.pending_grant).not.toBe(before.pending_grant);
  expect(await openGrant(upgraded!,key)).toEqual(grant);
  expect(upgraded!.operation_result).toEqual({selection:choice.selection,accounts:grant.accounts});
  expect(JSON.stringify(upgraded)).not.toContain(grant.token);expect(s.counts()).toEqual({swaps:1,consumes:0});
 });
 it('preserves bound expected identity instead of accepting new callback values',async()=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection);const row=[...s.rows.values()][0];
  row.expected_username='expected.user';row.expected_graph_id='12345';
  const upgraded=await upgradeLegacySelection(choice.selection,proof,key,s.legacy);
  expect(upgraded!.expected_username).toBe('expected.user');expect(upgraded!.expected_graph_id).toBe('12345');expect(await openGrant(upgraded!,key)).toEqual(grant);
 });
 it('rejects wrong proof and expires without touching the old grant',async()=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection),before=[...s.rows.values()][0].pending_grant;
  expect(await upgradeLegacySelection(choice.selection,'b'.repeat(64),key,s.legacy)).toBeNull();
  [...s.rows.values()][0].expires_at='2020-01-01T00:00:00Z';
  expect(await upgradeLegacySelection(choice.selection,proof,key,s.legacy)).toBeNull();expect([...s.rows.values()][0].pending_grant).toBe(before);expect(s.counts().swaps).toBe(0);
 });
 it.each(['owner','ciphertext','key'])('fails closed on tampered %s',async target=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection),row=[...s.rows.values()][0];
  if(target==='owner')row.user_id='other-owner';
  if(target==='ciphertext')row.pending_grant=row.pending_grant!.slice(0,25)+(row.pending_grant![25]==='0'?'1':'0')+row.pending_grant!.slice(26);
  await expect(upgradeLegacySelection(choice.selection,proof,target==='key'?'wrong-key':key,s.legacy)).rejects.toThrow('invalid_selection');expect(s.counts().swaps).toBe(0);
 });
 it('does not upgrade a new processing or completed operation',async()=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection);const row=[...s.rows.values()][0];row.operation_status='processing';
  expect(await upgradeLegacySelection(choice.selection,proof,key,s.legacy)).toBeNull();expect(s.counts().swaps).toBe(0);
 });
 it('re-reads the winning representation after concurrent upgrades and never consumes',async()=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection);
  const results=await Promise.all([1,2].map(()=>upgradeLegacySelection(choice.selection,proof,key,s.legacy)));
  expect(results[0]).toEqual(results[1]);expect(results.every(Boolean)).toBe(true);expect(s.counts()).toEqual({swaps:1,consumes:0});expect(await openGrant(results[0]!,key)).toEqual(grant);
 });
 it('does not recreate an operation consumed by an old request during upgrade',async()=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection);
  s.legacy.upgrade=async previous=>{s.rows.delete(previous.state_hash);return null;};
  expect(await upgradeLegacySelection(choice.selection,proof,key,s.legacy)).toBeNull();expect(s.rows.size).toBe(0);expect(s.counts().swaps).toBe(0);
 });
 it('rejects incompatible app metadata before changing storage',async()=>{
  const s=stores(),choice=await createAccountSelection(grant,'owner',proof,key,s.selection);[...s.rows.values()][0].meta_app_id='22222222-2222-4222-8222-222222222222';
  await expect(upgradeLegacySelection(choice.selection,proof,key,s.legacy)).rejects.toThrow('invalid_selection');expect(s.counts().swaps).toBe(0);
 });
});
