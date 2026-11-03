import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import InstagramConnect from '@/pages/InstagramConnect';
import { loginRequest } from './login';
vi.mock('./login',()=>({loginRequest:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();window.history.replaceState(null,'','/instagram/conectar');});
afterEach(cleanup);
describe('Instagram authorization return',()=>{
 it('shows manager and requires explicit consent before starting authorization',async()=>{
 window.location.hash='invite=test';vi.mocked(loginRequest).mockResolvedValue({manager:'manager@example.com'});
 render(<InstagramConnect/>);
 expect(await screen.findByText('manager@example.com')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Autorizar no Instagram'})).toBeInTheDocument();
 expect(loginRequest).toHaveBeenCalledTimes(1);expect(loginRequest).toHaveBeenCalledWith('invite_info',{invite:'test'});
 expect(window.location.hash).toBe('');
 });
 it('does not exchange a callback without the browser verifier',async()=>{
 window.location.hash='code=secret-code&state=state1';render(<InstagramConnect/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('mesmo navegador');expect(loginRequest).not.toHaveBeenCalled();expect(window.location.hash).toBe('');
 });
 it('consumes browser verifier and sends it only in the exchange request',async()=>{
 window.location.hash='code=secret-code&state=state1';sessionStorage.setItem('ig-login:state1','verifier');vi.mocked(loginRequest).mockResolvedValue({username:'client'});
 render(<InstagramConnect/>);expect(await screen.findByText('@client conectado!')).toBeInTheDocument();
 expect(loginRequest).toHaveBeenCalledWith('finish',{code:'secret-code',state:'state1',verifier:'verifier'});expect(sessionStorage.getItem('ig-login:state1')).toBeNull();
 });
 it('handles denial without exchange',async()=>{
 window.location.hash='error=authorization_denied';render(<InstagramConnect/>);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('cancelada'));expect(loginRequest).not.toHaveBeenCalled();
 });
});
