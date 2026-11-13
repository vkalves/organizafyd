import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Administration from "./Administration";
const mocks = vi.hoisted(() => ({ request: vi.fn(), access: vi.fn() }));
vi.mock("./api", () => ({ adminRequest: mocks.request, useAdministrationAccess: mocks.access }));
function mount() { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter><Administration /></MemoryRouter></QueryClientProvider>); }
const managed={account_status:"approved",id:"fixture-user",email:"user@example.test",display_name:"Pessoa de teste",connected_accounts:2,max_accounts:3,connection_allowed:true,is_admin:false,created_at:"",updated_at:null,storage_limit_bytes:1024**3,storage_used_bytes:100*1024**2};
beforeEach(() => {
  mocks.access.mockReturnValue({data:{is_admin:true},isPending:false,isError:false});
  mocks.request.mockImplementation(async action => action === "users" ? {users:[managed],total:1,summary:{users:4,accounts:7,blocked:1}} : action === "pending_accounts" ? {users:[],total:0} : {ok:true});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe("administrative permissions panel",()=>{
  it("does not fetch a user directory for an ordinary user",()=>{
    mocks.access.mockReturnValue({data:{is_admin:false},isPending:false,isError:false});mount();
    expect(screen.getByText("Acesso restrito")).toBeInTheDocument();expect(mocks.request).not.toHaveBeenCalled();
  });
  it("shows current usage and saves the selected user's limit and connection permission",async()=>{
    mount(); const form=await screen.findByRole("form",{name:"Permissões de user@example.test"});
    expect(screen.getByText("Contas conectadas")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Máximo de contas"),{target:{value:"5"}});
    fireEvent.click(within(form).getByLabelText("Permitir novas conexões"));
    fireEvent.click(within(form).getByRole("button",{name:"Salvar permissões"}));
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("update_access",{user_id:"fixture-user",connection_allowed:false,max_accounts:5}));
    expect(await screen.findByText("Permissões salvas.")).toBeInTheDocument();
  });
  it("supports unlimited access and refuses invalid numerical limits",async()=>{
    mount();const form=await screen.findByRole("form",{name:"Permissões de user@example.test"});
    fireEvent.change(within(form).getByLabelText("Máximo de contas"),{target:{value:"-1"}});
    expect(within(form).getByRole("button",{name:"Salvar permissões"})).toBeDisabled();
    fireEvent.click(within(form).getByLabelText("Sem limite"));fireEvent.submit(form);
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("update_access",{user_id:"fixture-user",connection_allowed:true,max_accounts:null}));
  });
  it("saves a storage upgrade separately from connection permissions",async()=>{
    mount();const form=await screen.findByRole("form",{name:"Limite de armazenamento de user@example.test"});
    expect(screen.getByText("100 MB")).toBeInTheDocument();
    expect(within(form).getByLabelText("Espaço permitido (GB)")).toHaveValue(1);
    fireEvent.change(within(form).getByLabelText("Espaço permitido (GB)"),{target:{value:"2.5"}});
    fireEvent.click(within(form).getByRole("button",{name:"Salvar armazenamento"}));
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("update_storage_limit",{user_id:"fixture-user",limit_bytes:2.5*1024**3}));
    expect(await screen.findByText("Limite de armazenamento salvo.")).toBeInTheDocument();
  });
  it("shows administrators as unlimited without an editable storage field",async()=>{
    mocks.request.mockResolvedValue({users:[{...managed,is_admin:true,storage_limit_bytes:null}],total:1,summary:{users:1,accounts:2,blocked:0}});
    mount();await screen.findByText("Pessoa de teste");
    expect(screen.getByText("Administradores têm armazenamento sem limite.")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Salvar armazenamento"})).not.toBeInTheDocument();
  });
  it("rejects invalid storage values while allowing zero",async()=>{
    mount();const form=await screen.findByRole("form",{name:"Limite de armazenamento de user@example.test"});
    const field=within(form).getByLabelText("Espaço permitido (GB)");const button=within(form).getByRole("button",{name:"Salvar armazenamento"});
    for(const value of ["","-1","10001"]) {fireEvent.change(field,{target:{value}});expect(button).toBeDisabled();}
    fireEvent.change(field,{target:{value:"0"}});expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("update_storage_limit",{user_id:"fixture-user",limit_bytes:0}));
  });
  it("displays fetch failures instead of fabricated zero totals",async()=>{
    mocks.request.mockRejectedValue(new Error("Falha ao consultar permissões"));mount();
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("Falha ao consultar permissões");
    expect(screen.queryByText("Contas conectadas")).not.toBeInTheDocument();
  });
  it("searches by the submitted name or email",async()=>{
    mount();await screen.findByText("Pessoa de teste");
    fireEvent.change(screen.getByLabelText("Buscar usuário por nome ou e-mail"),{target:{value:"pessoa"}});
    fireEvent.click(screen.getByRole("button",{name:"Buscar"}));
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("users",{search:"pessoa",page:1}));
  });
});
