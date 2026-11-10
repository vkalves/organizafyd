import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const remove = vi.hoisted(() => vi.fn());
vi.mock("./account-api", () => ({ disconnectAccount: remove }));
import { RemoveInstagramAccount } from "./RemoveInstagramAccount";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const account = { id: "account", username: "alfa" };
it("requires confirmation and cancellation never removes the account", () => {
  render(<RemoveInstagramAccount account={account} onRemoved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Remover conta" }));
  expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Remover @alfa da Avança?");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); expect(remove).not.toHaveBeenCalled();
});
it("updates the list only after server confirmation", async () => {
  remove.mockResolvedValue({}); const updated = vi.fn(async () => {});
  render(<RemoveInstagramAccount account={account} onRemoved={updated} />);
  fireEvent.click(screen.getByRole("button", { name: "Remover conta" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Remover conta" }).at(-1)!);
  await waitFor(() => expect(updated).toHaveBeenCalledWith("account")); expect(remove).toHaveBeenCalledTimes(1);
});
it("keeps the dialog and account intact when removal is rejected", async () => {
  remove.mockRejectedValue(new Error("Há uma publicação em andamento.")); const updated = vi.fn();
  render(<RemoveInstagramAccount account={account} onRemoved={updated} />);
  fireEvent.click(screen.getByRole("button", { name: "Remover conta" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Remover conta" }).at(-1)!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Há uma publicação em andamento."); expect(updated).not.toHaveBeenCalled(); expect(screen.getByRole("alertdialog")).toBeInTheDocument();
});
