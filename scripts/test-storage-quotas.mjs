// With the dev server running: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-storage-quotas.mjs
// Browser requests use the real administration handler and an isolated embedded Postgres.
// Authentication is simulated; all Supabase requests are intercepted. No production data is used.
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createAdminHandler } from '../supabase/functions/app-admin/handler.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const endpoint = process.env.VITE_SUPABASE_URL || readFileSync(new URL('../.env',import.meta.url),'utf8').match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1];
const project = new URL(endpoint).hostname.split('.')[0];
const admin='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',GB=1024**3;
const artifacts=process.env.ARTIFACT_DIR || '/tmp/storage-quota-browser';
mkdirSync(artifacts,{recursive:true});
const db=new PGlite();
let browser;
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table public.profiles(user_id uuid unique,display_name text);
 create table public.ig_publisher_connections(account_id uuid primary key,user_id uuid references auth.users(id),graph_id text);
 create schema storage;create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
 grant usage on schema storage to service_role;grant select on storage.objects to service_role;`);
 for(const file of ['20261112223428_administration_and_instagram_account_limits.sql','20261112225249_default_ten_instagram_accounts.sql','20261112233603_user_media_storage_quotas.sql']) await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
 await db.query("insert into auth.users(id,email) values($1,'admin@example.test'),($2,'user@example.test')",[admin,user]);
 await db.query("insert into public.profiles values($1,'Administrador'),($2,'Usuário de exemplo')",[admin,user]);
 await db.query('insert into public.avanca_admins(user_id) values($1)',[admin]);
 await db.query("insert into storage.objects values('media',$1,$2)",[`${user}/fixture.jpg`,JSON.stringify({size:GB/4})]);
 const handler=createAdminHandler({
  auth:{getUser:async token=>({data:{user:token==='admin-token'?{id:admin}:token==='user-token'?{id:user}:null},error:null})},
  rpc:async(name,args)=>{
   assert(['avanca_user_access','avanca_admin_users','avanca_admin_update_access','avanca_admin_update_storage'].includes(name));
   try {const values=Object.values(args);const result=await db.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values);return {data:result.rows[0].result,error:null};}
   catch(error) {console.log("Fixture RPC failure",name,error.message);return {data:null,error:{message:error.message}};}
  },
 });
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({project,admin})=>{
  localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify({access_token:'admin-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:admin,aud:'authenticated',role:'authenticated',email:'admin@example.test',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}));
 },{project,admin});
 await page.route(`${endpoint}/**`,async route=>{
  const request=route.request();
  if(request.url().includes('/functions/v1/app-admin')) {
   const response=await handler(new Request(request.url(),{method:request.method(),headers:request.headers(),body:request.postData()}));
   return route.fulfill({status:response.status,headers:{...Object.fromEntries(response.headers),"access-control-allow-origin":"*"},body:await response.text()});
  }
  if(request.url().includes('/functions/v1/instagram-monitor')) return route.fulfill({json:{health:[],alerts:[]}});
  if(request.url().includes('/rest/v1/ig_flow_preferences')) return route.fulfill({body:'null',contentType:'application/json'});
  return route.fulfill({json:request.url().includes('/auth/')?{id:admin,email:'admin@example.test'}:[]});
 });
 await page.goto(process.env.APP_URL||'http://localhost:8080/avanca/admin');
 const form=page.getByRole('form',{name:'Limite de armazenamento de user@example.test',exact:true});
 try { await form.waitFor({timeout:15000}); } catch(error) { await page.screenshot({path:`${artifacts}/failure.png`,fullPage:true}); console.log((await page.locator("body").innerText()).slice(0,2000),errors);throw error; }
 // The opening presentation is a modal with a focus trap; wait before entering values.
 await page.locator('.welcome-stage').waitFor({state:'hidden'});
 const input=form.getByLabel('Espaço permitido (GB)');assert.equal(await input.inputValue(),'1');
 await page.getByText('256 MB',{exact:true}).waitFor();
 const adminSection=page.getByRole('region',{name:'Armazenamento de admin@example.test',exact:true});
 assert.equal(await adminSection.getByRole('button',{name:'Salvar armazenamento'}).count(),0);
 await input.fill('2.5');await form.getByRole('button',{name:'Salvar armazenamento'}).click();
 try { await page.getByText('2,5 GB',{exact:true}).waitFor({timeout:10000}); } catch(error) {console.log("Saved DB limits",(await db.query("select * from public.avanca_storage_limits")).rows);console.log((await page.locator("body").innerText()).slice(-2000));await page.screenshot({path:`${artifacts}/save-failure.png`,fullPage:true});throw error;}
 assert.equal((await db.query('select limit_bytes from public.avanca_storage_limits where user_id=$1',[user])).rows[0].limit_bytes,2.5*GB);
 await page.getByRole('region',{name:'Armazenamento de user@example.test',exact:true}).screenshot({path:`${artifacts}/storage-panel.png`});
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:`${artifacts}/desktop.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile view overflows horizontally');
 await page.screenshot({path:`${artifacts}/mobile.png`,fullPage:true});
 await input.fill('0.1');await form.getByRole('button',{name:'Salvar armazenamento'}).click();
 await page.getByText('Acima do limite. As mídias existentes são preservadas; novos envios ficam bloqueados até haver espaço.',{exact:true}).waitFor();
 await assert.rejects(db.query("insert into storage.objects values('media',$1,$2)",[`${user}/blocked.jpg`,JSON.stringify({size:1})]),/storage_quota_exceeded/);
 assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,1);
 await db.query('delete from storage.objects where name=$1',[`${user}/fixture.jpg`]);
 await db.query("insert into storage.objects values('media',$1,$2)",[`${user}/accepted.jpg`,JSON.stringify({size:1})]);
 assert.deepEqual(errors,[]);
 console.log('Passed: browser → administration handler → Postgres → saved quota; administrator exemption; downgrade preserves media and blocks uploads; deletion frees space; mobile layout; no page errors.');
} finally {await browser?.close();await db.close();}
