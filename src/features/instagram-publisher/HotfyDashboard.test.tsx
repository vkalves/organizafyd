import { render, screen, fireEvent } from '@testing-library/react';
import { describe,it,expect,vi } from 'vitest';
import { HotfyDashboard, publishedToday } from './HotfyDashboard';
import type { Post } from './model';
const base: Post = {id:'p',user_id:'u',account_id:'a',caption:'Meu Reel',format:'Reel',media_urls:[],scheduled_at:'2027-01-01T15:00:00Z',status:'scheduled',created_at:'2026-01-01',updated_at:'2026-01-01'};
const props = {accounts:[{id:'a',username:'modelo'}],connections:[],posts:[base],loading:false,failed:false,monitorFailed:false,view:'dashboard' as const,go:vi.fn(),connect:<button>Conectar conta</button>,markRead:vi.fn(),reading:false};
describe('Hotfy Instagram dashboard',()=>{
 it('opens the existing publishing flow and uses real queued content',()=>{
  render(<HotfyDashboard {...props} />);
  expect(screen.getByText('Meu Reel')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Enviar um Reel'}));
  expect(props.go).toHaveBeenCalledWith('compose','Reel');
 });
 it('counts actual publication time instead of scheduled time',()=>{
  expect(publishedToday({...base,status:'published',published_at:'2026-06-01T12:00:00'},new Date('2026-06-01T20:00:00'))).toBe(true);
  expect(publishedToday({...base,status:'published'},new Date('2027-01-01T20:00:00'))).toBe(false);
 });
 it('preserves active warnings after marking read and explains uncertainty',()=>{
  render(<HotfyDashboard {...props} view="alerts" monitor={{health:[],alerts:[{id:'alert',account_id:'a',state:'unavailable',created_at:'2026-06-01T12:00:00Z',read_at:null,resolved_at:null}]}} />);
  expect(screen.getByText(/Perfil inacessível pela API/)).toBeInTheDocument();
  expect(screen.getByText(/restrição, desativação ou mudança de acesso/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Marcar como lido'}));
  expect(props.markRead).toHaveBeenCalledWith('alert');
 });
});
