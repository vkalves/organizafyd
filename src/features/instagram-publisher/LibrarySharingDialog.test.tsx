import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), importMedia: vi.fn(), importAll: vi.fn() }));
vi.mock("./api", () => ({ publisherRequest: mocks.request }));
vi.mock("./library-sharing-api", () => ({ importSharedMedia: mocks.importMedia }));
vi.mock("./library-sharing-batch", () => ({ importSharedLibrary: mocks.importAll }));
import { LibrarySharingDialog } from "./LibrarySharingDialog";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.importMedia.mockResolvedValue(undefined);
  mocks.request.mockImplementation(async (action) => {
    if (action === "library_identity") return { handle: "maria" };
    if (action === "library_shares") return { outgoing: [{ recipient_id: "recipient", recipient: { handle: "joao" } }], incoming: [{ owner_id: "owner", owner: { handle: "ana" } }] };
    if (action === "library_browse") return [{ id: "media", kind: "posts", folder: "Viagens", caption: "Praia" }];
    return { ok: true };
  });
});
function show() {
  const changed = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LibrarySharingDialog userId="me" onClose={vi.fn()} onChanged={changed} /></QueryClientProvider>);
  return changed;
}
describe("library sharing dialog", () => {
  it("imports the entire selected library and displays partial failures", async () => {
    mocks.importAll.mockImplementation(async (_owner, _user, options) => {
      options.onImported("media");
      options.onProgress({ completed: 2, total: 2 });
      return { imported: 1, skipped: 0, failures: [{ id: "failed", message: "Limite de armazenamento atingido." }] };
    });
    const changed = show();
    await screen.findByRole("option", { name: "@ana" });
    fireEvent.change(screen.getByLabelText("Bibliotecas compartilhadas comigo"), { target: { value: "owner" } });
    await screen.findByRole("button", { name: "Importar" });
    fireEvent.click(screen.getByRole("button", { name: "Importar todas as mídias" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(mocks.importAll).toHaveBeenCalledWith("owner", "me", expect.objectContaining({ alreadyImported: [] }));
    expect(screen.getByRole("alert")).toHaveTextContent("1 mídia(s) não foram importadas.");
    expect(screen.getByRole("button", { name: "Importada" })).toBeDisabled();
  });
  it("grants access by @ and revokes the selected recipient", async () => {
    show();
    await screen.findByText("@joao");
    fireEvent.change(screen.getByLabelText("Compartilhar toda a minha biblioteca com"), { target: { value: "@pedro" } });
    fireEvent.click(screen.getByRole("button", { name: "Liberar acesso" }));
    await screen.findByText("Biblioteca compartilhada.");
    expect(mocks.request).toHaveBeenCalledWith("library_grant", { handle: "@pedro" });
    fireEvent.click(screen.getByRole("button", { name: "Retirar acesso" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("library_revoke", { recipient_id: "recipient" }));
  });
  it("imports shared media and refreshes the user's library", async () => {
    const changed = show();
    await screen.findByRole("option", { name: "@ana" });
    fireEvent.change(screen.getByLabelText("Bibliotecas compartilhadas comigo"), { target: { value: "owner" } });
    fireEvent.click(await screen.findByRole("button", { name: "Importar" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(mocks.importMedia).toHaveBeenCalledWith("owner", "media", "me");
    expect(screen.getByRole("button", { name: "Importada" })).toBeDisabled();
  });
  it("shows import failures without marking media as copied", async () => {
    mocks.importMedia.mockRejectedValue(new Error("Limite de armazenamento atingido."));
    const changed = show();
    await screen.findByRole("option", { name: "@ana" });
    fireEvent.change(screen.getByLabelText("Bibliotecas compartilhadas comigo"), { target: { value: "owner" } });
    fireEvent.click(await screen.findByRole("button", { name: "Importar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Limite de armazenamento atingido.");
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Importar" })).toBeEnabled();
  });
});
