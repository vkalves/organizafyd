import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import InstagramConnect from '@/pages/InstagramConnect';
import { loginRequest } from './login';
import { rememberBrowserAuthorization, rememberPendingAuthorization } from './browser-authorization';
vi.mock('./login',()=>({loginRequest:vi.fn()}));
const verifier='a'.repeat(64), nonce='b'.repeat(64);
beforeEach(()=>{vi.resetAllMocks();sessionStorage.clear();localStorage.clear();window.history.replaceState(null,'','/instagram/conectar');});
afterEach(cleanup);
function callback(state='state1') { window.location.hash='code=secret-code&state='+state;sessionStorage.setItem('ig-login:'+state,verifier); }
describe('Instagram authorization return',()=>{
 it('shows manager and bound account before starting authorization',async()=>{
 window.location.hash='invite=test';vi.mocked(loginRequest).mockResolvedValue({manager:'manager@example.com',expected_username:'expected.user'});
 render(<InstagramConnect/>);
 expect(await screen.findByText('manager@example.com')).toBeInTheDocument();
 expect(screen.getByText('@expected.user')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Autorizar no Instagram'})).toBeInTheDocument();
 expect(loginRequest).toHaveBeenCalledTimes(1);expect(loginRequest).toHaveBeenCalledWith('invite_info',{invite:'test'});
 expect(window.location.hash).toBe('');
 });
 it('does not exchange a callback without the browser verifier',async()=>{
 window.location.hash='code=secret-code&state=state1';render(<InstagramConnect/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('navegador em que você o abriu');expect(loginRequest).not.toHaveBeenCalled();expect(window.location.hash).toBe('');
 });
 it('clears proof only after successful completion and never stores callback code',async()=>{
 callback();vi.mocked(loginRequest).mockResolvedValue({username:'client'});
 render(<InstagramConnect/>);expect(await screen.findByText('@client conectado!')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Voltar à Avança'})).toHaveAttribute('href','/avanca/instagram');
 expect(loginRequest).toHaveBeenCalledWith('finish',{code:'secret-code',state:'state1',verifier,allow_selection:true});
 expect(sessionStorage.getItem('ig-login:state1')).toBeNull();expect(localStorage.getItem('ig-login:state1')).toBeNull();expect(sessionStorage.getItem('ig-authorization-pending')).toBeNull();expect(window.location.hash).toBe('');
 });
 it('handles denial without exchange',async()=>{
 window.location.hash='error=authorization_denied';render(<InstagramConnect/>);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('cancelada'));expect(loginRequest).not.toHaveBeenCalled();
 });
 it('recovers a completed result after an ambiguous finish timeout without replaying the code',async()=>{
 callback();vi.mocked(loginRequest).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({status:'completed',result:{username:'expected.user'}});
 render(<InstagramConnect/>);expect(await screen.findByText('@expected.user conectado!')).toBeInTheDocument();
 expect(loginRequest).toHaveBeenNthCalledWith(2,'recovery_status',{state:'state1',verifier});expect(loginRequest).toHaveBeenCalledTimes(2);
 });
 it('retains proof and offers status retry during uncertain processing; reload uses status only',async()=>{
 callback();vi.mocked(loginRequest).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({status:'processing'});
 const first=render(<InstagramConnect/>);expect(await screen.findByRole('button',{name:'Verificar resultado'})).toBeInTheDocument();
 expect(sessionStorage.getItem('ig-login:state1')).not.toBeNull();
 expect(JSON.stringify({...sessionStorage,...localStorage})).not.toContain('secret-code');
 first.unmount();vi.mocked(loginRequest).mockReset();vi.mocked(loginRequest).mockResolvedValueOnce({status:'completed',result:{username:'client'}});
 render(<InstagramConnect/>);expect(await screen.findByText('@client conectado!')).toBeInTheDocument();
 expect(loginRequest).toHaveBeenCalledExactlyOnceWith('recovery_status',{state:'state1',verifier});
 });
 it('requires fresh authorization after lost callback before exchange',async()=>{
 const proof=rememberBrowserAuthorization('state1',verifier);rememberPendingAuthorization(proof);
 vi.mocked(loginRequest).mockResolvedValue({status:'pending'});render(<InstagramConnect/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('código anterior não será reenviado');expect(loginRequest).toHaveBeenCalledExactlyOnceWith('recovery_status',{state:'state1',verifier});
 expect(sessionStorage.getItem('ig-authorization-pending')).toBeNull();
 });
});
describe('Profile chooser after Meta authorization',()=>{
 const accounts=[{id:'17841425197247961',username:'expected.user'},{id:'17841425197247962',username:'another.user'}];
 beforeEach(()=>{callback('state');vi.mocked(loginRequest).mockResolvedValueOnce({selection:nonce,accounts});});
 it('requires explicit choice, retains proof until save and sends only the chosen ID',async()=>{
  vi.mocked(loginRequest).mockResolvedValueOnce({username:'expected.user'});render(<InstagramConnect/>);
  const button=await screen.findByRole('button',{name:'Conectar perfil escolhido'});
  expect(button).toBeDisabled();expect(screen.getAllByRole('radio').every(r=>!(r as HTMLInputElement).checked)).toBe(true);
  expect(sessionStorage.getItem('ig-login:state')).not.toBeNull();
  fireEvent.click(screen.getByRole('radio',{name:'@expected.user'}));fireEvent.click(button);
  expect(await screen.findByText('@expected.user conectado!')).toBeInTheDocument();
  expect(loginRequest).toHaveBeenLastCalledWith('select_account',{selection:nonce,verifier,account_id:'17841425197247961'});
  expect(loginRequest).toHaveBeenCalledTimes(2);expect(screen.queryByRole('radio')).not.toBeInTheDocument();expect(sessionStorage.length).toBe(0);
 });
 it('queries selection result after an uncertain save instead of repeating selection',async()=>{
  vi.mocked(loginRequest).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({status:'completed',result:{username:'expected.user'}});
  render(<InstagramConnect/>);fireEvent.click(await screen.findByRole('radio',{name:'@expected.user'}));fireEvent.click(screen.getByRole('button',{name:'Conectar perfil escolhido'}));
  expect(await screen.findByText('@expected.user conectado!')).toBeInTheDocument();
  expect(loginRequest).toHaveBeenLastCalledWith('recovery_status',{selection:nonce,verifier});expect(loginRequest).toHaveBeenCalledTimes(3);
 });
 it('shows server identity mismatch and requires a fresh link when status is terminal',async()=>{
  vi.mocked(loginRequest).mockRejectedValueOnce(new Error('A conta autorizada não corresponde ao Instagram esperado.')).mockResolvedValueOnce({status:'restart_required'});
  render(<InstagramConnect/>);fireEvent.click(await screen.findByRole('radio',{name:'@another.user'}));fireEvent.click(screen.getByRole('button',{name:'Conectar perfil escolhido'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('não corresponde');expect(screen.getByRole('link',{name:'Voltar e gerar um novo link'})).toBeInTheDocument();expect(screen.queryByRole('radio')).not.toBeInTheDocument();
 });
});
