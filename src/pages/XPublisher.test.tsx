import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import XPublisher from "./XPublisher";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  upload: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toast, error: mocks.toast },
}));
vi.mock("@/features/x/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/x/api")>()),
  xRequest: mocks.request,
  uploadFiles: mocks.upload,
}));
const accounts = [
  {
    id: "first",
    username: "conta1",
    name: "Primeira",
    paused: false,
    reconnect_required: false,
  },
  {
    id: "second",
    username: "conta2",
    name: "Segunda",
    paused: false,
    reconnect_required: false,
  },
];
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <XPublisher />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.request.mockReset();
  mocks.upload.mockReset();
  mocks.toast.mockReset();
  mocks.request.mockImplementation(async (action) =>
    action === "list"
      ? { configured: true, accounts, posts: [] }
      : { success: true },
  );
  mocks.upload.mockResolvedValue([]);
});
afterEach(cleanup);
describe("X publishing panel", () => {
  it("explains setup and disables account connection when the server is unconfigured", async () => {
    mocks.request.mockResolvedValue({
      configured: false,
      accounts: [],
      posts: [],
    });
    mount();
    expect(
      await screen.findByText("Falta ativar a integração"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Conectar conta" }),
    ).toBeDisabled();
  });
  it("schedules for the explicitly selected account", async () => {
    mount();
    await screen.findByText("@conta1", { selector: "h2" });
    fireEvent.change(screen.getByLabelText("Conta"), {
      target: { value: "second" },
    });
    fireEvent.change(screen.getByLabelText("Texto da postagem"), {
      target: { value: "Publicar na segunda conta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agendar postagem" }));
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "schedule",
        expect.objectContaining({
          accountId: "second",
          text: "Publicar na segunda conta",
          media: [],
        }),
      ),
    );
    expect(
      mocks.request.mock.calls.filter((c) => c[0] === "schedule"),
    ).toHaveLength(1);
  });
  it("does not allow scheduling with a disconnected account", async () => {
    mocks.request.mockResolvedValue({
      configured: true,
      accounts: [{ ...accounts[0], reconnect_required: true }],
      posts: [],
    });
    mount();
    await screen.findByText("Reconectar");
    fireEvent.change(screen.getByLabelText("Texto da postagem"), {
      target: { value: "Teste" },
    });
    expect(
      screen.getByRole("button", { name: "Agendar postagem" }),
    ).toBeDisabled();
  });
  it("shows ambiguous sends without an automatic retry button", async () => {
    mocks.request.mockResolvedValue({
      configured: true,
      accounts,
      posts: [
        {
          id: "post",
          account_id: "first",
          text: "Teste",
          media: [],
          scheduled_at: new Date().toISOString(),
          status: "uncertain",
          error_code: "confirmation_required",
          x_post_id: null,
        },
      ],
    });
    mount();
    expect(
      await screen.findByText("Conferir no X", { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a publicação pode ter sido enviada/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reenviar|tentar novamente/i }),
    ).not.toBeInTheDocument();
  });
});
