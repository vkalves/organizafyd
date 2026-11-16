// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { GraphFailure,canRetryBeforePublication,quotaExhausted } from '../../../supabase/functions/instagram-publisher/publication-policy';
describe('publication failure policy',()=>{
 it('preserves useful Meta fields while redacting credentials and URLs',()=>{
  const error=new GraphFailure(400,{code:100,error_subcode:2207001,is_transient:true,fbtrace_id:'trace-123',message:'invalid SECRET at https://example.test/?access_token=SECRET\ntry again'},'SECRET','account/media');
  expect(error.message).toBe('meta_100');expect(error.details).toMatchObject({code:100,subcode:2207001,transient:true,trace_id:'trace-123',stage:'create_media'});
  expect(error.details.message).not.toContain('SECRET');expect(error.details.message).not.toContain('https://');
 });
 it.each(['meta_4','meta_429','network_error','database_error'])('keeps %s retryable before publication regardless of prior attempt count',code=>{
  expect(canRetryBeforePublication(new Error(code),code,false)).toBe(true);expect(canRetryBeforePublication(new Error(code),code,true)).toBe(false);
 });
 it('honors explicit transient provider failures only before publishing',()=>{
  const error=new GraphFailure(400,{code:100,is_transient:true},'token','account/media');
  expect(canRetryBeforePublication(error,error.message,false)).toBe(true);expect(canRetryBeforePublication(error,error.message,true)).toBe(false);
 });
 it('does not retry ambiguous publication failures, including quota or network responses',()=>{
  expect(canRetryBeforePublication(new GraphFailure(400,{code:9,error_subcode:2207042},'token','account/media_publish'),'meta_9',true)).toBe(false);
  expect(canRetryBeforePublication(new Error('network_error'),'network_error',true)).toBe(false);
 });
 it('uses the reported quota and never invents a limit when config is unavailable',()=>{
  expect(quotaExhausted({data:[{quota_usage:10,config:{quota_total:10}}]})).toBe(true);
  expect(quotaExhausted({data:[{quota_usage:9,config:{quota_total:10}}]})).toBe(false);
  expect(quotaExhausted({data:[{quota_usage:100}]})).toBe(false);expect(quotaExhausted({data:[]})).toBe(false);
 });
});
