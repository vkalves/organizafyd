import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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
 expect(await screen.findByRole('alert')).toHaveTextContent('navegador em que você o abriu');expect(loginRequest).not.toHaveBeenCalled();expect(window.location.hash).toBe('');
 });
 it('consumes browser verifier and sends it only in the exchange request',async()=>{
 window.location.hash='code=secret-code&state=state1';sessionStorage.setItem('ig-login:state1','verifier');vi.mocked(loginRequest).mockResolvedValue({username:'client'});
 render(<InstagramConnect/>);expect(await screen.findByText('@client conectado!')).toBeInTheDocument();expect(screen.getByRole('link',{name:'Voltar à Avança'})).toHaveAttribute('href','/avanca/instagram');
 expect(loginRequest).toHaveBeenCalledWith('finish',{code:'secret-code',state:'state1',verifier:'verifier',allow_selection:true});expect(sessionStorage.getItem('ig-login:state1')).toBeNull();
 });
 it('handles denial without exchange',async()=>{
 window.location.hash='error=authorization_denied';render(<InstagramConnect/>);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('cancelada'));expect(loginRequest).not.toHaveBeenCalled();
 });
});

describe('Profile chooser after Meta authorization',()=>{
 const accounts=[{id:'17841425197247961',username:'realjujuabacate'},{id:'17841425197247962',username:'jujuabacate.ofc'}];
 beforeEach(()=>{window.location.hash='code=code&state=state';sessionStorage.setItem('ig-login:state','proof');vi.mocked(loginRequest).mockResolvedValueOnce({selection:'nonce',accounts});});
 it('requires an explicit choice and sends only the chosen ID with its browser proof',async()=>{
  vi.mocked(loginRequest).mockResolvedValueOnce({username:'realjujuabacate'});
  render(<InstagramConnect/>);
  const button=await screen.findByRole('button',{name:'Conectar perfil escolhido'});
  expect(button).toBeDisabled();expect(screen.getAllByRole('radio').every(r=>!(r as HTMLInputElement).checked)).toBe(true);
  expect(loginRequest).toHaveBeenCalledTimes(1);expect(sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole('radio',{name:'@realjujuabacate'}));fireEvent.click(button);
  expect(await screen.findByText('@realjujuabacate conectado!')).toBeInTheDocument();
  expect(loginRequest).toHaveBeenLastCalledWith('select_account',{selection:'nonce',verifier:'proof',account_id:'17841425197247961'});
  expect(loginRequest).toHaveBeenCalledTimes(2);expect(screen.queryByRole('radio')).not.toBeInTheDocument();
 });
 it('shows selection errors and offers a fresh link without replaying the OAuth code',async()=>{
  vi.mocked(loginRequest).mockRejectedValueOnce(new Error('Esta escolha expirou. Gere um novo link.'));
  render(<InstagramConnect/>);
  fireEvent.click(await screen.findByRole('radio',{name:'@jujuabacate.ofc'}));fireEvent.click(screen.getByRole('button',{name:'Conectar perfil escolhido'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('expirou');
  expect(screen.getByRole('link',{name:'Voltar e gerar um novo link'})).toHaveAttribute('href','/avanca/instagram');
  expect(loginRequest).toHaveBeenCalledTimes(2);
 });
});
