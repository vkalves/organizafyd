import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  add: vi.fn(),
  setMedia: vi.fn(),
  control: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  sync: vi.fn(),
  importReel: vi.fn(),
}));
vi.mock("./reel-import", async () => {
  const { parseReelUrl } = await import("../../../supabase/functions/instagram-reel-import/url");
  return { parseReelUrl, importReelFile: mocks.importReel };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u" } }),
}));
vi.mock("./flows-api", () => ({
  loadFlowData: mocks.load,
  createFlow: mocks.create,
  addFlowAccounts: mocks.sync,
  savePrefs: mocks.save,
  addMedia: mocks.add,
  setMedia: mocks.setMedia,
  previewMedia: vi.fn().mockResolvedValue(null),
  deleteMedia: vi.fn().mockResolvedValue(undefined),
  cancelFlow: mocks.cancel,
  controlFlow: mocks.control,
  deleteFlow: mocks.remove,
}));
vi.mock("./sound", () => ({
  playConfirmation: vi.fn(),
  unlockAudio: vi.fn(),
}));
vi.mock("./LocalMediaPreviews", () => ({ LocalMediaPreviews: () => null }));
import Flows from "./Flows";
const media = {
  id: "m",
  url: "storage://u/a.jpg",
  kind: "posts",
  folder: "",
  caption: "",
  created_at: "2026-01-01",
};
function show(accounts = [{ id: "a", username: "perfil" }]) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Flows
        accounts={accounts}
        connections={accounts.map(account => ({ account_id: account.id, paused: false, reconnect_required: false }))}
        posts={[]}
        onCreated={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );
}
describe("Fluxos interface", () => {
  it("permite sincronizar uma nova conta na campanha ativa sem recriar o fluxo", async () => {
    mocks.sync.mockResolvedValue({added:1,queued:2});
    mocks.load.mockResolvedValue({media:[media],prefs:{user_id:"u",folders:[],captions:[]},flows:[{id:"f1",name:"Campanha ativa",state:"active",cycle:1,settings:{accountIds:["a"],mediaIds:["m"],kind:"posts",repeat:"loop",gapMinutes:60}}],report:{flows:[],usage:[]}});
    show([{id:"a",username:"perfil"},{id:"b",username:"novo_perfil"}]);
    await screen.findByRole("heading",{name:/Biblioteca de mídias/});
    fireEvent.click(screen.getByRole("button",{name:/Campanhas \(1\)/}));
    fireEvent.click(screen.getByRole("button",{name:"Conectar conta ao fluxo"}));
    expect(screen.getByRole("button",{name:"Sincronizar contas"})).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox",{name:"@novo_perfil"}));
    fireEvent.click(screen.getByRole("button",{name:"Sincronizar contas"}));
    await waitFor(()=>expect(mocks.sync).toHaveBeenCalledWith("f1",["b"]));
    expect(mocks.create).not.toHaveBeenCalled();
  });
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
  it("acrescenta novas seleções à fila em andamento e processa todos os arquivos na ordem", async () => {
    let finishFirst: () => void;
    mocks.add.mockImplementationOnce((files, _user, _kind, _folder, _progress, callbacks) => {
      callbacks.onItem({ index: 0, name: files[0].name, status: "processing", message: "Limpando vídeo…" });
      return new Promise(resolve => { finishFirst = () => {
        callbacks.onItem({ index: 0, name: files[0].name, status: "done", message: "Pronta para publicar" });
        resolve({ ids: ["first"], errors: [] });
      }; });
    }).mockImplementation(async (files, _user, _kind, _folder, _progress, callbacks) => {
      callbacks.onItem({ index: 0, name: files[0].name, status: "done", message: "Pronta para publicar" });
      return { ids: [files[0].name], errors: [] };
    });
    mocks.load.mockResolvedValue({ media: [], prefs: { user_id: "u", folders: [], captions: [] }, flows: [], report: { flows: [], usage: [] } });
    show(); await screen.findByRole("heading", { name: /Biblioteca de mídias/ });
    const input = screen.getByLabelText("Adicionar mídias à fila");
    const files = ["one.mp4", "two.mp4", "three.mp4", "four.mp4"].map(name => new File(["video"], name, { type: "video/mp4" }));
    fireEvent.change(input, { target: { files: [files[0]] } });
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    expect(input).toBeEnabled();
    expect(screen.getByLabelText("Adicionar mídias à pasta vazia")).toBeEnabled();
    fireEvent.change(input, { target: { files: files.slice(1) } });
    const queue = screen.getByRole("region", { name: "Fila de upload" });
    expect(within(queue).getByText("four.mp4")).toBeInTheDocument();
    expect(mocks.add).toHaveBeenCalledTimes(1);
    await act(async () => { finishFirst!(); });
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(4));
    expect(mocks.add.mock.calls.map(call => call[0].map((file: File) => file.name))).toEqual(files.map(file => [file.name]));
    expect(within(queue).getAllByText("Pronta para publicar")).toHaveLength(4);
    expect(input).toBeEnabled();
  });
  it("enfileira um arquivo arrastado apenas uma vez e continua após uma falha", async () => {
    let failFirst: () => void;
    mocks.add.mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = () => reject(new Error("Vídeo inválido")); }))
      .mockImplementation(async (files, _user, _kind, _folder, _progress, callbacks) => {
        callbacks.onItem({ index: 0, name: files[0].name, status: "done", message: "Pronta para publicar" });
        return { ids: ["second"], errors: [] };
      });
    show(); await screen.findByRole("heading", { name: /Biblioteca de mídias/ });
    const input = screen.getByLabelText("Adicionar mídias à fila");
    fireEvent.change(input, { target: { files: [new File(["x"], "bad.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    fireEvent.drop(input.closest("label")!, { dataTransfer: { files: [new File(["x"], "next.mp4", { type: "video/mp4" })] } });
    const queue = screen.getByRole("region", { name: "Fila de upload" });
    expect(within(queue).getAllByText("next.mp4")).toHaveLength(1);
    await act(async () => { failFirst!(); });
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(2));
    expect(within(queue).getByText("Vídeo inválido")).toBeInTheDocument();
    expect(within(queue).getByText("Pronta para publicar")).toBeInTheDocument();
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

  it("move mídia para uma pasta pelo inspetor individual", async () => {
    mocks.setMedia.mockResolvedValue(undefined);
    mocks.load.mockResolvedValue({
      media: [media],
      prefs: { user_id: "u", folders: ["Ofertas"], captions: [] },
      flows: [],
      report: { flows: [], usage: [] },
    });

    show();
    await screen.findByRole("heading", { name: /Biblioteca de mídias/ });
    fireEvent.click(screen.getByRole("button", { name: /Visualizar (vídeo|foto) 1/i }));
    fireEvent.change(
      await screen.findByLabelText(/Pasta desta mídia/i),
      { target: { value: "Ofertas" } },
    );

    await waitFor(() => {
      expect(mocks.setMedia).toHaveBeenCalledWith("m", { folder: "Ofertas" });
    });
  });
  it("valida o link do Reel e encaminha o vídeo baixado pela mesma fila de limpeza", async () => {
    const file = new File(["downloaded"], "reel.mp4", { type: "video/mp4" });
    mocks.importReel.mockResolvedValue(file);
    mocks.add.mockImplementation(async (files, _user, _kind, _folder, _progress, callbacks) => {
      callbacks.onItem({ index: 0, name: files[0].name, status: "done", message: "Pronta para publicar" });
      return { ids: ["imported"], errors: [] };
    });
    show(); await screen.findByRole("heading", { name: /Biblioteca de mídias/ });
    fireEvent.click(screen.getByRole("button", { name: "Importar Reel por link" }));
    const input = await screen.findByLabelText("Link do Reel");
    fireEvent.change(input, { target: { value: "https://other.example/reel/abcdef/" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cole um link válido"); expect(mocks.importReel).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "https://www.instagram.com/reel/DY2PcmxiBE2/?igsh=tracking" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(mocks.importReel).toHaveBeenCalledWith("https://www.instagram.com/reel/DY2PcmxiBE2/"));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith([file], "u", "posts", "", expect.any(Function), expect.any(Object)));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("mostra ações de pasta só após selecionar mídias e move pela pasta escolhida", async () => {
    mocks.setMedia.mockResolvedValue(undefined);
    mocks.load.mockResolvedValue({ media: [media], prefs: { user_id: "u", folders: ["Ofertas"], captions: [] }, flows: [], report: { flows: [], usage: [] } });
    show(); await screen.findByRole("heading", { name: /Biblioteca de mídias/ });
    const actions = screen.getByRole("group", { name: "Ações das mídias da pasta aberta" });
    expect(within(actions).getByRole("status")).toHaveTextContent("1 mídia");
    expect(within(actions).queryByRole("button", { name: "Mover para" })).not.toBeInTheDocument();
    fireEvent.click(within(actions).getByRole("checkbox", { name: "Selecionar todas as mídias desta pasta" }));
    expect(screen.getByRole("checkbox", { name: "Foto 1" })).toBeChecked();
    expect(within(actions).getByRole("status")).toHaveTextContent("1 selecionada");
    fireEvent.keyDown(within(actions).getByRole("button", { name: "Mover para" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ofertas" }));
    await waitFor(() => expect(mocks.setMedia).toHaveBeenCalledWith("m", { folder: "Ofertas" }));
    await waitFor(() => expect(within(actions).queryByRole("button", { name: "Mover para" })).not.toBeInTheDocument());
    fireEvent.click(within(actions).getByRole("checkbox", { name: "Selecionar todas as mídias desta pasta" }));
    fireEvent.click(within(actions).getByRole("button", { name: "Limpar seleção" }));
    expect(screen.getByRole("checkbox", { name: "Foto 1" })).not.toBeChecked();
  });

  it("separa a gestão de campanhas e permite reutilizar, cancelar e apagar fluxos", async () => {
    mocks.cancel.mockResolvedValue({ ok: true });
    mocks.remove.mockResolvedValue(undefined);
    mocks.load.mockResolvedValue({
      media: [media],
      prefs: { user_id: "u", folders: [], captions: [] },
      flows: [
        {
          id: "f1",
          name: "Reels Diários",
          created_at: "2026-01-02",
          state: "active",
          cycle: 2,
          settings: {
            id: "f1",
            name: "Reels Diários",
            accountIds: ["a"],
            mediaIds: ["m"],
            gapMinutes: 120,
            random: false,
            distribution: "split",
            format: "Reel",
            kind: "posts",
            caption: "Legenda reaproveitada",
            variations: [],
            startAt: null,
            coverId: null,
            repeat: "loop",
          },
        },
      ],
      report: {
        flows: [{ id: "f1", published: 4, pending: 2, review: 0 }],
        usage: [],
      },
    });

    show();
    await screen.findByRole("heading", { name: /Biblioteca de mídias/ });

    fireEvent.click(screen.getByRole("button", { name: /Campanhas \(1\)/ }));
    expect(screen.getByText("Reels Diários")).toBeInTheDocument();
    expect(screen.getByText("4 publicado(s)")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações de Reels Diários" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancelar fluxo" }));
    await waitFor(() => {
      expect(mocks.cancel).toHaveBeenCalledWith("f1");
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações de Reels Diários" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Apagar fluxo" }));
    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith("f1", "u");
    });
  });
});
