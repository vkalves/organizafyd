import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {assertExpectedIdentity,completedResult,expectedIdentity,openGrant,publicRecovery,sealGrant,type RecoveryRow} from '../../../supabase/functions/instagram-login/recovery';
const base:RecoveryRow={state_hash:'a'.repeat(64),verifier_hash:'b'.repeat(64),user_id:'owner',meta_app_id:null,expires_at:'2099-01-01T00:00:00Z',operation_status:'processing',operation_updated_at:'2026-11-13T00:00:00Z',selection_hash:null,selected_graph_id:'12345',pending_grant:null,operation_result:null,expected_username:'expected.user',expected_graph_id:'12345'};
const grant={token:'NEVER-RETURN-THIS-TOKEN',businessId:'12345',expiresAt:null,accounts:[{id:'12345',username:'expected.user'}]};
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));afterEach(()=>vi.unstubAllGlobals());
describe('Durable OAuth proof and expected identity',()=>{
 it('normalizes an optional expected handle and rejects malformed expected identities',()=>{
  expect(expectedIdentity('@Expected.User',undefined)).toEqual({expected_username:'expected.user',expected_graph_id:null});
  expect(expectedIdentity(undefined,undefined)).toEqual({expected_username:null,expected_graph_id:null});
  expect(()=>expectedIdentity('user@example.com',undefined)).toThrow('invalid_expected_account');
  expect(()=>expectedIdentity(undefined,12345)).toThrow('invalid_expected_account');
 });
 it('requires both immutable username and provider-scoped account ID before saving',()=>{
  expect(()=>assertExpectedIdentity(base,{id:'12345',username:'EXPECTED.USER'})).not.toThrow();
  expect(()=>assertExpectedIdentity(base,{id:'12345',username:'other.user'})).toThrow('account_mismatch');
  expect(()=>assertExpectedIdentity(base,{id:'54321',username:'expected.user'})).toThrow('account_mismatch');
 });
 it('encrypts pending grants and binds ciphertext to owner, proof and expected identity',async()=>{
  const sealed=await sealGrant(grant,base,'server-secret');
  const row={...base,pending_grant:sealed};
  expect(JSON.stringify(row)).not.toContain(grant.token);
  expect(await openGrant(row,'server-secret')).toEqual(grant);
  for(const altered of [{...row,user_id:'other'},{...row,expected_username:'other'},{...row,verifier_hash:'c'.repeat(64)}])await expect(openGrant(altered,'server-secret')).rejects.toThrow('invalid_state');
  await expect(openGrant(row,'incorrect-secret')).rejects.toThrow('invalid_state');
 });
 it('returns sanitized status without leaking grants or provider credentials',()=>{
  const row={...base,pending_grant:'encrypted',operation_result:null};
  expect(publicRecovery(row)).toEqual({status:'processing'});
  expect(publicRecovery({...row,operation_status:'restart_required'})).toEqual({status:'restart_required'});
  const result={selection:'d'.repeat(64),accounts:[{id:'12345',username:'expected.user',token:grant.token}]};
  expect(JSON.stringify(publicRecovery({...row,operation_status:'selection_required',operation_result:result}))).not.toContain(grant.token);
 });
 it('replays committed completion but rejects changing the selected account on replay',()=>{
  const row={...base,operation_status:'completed' as const,operation_result:{username:'expected.user'}};
  expect(completedResult(row,'12345')).toEqual({username:'expected.user'});
  expect(()=>completedResult(row,'54321')).toThrow('account_mismatch');
  expect(completedResult(base)).toBeNull();
 });
});
