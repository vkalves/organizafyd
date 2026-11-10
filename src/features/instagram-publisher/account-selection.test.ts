import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountSelection, consumeAccountSelection, type PendingSelection, type SelectionStore } from '../../../supabase/functions/instagram-login/account-selection';
const grant={token:'SECRET-META-TOKEN',businessId:'12345',expiresAt:null,accounts:[{id:'12345',username:'first'},{id:'23456',username:'second'}]};
const verifier='a'.repeat(64), key='fake-server-key';
function memoryStore(){
 const rows=new Map<string,PendingSelection>();
 const store:SelectionStore={
  async insert(row){rows.set(row.state_hash,{...row});},
  async find(hash,proof,now){const r=rows.get(hash);return r&&r.verifier_hash===proof&&r.expires_at>now ? {...r} : null;},
  async consume(row,now){const r=rows.get(row.state_hash);if(!r||r.pending_grant!==row.pending_grant||r.verifier_hash!==row.verifier_hash||r.user_id!==row.user_id||r.expires_at<=now)return false;rows.delete(row.state_hash);return true;},
 };
 return {rows,store};
}
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));afterEach(()=>vi.unstubAllGlobals());
describe('One-use server-side Instagram selection',()=>{
 it('encrypts credentials and returns only a nonce and approved profile metadata',async()=>{
  const {rows,store}=memoryStore();const choice=await createAccountSelection(grant,'owner',verifier,key,store);
  expect(choice).toEqual({selection:expect.stringMatching(/^[a-f0-9]{64}$/),accounts:grant.accounts});
  expect(JSON.stringify([...rows.values()])).not.toContain(grant.token);
  expect(JSON.stringify(choice)).not.toContain(grant.token);
  const selected=await consumeAccountSelection(choice.selection,verifier,'23456',key,store);
  expect(selected).toEqual({userId:'owner',grant,profile:grant.accounts[1]});expect(rows.size).toBe(0);
  await expect(consumeAccountSelection(choice.selection,verifier,'12345',key,store)).rejects.toThrow('invalid_selection');
 });
 it('rejects an unapproved ID without consuming a legitimate choice',async()=>{
  const {rows,store}=memoryStore();const choice=await createAccountSelection(grant,'owner',verifier,key,store);
  await expect(consumeAccountSelection(choice.selection,verifier,'99999',key,store)).rejects.toThrow('invalid_selection');expect(rows.size).toBe(1);
  expect((await consumeAccountSelection(choice.selection,verifier,'12345',key,store)).profile.id).toBe('12345');
 });
 it('rejects incorrect browser proof and an expired choice',async()=>{
  const {rows,store}=memoryStore();const choice=await createAccountSelection(grant,'owner',verifier,key,store);
  await expect(consumeAccountSelection(choice.selection,'b'.repeat(64),'12345',key,store)).rejects.toThrow('invalid_selection');
  [...rows.values()][0].expires_at='2020-01-01T00:00:00Z';
  await expect(consumeAccountSelection(choice.selection,verifier,'12345',key,store)).rejects.toThrow('invalid_selection');
 });
 it.each(['ciphertext','owner','key'])('rejects tampering with %s',async target=>{
  const {rows,store}=memoryStore();const choice=await createAccountSelection(grant,'owner',verifier,key,store);
  const row=[...rows.values()][0];
  if(target==='ciphertext') row.pending_grant=row.pending_grant.slice(0,25)+(row.pending_grant[25]==='0'?'1':'0')+row.pending_grant.slice(26);
  if(target==='owner') row.user_id='attacker';
  await expect(consumeAccountSelection(choice.selection,verifier,'12345',target==='key'?'wrong-key':key,store)).rejects.toThrow('invalid_selection');
 });
 it('allows exactly one of two simultaneous account choices',async()=>{
  const {store}=memoryStore();const choice=await createAccountSelection(grant,'owner',verifier,key,store);
  const results=await Promise.allSettled(['12345','23456'].map(id=>consumeAccountSelection(choice.selection,verifier,id,key,store)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 });
});
