// JavaScript / companion-browser-test.cjs / Node + Playwright / fixture-only UI test
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const web = path.resolve(__dirname, '../desktop/zyon/web');
const calls=[];
let state={job:{state:'idle',message:'Ready'},workflow:{username:'same.account',phase:'not_started',recoveryConfirmed:false},gmail:{connected:false},windows:true};
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/api/')){
    assert.strictEqual(req.headers.authorization,'Bearer fixture-token');
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET'){res.end(JSON.stringify(state));return;}
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{calls.push({path:req.url,body:JSON.parse(body)});res.end('{}')});return;
  }
  const filename=req.url==='/'?'index.html':req.url.slice(1);
  res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html');
  const target=path.join(web,filename);
  if(!fs.existsSync(target)){res.statusCode=404;res.end();return;}
  res.end(fs.readFileSync(target));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    await page.goto(origin+'/#fixture-token');await page.waitForFunction(()=>document.querySelector('#username').value==='same.account');
    assert.strictEqual(new URL(page.url()).hash,'');assert(await page.locator('#continue').isDisabled());assert(await page.locator('#logout').isDisabled());
    await page.locator('#receive').click();await page.getByRole('alert').filter({hasText:'Inicie um novo desafio'}).waitFor();
    await page.locator('#mailbox').fill('owner@gmail.com');await page.locator('#challenge').click();await page.locator('#receive').click();
    await page.waitForTimeout(200);assert(calls.some(c=>c.path==='/api/gmail/wait'&&c.body.recipient==='owner@gmail.com'&&Number.isFinite(c.body.sinceMs)));
    state.workflow.phase='invitation_pending';state.workflow.recoveryConfirmed=true;
    await page.waitForFunction(()=>!document.querySelector('#continue').disabled);
    assert.strictEqual(await page.locator('#identity').textContent(),'@same.account');
    await page.locator('#invited').check();await page.locator('#continue').click();await page.waitForTimeout(100);
    assert(calls.some(c=>c.path==='/api/continue'&&c.body.confirmed===true));
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepStrictEqual(errors,[]);
    await page.screenshot({path:process.env.COMPANION_SCREENSHOT || '/tmp/companion-mobile.png',fullPage:true});
    console.log('Companion browser UI: token removal, email challenge, invitation pause/continue and mobile layout passed.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
