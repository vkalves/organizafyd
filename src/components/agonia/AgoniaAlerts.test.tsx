import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitorData } from "@/features/instagram-publisher/monitor";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  refetch: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  monitor: {
    data: undefined as MonitorData | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: 1,
  },
}));
vi.mock(
  "@/features/instagram-publisher/monitor",
  async (original) => ({
    ...await original<
      typeof import("@/features/instagram-publisher/monitor")
    >(),
    monitorRequest: mocks.request,
  }),
);
vi.mock(
  "@/features/instagram-publisher/InstagramAlerts",
  () => ({
    useInstagramMonitor: () => ({ ...mocks.monitor, refetch: mocks.refetch }),
  }),
);
vi.mock(
  "@/features/instagram-publisher/ConnectAccount",
  () => ({ ConnectAccount: () => <button>Conectar Instagram</button> }),
);
vi.mock(
  "sonner",
  () => ({
    toast: { success: mocks.success, error: mocks.error, info: mocks.info },
  }),
);
import { AgoniaAlerts } from "./AgoniaAlerts";
const accounts = [{ id: "a", username: "perfil_a" }, {
  id: "b",
  username: "perfil_b",
}];
const alert = {
  id: "alert",
  account_id: "a",
  state: "unavailable" as const,
  created_at: "2026-11-17T08:00:00Z",
  read_at: null,
  resolved_at: null,
};
function show(props = {}) {
  return render(
    <MemoryRouter>
      <AgoniaAlerts
        accounts={accounts}
        connections={[]}
        onRefresh={mocks.refresh}
        {...props}
      />
    </MemoryRouter>,
  );
}
function stat(name: string) {
  return screen.getByText(name).closest(".stat-card")!;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.monitor = {
    data: { health: [], alerts: [] },
    isPending: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
  };
  mocks.refetch.mockResolvedValue({});
  mocks.refresh.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue({ ok: true, updated: 1 });
});
afterEach(cleanup);
describe("Central de alertas de contas", () => {
  it("não conta contas desconhecidas ou desatualizadas como saudáveis", () => {
    mocks.monitor.data!.health = [{
      account_id: "a",
      state: "healthy",
      checked_at: new Date(Date.now() - 3600000).toISOString(),
      last_healthy_at: null,
      error_code: null,
    }];
    show();
    expect(stat("Conexão verificada")).toHaveTextContent("0");
    expect(screen.getByText(/2 conta\(s\) aguardando/)).toBeInTheDocument();
    expect(screen.queryByText(/respondendo perfeitamente/)).not
      .toBeInTheDocument();
  });
  it("mostra falha de monitoramento em vez de uma confirmação de saúde", () => {
    mocks.monitor.isError = true;
    show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível atualizar",
    );
    expect(stat("Conexão verificada")).toHaveTextContent("—");
    expect(screen.getByText("Alertas indisponíveis")).toBeInTheDocument();
  });
  it("não anuncia sucesso quando refetch devolve erro", async () => {
    mocks.refetch.mockRejectedValue(new Error("offline"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar lista" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalledWith({ throwOnError: true });
  });
  it("marca todos em uma operação e mantém um alerta lido na lista de pendentes", async () => {
    mocks.monitor.data!.alerts = [alert, {
      ...alert,
      id: "closed",
      resolved_at: alert.created_at,
    }];
    const view = show();
    fireEvent.click(
      screen.getByRole("button", { name: "Marcar todos como lidos" }),
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("read_all"));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    mocks.monitor.data!.alerts = [{ ...alert, read_at: alert.created_at }];
    view.rerender(
      <MemoryRouter>
        <AgoniaAlerts
          accounts={accounts}
          connections={[]}
          onRefresh={mocks.refresh}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Lido · ainda pendente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pendentes (1)" }))
      .toHaveAttribute("aria-pressed", "true");
  });
  it("não anuncia sucesso se marcar todos falhar", async () => {
    mocks.monitor.data!.alerts = [alert];
    mocks.request.mockRejectedValue(new Error("failed"));
    show();
    fireEvent.click(
      screen.getByRole("button", { name: "Marcar todos como lidos" }),
    );
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("prioriza reconexão exigida sobre um diagnóstico antigo saudável", () => {
    mocks.monitor.data!.health = [{
      account_id: "a",
      state: "healthy",
      checked_at: new Date().toISOString(),
      last_healthy_at: null,
      error_code: null,
    }];
    show({ connections: [{ account_id: "a", reconnect_required: true }] });
    fireEvent.click(screen.getByRole("button", { name: /Saúde das contas/ }));
    const row = screen.getByText("@perfil_a").closest("tr")!;
    expect(within(row).getByText("Reconexão necessária")).toBeInTheDocument();
    expect(stat("Conexão verificada")).toHaveTextContent("0");
  });
  it("verifica apenas a conta selecionada e explica o limite de consultas", async () => {
    mocks.request.mockResolvedValue({ status: "recent" });
    show();
    fireEvent.click(screen.getByRole("button", { name: /Saúde das contas/ }));
    fireEvent.click(
      within(screen.getByText("@perfil_a").closest("tr")!).getByRole("button", {
        name: "Verificar conta",
      }),
    );
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith("refresh", "a")
    );
    await waitFor(() =>
      expect(mocks.info).toHaveBeenCalledWith(
        expect.stringContaining("menos de 1 minuto"),
      )
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("filtra contas e evita links inventados para alertas sem conta carregada", () => {
    mocks.monitor.data!.alerts = [alert, {
      ...alert,
      id: "missing",
      account_id: "missing",
    }];
    show();
    expect(
      within(
        screen.getByText("Conta não disponível na lista").closest("article")!,
      ).queryByRole("link", { name: /Perfil/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar conta" }), {
      target: { value: "@perfil_a" },
    });
    expect(
      screen.getByLabelText("Lista de alertas").querySelectorAll("article"),
    ).toHaveLength(1);
  });
});
