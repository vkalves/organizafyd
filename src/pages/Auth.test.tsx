import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signIn: vi.fn(), signUp: vi.fn(), resetPassword: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, loading: false, ...auth }) }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notifications }));
import Auth from "./Auth";

function show() {
  return render(<MemoryRouter initialEntries={["/auth"]}><Routes>
    <Route path="/auth" element={<Auth />} />
    <Route path="/avanca" element={<h1>Workspace autenticado</h1>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => { vi.clearAllMocks(); Object.values(auth).forEach(fn => fn.mockResolvedValue({ error: null })); });
afterEach(cleanup);

describe("Avança — contrato do formulário de acesso", () => {
  it("preserva campos, validação, visibilidade da senha e destino de login", async () => {
    show();
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Senha");
    expect(email).toBeRequired();
    expect(email).toHaveAttribute("type", "email");
    expect(password).toHaveAttribute("minlength", "6");
    fireEvent.change(email, { target: { value: "qa@example.test" } });
    fireEvent.change(password, { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByRole("heading", { name: "Workspace autenticado" });
    expect(auth.signIn).toHaveBeenCalledWith("qa@example.test", "test-only-password");
  });
  it("mantém cadastro, recuperação e retorno ao login", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Teste" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa@example.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar minha conta" }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith("qa@example.test", "test-only-password", "Teste"));
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Esqueceu a senha?" }));
    expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar link de recuperação" }));
    await waitFor(() => expect(auth.resetPassword).toHaveBeenCalledWith("qa@example.test"));
    fireEvent.click(screen.getByRole("button", { name: /Voltar ao login/ }));
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
  });
  it("mantém feedback de erro e permite tentar novamente", async () => {
    auth.signIn.mockResolvedValue({ error: { message: "Credenciais inválidas" } });
    show();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa@example.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(notifications.error).toHaveBeenCalledWith("Credenciais inválidas"));
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });
});
