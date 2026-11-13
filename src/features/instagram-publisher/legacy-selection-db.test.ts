import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {URL as NodeURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
let db:PGlite;
const nonce='c'.repeat(64),hash=createHash('sha256').update('selection:'+nonce).digest('hex'),proof='b'.repeat(64);
const owner='00000000-0000-4000-8000-000000000001',app='11111111-1111-4111-8111-111111111111';
const cipher='a'.repeat(24)+'.'+'b'.repeat(64);
const result={selection:nonce,accounts:[{id:'12345',username:'expected.user'}]};
const query='select * from ig_upgrade_legacy_selection($1,$2,$3,$4,$5,$6)';
async function insert(){await db.query("insert into ig_login_states(state_hash,verifier_hash,user_id,pending_grant,expected_username,expected_graph_id) values($1,$2,$3,'old-encrypted-fixture','expected.user','12345')",[hash,proof,owner]);}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table ig_login_states(state_hash text primary key,verifier_hash text,user_id uuid,meta_app_id uuid,
 pending_grant text,expires_at timestamptz default now()+interval '10 minutes',
 expected_username text,expected_graph_id text,operation_status text default 'pending',
 operation_updated_at timestamptz default now(),operation_result jsonb,selection_hash text unique,selected_graph_id text);
 alter table ig_login_states enable row level security;
 revoke all on ig_login_states from public,anon,authenticated;grant all on ig_login_states to service_role;`);
 await db.exec(readFileSync(new NodeURL('../../../supabase/migrations/20261113213800_instagram_legacy_selection_upgrade.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{await db.exec('truncate ig_login_states');await insert();});afterAll(async()=>{await db.close();});
describe('legacy selection upgrade SQL compare-and-swap',()=>{
 it('atomically replaces only encrypted format and preserves owner, expiry and expected identity',async()=>{
  const before=(await db.query('select * from ig_login_states')).rows[0];
  const upgraded=(await db.query(query,[hash,proof,'old-encrypted-fixture',cipher,app,JSON.stringify(result)])).rows[0];
  expect(upgraded.operation_status).toBe('selection_required');expect(upgraded.selection_hash).toBe(hash);
  expect(upgraded.meta_app_id).toBe(app);expect(upgraded.user_id).toBe(owner);expect(upgraded.expected_username).toBe('expected.user');expect(upgraded.expected_graph_id).toBe('12345');expect(upgraded.expires_at).toEqual(before.expires_at);
  expect(upgraded.pending_grant).toBe(cipher);expect(upgraded.operation_result).toEqual(result);
 });
 it('returns no row for changed ciphertext, wrong proof, expiry or changed app metadata',async()=>{
  expect((await db.query(query,[hash,'a'.repeat(64),'old-encrypted-fixture',cipher,app,JSON.stringify(result)])).rows).toHaveLength(0);
  expect((await db.query(query,[hash,proof,'different-ciphertext',cipher,app,JSON.stringify(result)])).rows).toHaveLength(0);
  await db.query('update ig_login_states set meta_app_id=$1',[app]);
  expect((await db.query(query,[hash,proof,'old-encrypted-fixture',cipher,'22222222-2222-4222-8222-222222222222',JSON.stringify(result)])).rows).toHaveLength(0);
  await db.exec("update ig_login_states set expires_at=now()-interval '1 second'");
  expect((await db.query(query,[hash,proof,'old-encrypted-fixture',cipher,app,JSON.stringify(result)])).rows).toHaveLength(0);
 });
 it('allows only one upgrade even under repeated/concurrent calls',async()=>{
  const results=await Promise.all([1,2].map(()=>db.query(query,[hash,proof,'old-encrypted-fixture',cipher,app,JSON.stringify(result)])));
  expect(results.reduce((count,row)=>count+row.rows.length,0)).toBe(1);
 });
 it('binds the returned nonce to its existing hash and rejects malformed result data',async()=>{
  for(const bad of [{...result,selection:'d'.repeat(64)},{...result,accounts:[]},{...result,accounts:[{id:'not-numeric',username:'expected.user'}]},{...result,accounts:[{id:'12345',username:'bad name'}]}]){
   await expect(db.query(query,[hash,proof,'old-encrypted-fixture',cipher,app,JSON.stringify(bad)])).rejects.toThrow('invalid_selection');
  }
  expect((await db.query('select operation_status from ig_login_states')).rows[0].operation_status).toBe('pending');
 });
 it('drops extra result keys instead of persisting accidental provider credentials',async()=>{
  const extra={...result,token:'TOKEN-MUST-NOT-PERSIST',accounts:[{...result.accounts[0],token:'TOKEN-MUST-NOT-PERSIST'}]};
  const row=(await db.query(query,[hash,proof,'old-encrypted-fixture',cipher,app,JSON.stringify(extra)])).rows[0];
  expect(row.operation_result).toEqual(result);expect(JSON.stringify(row)).not.toContain('TOKEN-MUST-NOT-PERSIST');
 });
 it('rejects public/authenticated callers and keeps the old row unchanged',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);try{await expect(db.query(query,[hash,proof,'old-encrypted-fixture',cipher,app,JSON.stringify(result)])).rejects.toThrow('permission denied');}finally{await db.exec('reset role');}
  }
  expect((await db.query('select operation_status from ig_login_states')).rows[0].operation_status).toBe('pending');
 });
});
