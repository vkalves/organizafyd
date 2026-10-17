import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TikTokPublisher from "./TikTokPublisher";
import PublicInfo from "./PublicInfo";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "11111111-1111-1111-1111-111111111111" } }),
}));
vi.mock("@/features/tiktok/api", () => ({
  ttRequest: request,
  preparePhoto: vi.fn(async (f: File) => f),
  uploadPhoto: vi.fn(async () => {}),
  messages: {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function mount() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TikTokPublisher />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const data = {
  configured: true,
  accounts: [
    {
      id: "account",
      name: "Conta de teste",
      username: "teste",
      paused: false,
      reconnect_required: false,
    },
  ],
  posts: [],
};
beforeEach(() => {
  request.mockImplementation(async (action: string) =>
    action === "list"
      ? data
      : action === "creator"
        ? {
            creator_nickname: "Conta de teste",
            privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
            comment_disabled: true,
          }
        : {},
  );
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("TikTok review controls", () => {
  it("never preselects privacy or enables comments disabled by TikTok", async () => {
    mount();
    await screen.findByText("Conta de teste (@teste)");
    fireEvent.change(screen.getByLabelText("Conta do TikTok"), {
      target: { value: "account" },
    });
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("creator", { accountId: "account" }),
    );
    expect(screen.getByLabelText("Quem pode ver")).toHaveValue("");
    expect(screen.getByLabelText("Permitir comentários")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Autorizar e agendar" }),
    ).toBeDisabled();
  });
  it("requires photo review and fresh consent after a change, preserves exact settings on send", async () => {
    mount();
    await screen.findByText("Conta de teste (@teste)");
    fireEvent.change(screen.getByLabelText("Conta do TikTok"), {
      target: { value: "account" },
    });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Todos" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/Adicionar fotos/), {
      target: {
        files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })],
      },
    });
    await screen.findByAltText("Foto 1");
    fireEvent.change(screen.getByLabelText("Quem pode ver"), {
      target: { value: "SELF_ONLY" },
    });
    const consent = screen.getByLabelText(/Revisei as fotos/);
    fireEvent.click(consent);
    fireEvent.change(screen.getByLabelText(/Título/), {
      target: { value: "Título escolhido" },
    });
    expect(consent).not.toBeChecked();
    fireEvent.click(consent);
    fireEvent.click(
      screen.getByRole("button", { name: "Autorizar e agendar" }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "schedule",
        expect.objectContaining({
          accountId: "account",
          consent: true,
          settings: expect.objectContaining({
            title: "Título escolhido",
            privacy: "SELF_ONLY",
            comments: false,
          }),
        }),
      ),
    );
  });
  it("keeps an unconfirmed submission frozen so retry uses the same ID", async () => {
    const calls: Record<string, unknown>[] = [];
    request.mockImplementation(
      async (action: string, p: Record<string, unknown>) => {
        if (action === "list") return data;
        if (action === "creator")
          return {
            creator_nickname: "Conta de teste",
            privacy_level_options: ["SELF_ONLY"],
            comment_disabled: false,
          };
        if (action === "schedule") {
          calls.push(p);
          throw new Error("network");
        }
        return {};
      },
    );
    mount();
    await screen.findByText("Conta de teste (@teste)");
    fireEvent.change(screen.getByLabelText("Conta do TikTok"), {
      target: { value: "account" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Somente eu" }),
      ).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/Adicionar fotos/), {
      target: {
        files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })],
      },
    });
    await screen.findByAltText("Foto 1");
    fireEvent.change(screen.getByLabelText("Quem pode ver"), {
      target: { value: "SELF_ONLY" },
    });
    fireEvent.click(screen.getByLabelText(/Revisei as fotos/));
    fireEvent.click(
      screen.getByRole("button", { name: "Autorizar e agendar" }),
    );
    await screen.findByText(/Envio não confirmado/);
    expect(screen.getByLabelText(/Título/)).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Continuar o mesmo envio" }),
    );
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].id).toBe(calls[0].id);
  });
  it("exposes policies and service information without authentication", () => {
    render(
      <MemoryRouter initialEntries={["/sobre"]}>
        <PublicInfo />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Organize seu trabalho",
    );
    expect(screen.getByRole("link", { name: "Privacidade" })).toHaveAttribute(
      "href",
      "/privacidade",
    );
    expect(screen.getByRole("link", { name: "Termos de Uso" })).toHaveAttribute(
      "href",
      "/termos",
    );
  });
});
