import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountApprovalGate } from "./AccountApprovalGate";
const mocks = vi.hoisted(() => ({ access: vi.fn(), signOut: vi.fn(), refetch: vi.fn() }));
vi.mock("./api", () => ({ useAdministrationAccess: mocks.access }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signOut: mocks.signOut }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function mount(data: unknown) {
  mocks.access.mockReturnValue({ data, isPending: false, refetch: mocks.refetch });
  return render(<MemoryRouter><AccountApprovalGate><div>Área protegida</div></AccountApprovalGate></MemoryRouter>);
}
describe("account approval gate", () => {
  it("blocks pending accounts and offers refresh and sign out", () => {
    mount({ account_status: "pending" });
    expect(screen.getByText("Aguardando aprovação")).toBeInTheDocument();
    expect(screen.queryByText("Área protegida")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verificar novamente" })); expect(mocks.refetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Sair" })); expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("explains rejection and fails closed when the status is missing", () => {
    const view = mount({ account_status: "rejected" });
    expect(screen.getByText("Cadastro não aprovado")).toBeInTheDocument();
    view.unmount(); mount({}); expect(screen.queryByText("Área protegida")).not.toBeInTheDocument();
  });
  it("allows an approved account", () => { mount({ account_status: "approved" }); expect(screen.getByText("Área protegida")).toBeInTheDocument(); });
  it("blocks rendering when the access request fails", () => {
    mocks.access.mockReturnValue({ isError: true, error: new Error("Falha de conexão"), refetch: mocks.refetch });
    render(<MemoryRouter><AccountApprovalGate><div>Área protegida</div></AccountApprovalGate></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("Falha de conexão");
    expect(screen.queryByText("Área protegida")).not.toBeInTheDocument();
  });
});
