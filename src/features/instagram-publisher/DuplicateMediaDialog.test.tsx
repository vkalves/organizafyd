import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ scan: vi.fn(), remove: vi.fn() }));
vi.mock("./duplicate-media", () => ({ scanDuplicateMedia: mocks.scan }));
vi.mock("./flows-api", () => ({ deleteMedia: mocks.remove }));
import { DuplicateMediaDialog } from "./DuplicateMediaDialog";
beforeEach(() => {
  vi.clearAllMocks(); mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.scan.mockResolvedValue({ total: 4, groups: 1, protected: 1, failures: [], duplicates: [{ id: "b", url: "storage://user/b.jpg", kind: "posts", folder: "Viagens", caption: "Praia" }, { id: "c", url: "storage://user/c.jpg", kind: "stories", folder: "", caption: "" }] });
});
describe("duplicate cleanup dialog", () => {
  it("requires analysis and explicit deletion, reports failures and refreshes only removed IDs", async () => {
    mocks.remove.mockRejectedValueOnce(new Error("Esta mídia passou a ser usada em um fluxo."));
    const onDeleted = vi.fn();
    render(<DuplicateMediaDialog userId="user" onClose={vi.fn()} onDeleted={onDeleted} />);
    expect(screen.queryByRole("button", { name: /Excluir/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analisar biblioteca" }));
    const remove = await screen.findByRole("button", { name: "Excluir 2 cópia(s) repetida(s)" });
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await screen.findByText("1 arquivo(s) repetido(s) removido(s).");
    expect(mocks.remove).toHaveBeenCalledWith("b", "storage://user/b.jpg", "user");
    expect(onDeleted).toHaveBeenCalledWith(["c"]);
    expect(screen.getByRole("alert")).toHaveTextContent("passou a ser usada em um fluxo");
  });
  it("does not offer deletion when there are no safe duplicates", async () => {
    mocks.scan.mockResolvedValue({ total: 2, groups: 1, protected: 1, duplicates: [], failures: [] });
    render(<DuplicateMediaDialog userId="user" onClose={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Analisar biblioteca" }));
    await waitFor(() => expect(screen.getByText(/0 cópia\(s\) repetida\(s\) podem/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Excluir/ })).not.toBeInTheDocument();
  });
});
