import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  add: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u" } }),
}));
vi.mock("./flows-api", () => ({
  loadFlowData: mocks.load,
  createFlow: mocks.create,
  savePrefs: mocks.save,
  addMedia: mocks.add,
  setMedia: vi.fn(),
  previewMedia: vi.fn(),
  cancelFlow: vi.fn(),
  controlFlow: vi.fn(),
}));
vi.mock("./sound", () => ({
  playConfirmation: vi.fn(),
  unlockAudio: vi.fn(),
}));
import Flows from "./Flows";
const media = {
  id: "m",
  url: "storage://u/a.jpg",
  kind: "posts",
  folder: "",
  caption: "",
  created_at: "2026-01-01",
};
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Flows
        accounts={[{ id: "a", username: "perfil" }]}
        connections={[
          { account_id: "a", paused: false, reconnect_required: false },
        ]}
        posts={[]}
        onCreated={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );
}
describe("Fluxos interface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue({
      media: [media],
      prefs: { user_id: "u", folders: [], captions: [] },
      flows: [],
      report: { flows: [], usage: [] },
    });
    mocks.create.mockResolvedValue({ ok: true });
  });
  it("exige seleção, conserva a distribuição e envia os dados revisados", async () => {
    show();
    await screen.findByRole("heading", { name: /Biblioteca de mídias/ });
    const submit = screen.getByRole("button", {
      name: "Criar fluxo e iniciar",
    });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Foto 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "@perfil" }));
    expect(submit).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Nome do fluxo (opcional)"), {
      target: { value: "Campanha" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Dividir entre as contas" }),
    );
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Campanha",
          accountIds: ["a"],
          mediaIds: ["m"],
          gapMinutes: 60,
          distribution: "split",
          startAt: null,
        }),
      ),
    );
  });
  it("envia horários fixos sem transformar o GAP em espaçamento", async () => {
    show();
    await screen.findByRole("heading", { name: /Biblioteca de mídias/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Foto 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "@perfil" }));
    fireEvent.click(screen.getByRole("button", { name: "Horários fixos" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Criar fluxo e iniciar" }),
    );
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: "slots",
          slots: ["09:00", "12:30", "18:00", "21:00"],
          gapMinutes: 3,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          startAt: null,
        }),
      ),
    );
  });
  it("troca para Stories e exige nova seleção", async () => {
    show();
    await screen.findByText("Foto 1");
    fireEvent.click(screen.getByRole("checkbox", { name: "Foto 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Stories (0)" }));
    expect(
      screen.getByRole("heading", { name: /Story em várias contas/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Criar fluxo de Stories" }),
    ).toBeDisabled();
  });
  it("envia loop, descanso e legendas da pasta na criação da campanha", async () => {
    show();
    await screen.findByRole("heading", { name: /Biblioteca de mídias/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Foto 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "@perfil" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Repetir campanha em loop" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Descansar entre lotes" }),
    );
    fireEvent.change(screen.getByLabelText("Publicações por lote, por conta"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByText("Legendas sorteadas por pasta"));
    fireEvent.change(
      screen.getByLabelText("Sem pasta", { selector: "textarea" }),
      { target: { value: "Legenda A\n---\nLegenda B" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Criar fluxo e iniciar" }),
    );
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          repeat: "loop",
          batchSize: 2,
          restMinutes: 20,
          avoidReuse: true,
          folderCaptions: { "": ["Legenda A", "Legenda B"] },
        }),
      ),
    );
  });
});
