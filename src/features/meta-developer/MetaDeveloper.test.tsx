import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock("@/features/instagram-publisher/login", () => ({
  loginRequest: mocks.config,
}));
vi.mock("@/features/instagram-publisher/ConnectAccount", () => ({
  ConnectAccount: () => <button>Conectar conta</button>,
}));
import MetaDeveloper from "./MetaDeveloper";
const callback = "https://project.supabase.co/functions/v1/instagram-login";
function show() {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
          })
        }
      >
        <MetaDeveloper onConnected={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({ ready: true, callback });
});
describe("Meta Developer guided integration", () => {
  it("keeps technical setup separate, moves focus with each step, and resets when switching guides", async () => {
    show();
    await screen.findByText("Conexão da Avança disponível");
    expect(
      screen.getByRole("heading", { level: 2, name: /Instagram precisa/ }),
    ).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próximo passo" }));
    expect(
      screen.getByRole("heading", { name: /Conecte pela tela/ }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Conectar conta" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Quero configurar/ }));
    expect(screen.getByRole("heading", { name: /Abra seu app/ })).toHaveFocus();
    expect(
      screen.getByRole("link", { name: /Abrir Meta for Developers/ }),
    ).toHaveAttribute("href", "https://developers.facebook.com/apps/");
    fireEvent.click(screen.getByRole("button", { name: /Quero conectar/ }));
    expect(screen.getByRole("button", { name: "Voltar" })).toBeDisabled();
  });
  it("copies the server callback and reports clipboard failures without claiming success", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    show();
    await screen.findByText("Conexão da Avança disponível");
    fireEvent.click(screen.getByRole("button", { name: /Quero configurar/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /3 Endereço de retorno/ }),
    );
    expect(screen.getByLabelText("Endereço de retorno da Avança")).toHaveValue(
      callback,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copiar endereço de retorno" }),
    );
    await screen.findByText(/Não foi possível copiar/);
    fireEvent.click(
      screen.getByRole("button", { name: "Copiar endereço de retorno" }),
    );
    await screen.findByText("Endereço copiado.");
    expect(writeText).toHaveBeenLastCalledWith(callback);
  });
  it("offers retry on configuration errors and does not invent a callback", async () => {
    mocks.config.mockRejectedValueOnce(new Error("offline"));
    show();
    await screen.findByText("Não foi possível consultar a configuração.");
    fireEvent.click(screen.getByRole("button", { name: /Quero configurar/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /3 Endereço de retorno/ }),
    );
    expect(
      screen.queryByRole("button", { name: "Copiar endereço de retorno" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar status da integração" }),
    );
    await screen.findByDisplayValue(callback);
    expect(mocks.config).toHaveBeenCalledTimes(2);
  });
  it("distinguishes configured server from pending setup and provides account navigation", async () => {
    mocks.config.mockResolvedValue({ ready: false, callback });
    show();
    await screen.findByText(
      "Conexão aguardando configuração pelo administrador",
    );
    fireEvent.click(screen.getByRole("button", { name: /3 Confira/ }));
    expect(
      screen.getByRole("link", { name: "Ver minhas contas" }),
    ).toHaveAttribute("href", "/avanca/instagram");
    expect(
      screen.getByRole("link", { name: "Ir para Instagram" }),
    ).toHaveAttribute("href", "/avanca/instagram");
    expect(
      screen.queryByRole("button", { name: "Próximo passo" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.config).toHaveBeenCalledWith("config"));
  });
});

it("hides global credentials from ordinary users", async () => {
  show();
  await screen.findByText("Conexão da Avança disponível");
  fireEvent.click(screen.getByRole("button", { name: /Quero configurar/ }));
  fireEvent.click(screen.getByRole("button", { name: /4 Ative/ }));
  expect(screen.queryByLabelText("Meta App Secret")).not.toBeInTheDocument();
  expect(screen.getByText(/Somente administradores da integração/)).toBeVisible();
});
it("offers credential setup to server-authorized administrators even before setup", async () => {
  mocks.config.mockResolvedValue({ ready: false, callback, canManage: true });
  show();
  await screen.findByText("Conexão aguardando configuração pelo administrador");
  fireEvent.click(screen.getByRole("button", { name: /Quero configurar/ }));
  fireEvent.click(screen.getByRole("button", { name: /4 Ative/ }));
  expect(screen.getByLabelText("Meta App Secret")).toBeRequired();
});
