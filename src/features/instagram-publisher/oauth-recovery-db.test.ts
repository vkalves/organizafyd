// TypeScript / oauth-recovery-db.test.ts / Vitest + PGlite / transactional OAuth recovery regression
import {readFileSync} from 'node:fs';
import {URL as NodeURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
let db:PGlite;
const owner='00000000-0000-4000-8000-000000000001';
const state='a'.repeat(64),proof='b'.repeat(64),invite='c'.repeat(64);
const complete="select ig_complete_login($1,$2,$3,$4,$5,null,null,null,null) as result";
async function insertInvite(token=invite){await db.query("insert into ig_connection_invites(token_hash,user_id,manager_label,expected_username,expected_graph_id) values($1,$2,'owner','expected.user','12345')",[token,owner]);}
async function begin(){await insertInvite();await db.query('select ig_begin_login($1,$2,$3)',[invite,state,proof]);}
async function prepare(){await begin();await db.query("update ig_login_states set operation_status='processing',selected_graph_id='12345',pending_grant='encrypted-test-fixture' where state_hash=$1",[state]);}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table ig_connection_invites(token_hash text primary key,user_id uuid,manager_label text,meta_app_id uuid,expires_at timestamptz default now()+interval '24 hours');
 create table ig_login_states(state_hash text primary key,verifier_hash text,user_id uuid,meta_app_id uuid,pending_grant text,expires_at timestamptz default now()+interval '10 minutes');
 create table test_connections(graph text,username text,owner uuid);
 create table test_access(approved boolean);insert into test_access values(true);
 create function avanca_account_status(uuid)returns text language sql as $$select case when approved then 'approved' else 'rejected' end from public.test_access$$;
 create function ig_connect_unified(p_user uuid,p_graph text,p_username text,p_token text,p_business text,p_expires timestamptz)returns uuid language plpgsql as $$begin if p_token='DB-FAIL' then raise exception 'connect_failed';end if;insert into public.test_connections values(p_graph,p_username,p_user);return p_user;end;$$;
 create function ig_connect_meta_app(p_user uuid,p_app uuid,p_graph text,p_username text,p_token text,p_business text,p_expires timestamptz,p_app_client_id text,p_config_id text)returns uuid language sql as $$select ig_connect_unified(p_user,p_graph,p_username,p_token,p_business,p_expires)$$;`);
 await db.exec(readFileSync(new NodeURL('../../../supabase/migrations/20261113210901_instagram_oauth_recovery.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{await db.exec('truncate ig_connection_invites,ig_login_states,test_connections;update test_access set approved=true;');});
afterAll(async()=>{await db.close();});
describe('OAuth recovery transactions and access boundaries',()=>{
 it('atomically consumes invitation and binds immutable expected identity into state',async()=>{
  await begin();
  expect((await db.query('select * from ig_connection_invites')).rows).toHaveLength(0);
  const rows=(await db.query("select expected_username,expected_graph_id,operation_status from ig_login_states")).rows;
  expect(rows).toEqual([{expected_username:'expected.user',expected_graph_id:'12345',operation_status:'pending'}]);
  await expect(db.query('select ig_begin_login($1,$2,$3)',[invite,'d'.repeat(64),proof])).rejects.toThrow('invalid_invite');
 });
 it('rolls back invite consumption if state insertion cannot commit',async()=>{
  await begin();await insertInvite('d'.repeat(64));
  await expect(db.query('select ig_begin_login($1,$2,$3)',['d'.repeat(64),state,proof])).rejects.toThrow();
  expect((await db.query('select token_hash from ig_connection_invites')).rows).toEqual([{token_hash:'d'.repeat(64)}]);
 });
 it('saves connection and completion in one transaction and replays without a second save',async()=>{
  await prepare();
  const result=await db.query(complete,[state,proof,'12345','expected.user','provider-secret']);
  expect(result.rows).toEqual([{result:{username:'expected.user'}}]);
  await db.query(complete,[state,proof,'12345','expected.user','provider-secret']);
  expect((await db.query('select * from test_connections')).rows).toHaveLength(1);
  const ledger=(await db.query('select operation_status,operation_result,pending_grant from ig_login_states')).rows;
  expect(ledger).toEqual([{operation_status:'completed',operation_result:{username:'expected.user'},pending_grant:null}]);
  expect(JSON.stringify(ledger)).not.toContain('provider-secret');
 });
 it('rejects wrong handle/ID/proof and leaves all external connection rows untouched',async()=>{
  await prepare();
  await expect(db.query(complete,[state,proof,'12345','wrong.user','token'])).rejects.toThrow('account_mismatch');
  await expect(db.query(complete,[state,proof,'54321','expected.user','token'])).rejects.toThrow('account_mismatch');
  await expect(db.query(complete,[state,'x'.repeat(64),'12345','expected.user','token'])).rejects.toThrow('invalid_state');
  expect((await db.query('select * from test_connections')).rows).toHaveLength(0);
 });
 it('does not mark a failed save completed and refuses revoked approval',async()=>{
  await prepare();
  await expect(db.query(complete,[state,proof,'12345','expected.user','DB-FAIL'])).rejects.toThrow('connect_failed');
  expect((await db.query('select operation_status from ig_login_states')).rows).toEqual([{operation_status:'processing'}]);
  await db.exec('update test_access set approved=false');
  await expect(db.query(complete,[state,proof,'12345','expected.user','token'])).rejects.toThrow('account_not_approved');
  expect((await db.query('select * from test_connections')).rows).toHaveLength(0);
 });
 it('gives exactly one atomic claim to simultaneous completion attempts',async()=>{
  await begin();
  const claimed=await Promise.all([1,2].map(()=>db.query("update ig_login_states set operation_status='processing' where state_hash=$1 and verifier_hash=$2 and operation_status='pending' returning state_hash",[state,proof])));
  expect(claimed.reduce((n,r)=>n+r.rows.length,0)).toBe(1);
 });
 it('prunes expired encrypted grants and invites without removing live operations',async()=>{
  await begin();
  await db.query("insert into ig_login_states(state_hash,verifier_hash,user_id,pending_grant,expires_at) values($1,$2,$3,'expired-encrypted-grant',now()-interval '1 hour')",['e'.repeat(64),proof,owner]);
  await db.query("insert into ig_connection_invites(token_hash,user_id,manager_label,expires_at) values($1,$2,'expired',now()-interval '1 hour')",['f'.repeat(64),owner]);
  await db.query('select ig_prune_login_records()');
  expect((await db.query('select state_hash from ig_login_states')).rows).toEqual([{state_hash:state}]);
  expect((await db.query('select token_hash from ig_connection_invites')).rows).toHaveLength(0);
 });
 it('keeps OAuth state and privileged RPCs unavailable to public clients',async()=>{
  await begin();await db.exec('set role authenticated');
  try{
   await expect(db.query('select * from ig_login_states')).rejects.toThrow('permission denied');
   await expect(db.query('select ig_prune_login_records()')).rejects.toThrow('permission denied');
   await expect(db.query('select ig_begin_login($1,$2,$3)',[invite,state,proof])).rejects.toThrow('permission denied');
   await expect(db.query(complete,[state,proof,'12345','expected.user','token'])).rejects.toThrow('permission denied');
  }finally{await db.exec('reset role');}
 });
});
