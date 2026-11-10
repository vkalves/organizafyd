import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, authorizedAccount, authorizedAccounts, verifyPublishingAccess } from '../../../supabase/functions/instagram-login/unified';
const config={appId:'12345',secret:'fake-secret',configId:'67890'};
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));afterEach(()=>vi.unstubAllGlobals());
function mockGraph(accounts:unknown={data:[{id:'178414123456',username:'client'}]},debug:Record<string,unknown>={}){
 return vi.fn().mockResolvedValueOnce({access_token:'fake-token'}).mockResolvedValueOnce({data:{is_valid:true,app_id:'12345',type:'SYSTEM_USER',scopes:['instagram_basic','instagram_content_publish'],expires_at:0,...debug}}).mockResolvedValueOnce({client_business_id:'99887'}).mockResolvedValueOnce(accounts).mockResolvedValueOnce({data:[{quota_usage:0}]});
}
describe('Unified login',()=>{
 it('uses configuration and forces login options without legacy scope',()=>{
 const u=new URL(authorizeUrl(config,'https://example.com/callback','state'));
 expect(u.hostname).toBe('www.facebook.com');expect(u.searchParams.get('config_id')).toBe('67890');expect(u.searchParams.has('scope')).toBe(false);expect(u.searchParams.get('prompt')).toBe('login');expect(u.searchParams.get('state')).toBe('state');
 });
 it('reads assigned Instagram assets rather than treating system user as Instagram',async()=>{
 const graph=mockGraph();const a=await authorizedAccount(config,'https://example.com/callback','code',graph);
 expect(a).toEqual({token:'fake-token',id:'178414123456',username:'client',businessId:'99887',expiresAt:null});
 expect(graph.mock.calls[3][0]).toContain('/me/assigned_instagram_accounts?');expect(graph.mock.calls[3][1].headers.Authorization).toBe('Bearer fake-token');expect(graph.mock.calls[3][0]).not.toContain('fake-token');expect(graph.mock.calls[3][0]).toContain('appsecret_proof=');
 });
 it.each([{app_id:'wrong'},{type:'USER'},{is_valid:false},{expires_at:1}])('rejects invalid token metadata %j',async debug=>{
 await expect(authorizedAccount(config,'https://example.com/callback','code',mockGraph(undefined,debug))).rejects.toThrow('invalid_token');
 });
 it('requires publication permission',async()=>{await expect(authorizedAccount(config,'https://example.com/callback','code',mockGraph(undefined,{scopes:['instagram_basic']}))).rejects.toThrow('missing_permission');});
 it.each([{data:[]},{data:[{id:'12345',username:'one'},{id:'23456',username:'two'}]},{data:[{id:'12345',username:'one'},{id:'23456',username:'two'}]}])('does not guess profile among absent or multiple results',async accounts=>{
 await expect(authorizedAccount(config,'https://example.com/callback','code',mockGraph(accounts))).rejects.toThrow(accounts.data.length===0?'no_instagram_accounts':'multiple_instagram_accounts');
 });
});

describe('Explicit asset selection',()=>{
 it('returns approved profiles without checking or saving an arbitrary profile',async()=>{
  const graph=mockGraph({data:[{id:'12345',username:'one'},{id:'23456',username:'two'}]});
  const grant=await authorizedAccounts(config,'https://example.com/callback','code',graph);
  expect(grant.accounts).toEqual([{id:'12345',username:'one'},{id:'23456',username:'two'}]);
  expect(graph).toHaveBeenCalledTimes(4);
  await verifyPublishingAccess(config,grant,'23456',graph);
  expect(graph.mock.calls[4][0]).toContain('/23456/content_publishing_limit?');
  await expect(verifyPublishingAccess(config,grant,'99999',graph)).rejects.toThrow('invalid_selection');
  expect(graph).toHaveBeenCalledTimes(5);
 });
 it('paginates using validated cursors on the Graph host, never paging URLs',async()=>{
  const graph=mockGraph({data:[{id:'12345',username:'one'}],paging:{next:'https://evil.example/token',cursors:{after:'next-page'}}});
  graph.mockReset();
  const base=mockGraph();
  graph.mockImplementation(async (url,init)=> {
    if(url.includes('/assigned_instagram_accounts')) return new URL(url).searchParams.has('after') ? {data:[{id:'23456',username:'two'},{id:'12345',username:'one'}]} : {data:[{id:'12345',username:'one'}],paging:{next:'https://evil.example/token',cursors:{after:'next-page'}}};
    return base(url,init);
  });
  const grant=await authorizedAccounts(config,'https://example.com/callback','code',graph);
  expect(grant.accounts).toHaveLength(2);
  expect(graph.mock.calls.every(([url])=>new URL(url).hostname==='graph.facebook.com')).toBe(true);
  expect(graph.mock.calls[4][0]).toContain('after=next-page');
 });
 it.each([{data:[{id:'bad',username:'one'}]},{data:[{id:'12345',username:'<bad>'}]},{data:[{id:'12345',username:'one'}],paging:{next:'https://example.com'}}])('rejects malformed assets or pagination %j',async accounts=>{
  await expect(authorizedAccounts(config,'https://example.com/callback','code',mockGraph(accounts))).rejects.toThrow('meta_authorization_failed');
 });
 it('rejects repeated cursors',async()=>{
  const graph=mockGraph({data:[{id:'12345',username:'one'}],paging:{next:'yes',cursors:{after:'repeat'}}});
  graph.mockResolvedValue({data:[{id:'12345',username:'one'}],paging:{next:'yes',cursors:{after:'repeat'}}});
  await expect(authorizedAccounts(config,'https://example.com/callback','code',graph)).rejects.toThrow('meta_authorization_failed');
 });
});
