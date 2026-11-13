// Browser integration regression. Every external request is intercepted; no live account operations.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const api=process.env.VITE_SUPABASE_URL || fs.readFileSync('.env','utf8').match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1];
const project=new URL(api).hostname.split('.')[0];
const uid='11111111-1111-1111-1111-111111111111',accountId='22222222-2222-2222-2222-222222222222',flowId='33333333-3333-3333-3333-333333333333';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:375,height:812}}),page=await context.newPage();let associated=false,writes=0;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({project,uid})=>localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify({access_token:'fixture-only-token',refresh_token:'fixture-only-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:uid,email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}})),{project,uid});
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin==='http://127.0.0.1:5173')return route.continue();
   // Never let a test send a request to real Supabase, Meta, analytics or media.
   if(u.origin!==new URL(api).origin)return route.fulfill({status:200,body:'',contentType:'text/plain'});
   const body=req.method()==='POST'?req.postDataJSON():null;
   if(u.pathname.includes('/auth/'))return route.fulfill({json:{id:uid,email:'fixture@example.invalid',app_metadata:{},user_metadata:{}}});
   if(u.pathname.endsWith('/functions/v1/instagram-monitor'))return route.fulfill({json:{health:[],alerts:[]}});
   if(u.pathname.endsWith('/functions/v1/app-admin'))return route.fulfill({json:{account_status:'approved',is_admin:false,connected_accounts:1,connection_allowed:true,max_accounts:10,storage_limit_bytes:null,storage_used_bytes:0}});
   if(u.pathname.endsWith('/functions/v1/instagram-publisher')){
    if(body.action==='status')return route.fulfill({json:{accounts:[{account_id:accountId,paused:false,reconnect_required:false}]}});
    if(body.action==='verify')return route.fulfill({json:{id:'123456789',username:'same.account'}});
    if(body.action==='add_flow_accounts'){assert.deepEqual(body.account_ids,[accountId]);assert.equal(body.id,flowId);associated=true;writes++;return route.abort('failed');}
    return route.fulfill({json:{}});
   }
   if(u.pathname.endsWith('/rest/v1/ig_flows')){
    const flow={id:flowId,user_id:uid,name:'Existing fixture flow',state:'active',settings:{accountIds:associated?[accountId]:[]}};
    return route.fulfill({json:u.searchParams.has('id')?flow:[flow]});
   }
   if(u.pathname.endsWith('/rest/v1/instagram_accounts'))return route.fulfill({json:[{id:accountId,user_id:uid,username:'same.account'}]});
   return route.fulfill({json:[]});
  });
  await page.goto('http://127.0.0.1:5173/avanca/integracao');
  try{await page.getByRole('heading',{name:'Mesmo Instagram, do aparelho ao fluxo'}).waitFor({timeout:30000});}catch(error){console.error('Render diagnostic:',await page.locator('body').innerText(),errors);throw error;}
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByLabel('@ usado no Android e no Chrome').pressSequentially('same.account');
  await page.getByRole('checkbox',{name:/Conferi este mesmo/}).check();
  await page.getByLabel('Fluxo ativo existente').selectOption(flowId);
  assert.equal(await page.getByRole('button',{name:'Verificar e sincronizar'}).isEnabled(),false);
  assert.equal(await page.getByLabel('@ usado no Android e no Chrome').inputValue(),'same.account');
  await page.getByRole('button',{name:'Verificar identidade',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Identidade confirmada na Meta'}).waitFor();
  await page.getByRole('button',{name:'Verificar e sincronizar'}).click();
  await page.getByRole('heading',{name:'Associação confirmada'}).waitFor();
  await page.getByText(/resposta de sincronização foi interrompida/).waitFor();
  assert.equal(writes,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'mobile horizontal overflow');
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Verificar e sincronizar'}).click();
  await page.getByText(/Nenhuma nova sincronização foi enviada/).waitFor();
  assert.equal(writes,1,'duplicate association sent another write');
  assert.deepEqual(errors,[]);
  console.log('PASS: browser → API fixtures → flow readback → success; lost write response recovered; repeat produced no extra write; mobile and desktop rendered without overflow or page errors. Live Meta/DB/device unverified.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
