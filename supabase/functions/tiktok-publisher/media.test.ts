import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../../api/tiktok-media.js';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function response(){const r={statusCode:0,headers:{} as Record<string,string>,body:undefined as unknown,setHeader:(k:string,v:string)=>{r.headers[k]=v;},status:(s:number)=>{r.statusCode=s;return r;},end:()=>r,send:(b:unknown)=>{r.body=b;return r;}};return r;}
describe('verified-domain photo delivery',()=>{
 it('rejects arbitrary URLs and traversal without fetching anything',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const path of ['https://evil.example/a.jpg','../../private','11111111-1111-1111-1111-111111111111/../../secret']){
   const r=response();await handler({method:'GET',query:{path}},r);expect(r.statusCode).toBe(400);
  }expect(fetcher).not.toHaveBeenCalled();
 });
 it('only delivers matching image content from the fixed storage bucket',async()=>{
  vi.stubEnv('VITE_SUPABASE_URL','https://project.supabase.co');const fetcher=vi.fn(async()=>new Response('jpeg-bytes',{headers:{'content-type':'image/jpeg'}}));vi.stubGlobal('fetch',fetcher);
  const path='11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg';const r=response();await handler({method:'GET',query:{path}},r);expect(r.statusCode).toBe(200);expect(r.headers['Content-Type']).toBe('image/jpeg');expect(r.headers['Cache-Control']).toBe('no-store');expect(fetcher.mock.calls[0][0]).toBe('https://project.supabase.co/storage/v1/object/public/tiktok-media/'+path);
 });
 it('refuses non-image upstream content and unsupported methods',async()=>{
  vi.stubEnv('VITE_SUPABASE_URL','https://project.supabase.co');vi.stubGlobal('fetch',vi.fn(async()=>new Response('html',{headers:{'content-type':'text/html'}})));
  const r=response();await handler({method:'GET',query:{path:'11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg'}},r);expect(r.statusCode).toBe(415);
  const post=response();await handler({method:'POST',query:{}},post);expect(post.statusCode).toBe(405);
 });
});
