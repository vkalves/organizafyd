import { beforeEach, expect, it, vi } from 'vitest';
import { clearBrowserAuthorization, readBrowserAuthorization, readPendingAuthorization, rememberBrowserAuthorization, rememberPendingAuthorization } from './browser-authorization';
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.useRealTimers();});
it('retains proof with bounded expiry and a pending reference without callback code',()=>{
 const proof=rememberBrowserAuthorization('state','a'.repeat(64),'same.account');rememberPendingAuthorization(proof,'b'.repeat(64));
 expect(readPendingAuthorization()).toMatchObject({state:'state',verifier:'a'.repeat(64),expectedUsername:'same.account',selection:'b'.repeat(64)});
 expect(JSON.parse(sessionStorage.getItem('ig-authorization-pending')!)).toEqual({state:'state',selection:'b'.repeat(64)});
 clearBrowserAuthorization('state');expect(readPendingAuthorization()).toBeNull();expect(localStorage.length).toBe(0);
});
it('rejects expired proof on reload and clears it',()=>{
 vi.useFakeTimers();const now=Date.now();vi.setSystemTime(now);const proof=rememberBrowserAuthorization('state','a'.repeat(64));rememberPendingAuthorization(proof);
 vi.setSystemTime(now+600001);expect(readPendingAuthorization()).toBeNull();expect(localStorage.getItem('ig-login:state')).toBeNull();
});
it('does not let an old tab-only proof refresh its expiry on every reload',()=>{
 vi.useFakeTimers();const now=Date.now();vi.setSystemTime(now);sessionStorage.setItem('ig-login:old','a'.repeat(64));
 expect(readBrowserAuthorization('old')).not.toBeNull();vi.setSystemTime(now+600001);expect(readBrowserAuthorization('old')).toBeNull();
});
it('prunes old proofs before recording another authorization',()=>{
 localStorage.setItem('ig-login:expired',JSON.stringify({verifier:'proof',expiresAt:0}));localStorage.setItem('unrelated','preserve');rememberBrowserAuthorization('new','a'.repeat(64));
 expect(localStorage.getItem('ig-login:expired')).toBeNull();expect(localStorage.getItem('unrelated')).toBe('preserve');
});
