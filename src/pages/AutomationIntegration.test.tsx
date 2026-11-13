import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks=vi.hoisted(()=>({preflight:vi.fn(),syncToFlow:vi.fn(),listFlows:vi.fn()}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'}})}));
vi.mock('@/features/instagram-publisher/automation-api',()=>({automationApi:{preflight:mocks.preflight,syncToFlow:mocks.syncToFlow}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({select:()=>({eq:()=>({eq:()=>({order:()=>mocks.listFlows()})})})})}}));
import AutomationIntegration from './AutomationIntegration';
const account={userId:'owner',accountId:'internal-account',graphId:'123456',username:'same.account'};
function mount(){render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AutomationIntegration/></QueryClientProvider></MemoryRouter>);}
beforeEach(()=>{vi.clearAllMocks();mocks.listFlows.mockResolvedValue({data:[{id:'existing-flow',user_id:'owner',name:'Fluxo existente',state:'active'}],error:null});mocks.preflight.mockResolvedValue(account);mocks.syncToFlow.mockResolvedValue({...account,flowId:'existing-flow',flowName:'Fluxo existente',alreadyAssociated:false,recoveredAfterWriteError:false,added:1,queued:2});});
afterEach(cleanup);
it('requires user confirmation and live identity check before synchronizing',async()=>{
 mount();expect(screen.getByRole('button',{name:'Verificar e sincronizar'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('@ usado no Android e no Chrome'),{target:{value:'same.account'}});
 fireEvent.click(screen.getByRole('checkbox'));
 await screen.findByRole('option',{name:'Fluxo existente'});
 fireEvent.change(screen.getByLabelText('Fluxo ativo existente'),{target:{value:'existing-flow'}});
 expect(screen.getByRole('button',{name:'Verificar e sincronizar'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Verificar identidade'}));
 await screen.findByText(/Identidade confirmada na Meta/);
 fireEvent.click(screen.getByRole('button',{name:'Verificar e sincronizar'}));
 await screen.findByText('Associação confirmada');
 expect(mocks.syncToFlow).toHaveBeenCalledWith({expectedUsername:'same.account',expectedGraphId:'123456',accountId:'internal-account',flowId:'existing-flow'});
});
it('invalidates verified identity when the expected handle changes',async()=>{
 mount();fireEvent.change(screen.getByLabelText('@ usado no Android e no Chrome'),{target:{value:'same.account'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Verificar identidade'}));await screen.findByText(/Identidade confirmada na Meta/);fireEvent.change(screen.getByLabelText('@ usado no Android e no Chrome'),{target:{value:'different.account'}});expect(screen.queryByText(/Identidade confirmada na Meta/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Verificar e sincronizar'})).toBeDisabled();
});
it('renders a readback failure without reporting success',async()=>{
 mocks.syncToFlow.mockRejectedValue(new Error('Resultado não confirmado; consulte o fluxo.'));
 mount();fireEvent.change(screen.getByLabelText('@ usado no Android e no Chrome'),{target:{value:'same.account'}});fireEvent.click(screen.getByRole('checkbox'));await screen.findByRole('option',{name:'Fluxo existente'});fireEvent.change(screen.getByLabelText('Fluxo ativo existente'),{target:{value:'existing-flow'}});fireEvent.click(screen.getByRole('button',{name:'Verificar identidade'}));await screen.findByText(/Identidade confirmada na Meta/);fireEvent.click(screen.getByRole('button',{name:'Verificar e sincronizar'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Resultado não confirmado'));expect(screen.queryByText('Associação confirmada')).not.toBeInTheDocument();
});
