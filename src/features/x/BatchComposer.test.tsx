import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchComposer } from "./BatchComposer";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  upload: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("./api", () => ({
  xRequest: mocks.request,
  uploadFiles: mocks.upload,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toast, success: mocks.toast, info: mocks.toast },
}));
const accounts = [
  {
    id: "first",
    username: "primeira",
    name: "Primeira",
    paused: false,
    reconnect_required: false,
  },
  {
    id: "second",
    username: "segunda",
    name: "Segunda",
    paused: false,
    reconnect_required: false,
  },
];
const dates = () => {
  const first = new Date(Date.now() + 86400000);
  first.setSeconds(0, 0);
  const second = new Date(first.getTime() + 527 * 60000);
  const local = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  return [local(first), local(second)];
};
const mount = () =>
  render(
    <BatchComposer
      accounts={accounts}
      userId="user"
      disabled={false}
      onBusy={vi.fn()}
      onComplete={vi.fn().mockResolvedValue(undefined)}
    />,
  );
beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue({ success: true });
  mocks.upload.mockReset().mockResolvedValue([]);
  mocks.toast.mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("individual batch controls", () => {
  it("keeps custom dates attached to each post when reordering and submits the exact details", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar postagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar postagem" }));
    const [first, second] = dates();
    fireEvent.change(screen.getByLabelText("Data e horário da postagem 1"), {
      target: { value: first },
    });
    fireEvent.change(screen.getByLabelText("Data e horário da postagem 2"), {
      target: { value: second },
    });
    fireEvent.change(screen.getByLabelText("Legenda da postagem 1"), {
      target: { value: "Texto primeiro" },
    });
    fireEvent.change(screen.getByLabelText("Legenda da postagem 2"), {
      target: { value: "Texto segundo" },
    });
    fireEvent.change(screen.getByLabelText("Conta da postagem 2"), {
      target: { value: "second" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mover postagem 2 para cima" }),
    );
    expect(screen.getByLabelText("Data e horário da postagem 1")).toHaveValue(
      second,
    );
    expect(screen.getByLabelText("Legenda da postagem 1")).toHaveValue(
      "Texto segundo",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Limpar e agendar 2 postagens" }),
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      "schedule",
      expect.objectContaining({
        accountId: "second",
        text: "Texto segundo",
        scheduledAt: new Date(second).toISOString(),
      }),
    );
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      "schedule",
      expect.objectContaining({
        accountId: "first",
        text: "Texto primeiro",
        scheduledAt: new Date(first).toISOString(),
      }),
    );
  });
  it("supports grouped photos, replacement and removal within a post", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar postagem" }));
    const a = new File(["a"], "a.jpg", { type: "image/jpeg" });
    const b = new File(["b"], "b.png", { type: "image/png" });
    const c = new File(["c"], "replacement.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Adicionar arquivos à postagem 1"), {
      target: { files: [a, b] },
    });
    expect(screen.getAllByRole("img")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Trocar arquivo 1 da postagem 1"), {
      target: { files: [c] },
    });
    expect(
      screen.getByRole("img", { name: "replacement.jpg" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remover arquivo 2 da postagem 1" }),
    );
    expect(screen.getAllByRole("img")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicar postagem 1" }),
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(
      within(screen.getByRole("article", { name: "Postagem 2" })).getByRole(
        "img",
        { name: "replacement.jpg" },
      ),
    ).toBeInTheDocument();
  });
});
