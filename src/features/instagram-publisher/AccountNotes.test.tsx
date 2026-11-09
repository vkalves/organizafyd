import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AccountNotes } from "./AccountNotes";
function Editor({
  save,
  initial = "",
}: {
  save: (value: string) => Promise<void>;
  initial?: string;
}) {
  const [value, change] = useState(initial);
  const [saved, setSaved] = useState(initial);
  return (
    <AccountNotes
      username="perfil"
      value={value}
      savedValue={saved}
      onChange={change}
      onSave={async (text) => {
        await save(text);
        setSaved(text);
      }}
    />
  );
}
describe("Account notepad", () => {
  it("saves multiline notes and can clear an existing note", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Editor save={save} initial="Conta antiga" />);
    const field = screen.getByRole("textbox", { name: "Anotações de @perfil" });
    expect(
      screen.getByRole("button", { name: "Salvar anotações" }),
    ).toBeDisabled();
    fireEvent.change(field, {
      target: { value: "Próxima: @reserva\nConectar na sexta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar anotações" }));
    await screen.findByText("Anotações salvas");
    expect(save).toHaveBeenLastCalledWith(
      "Próxima: @reserva\nConectar na sexta",
    );
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar anotações" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(""));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Salvar anotações" }),
      ).toBeDisabled(),
    );
  });
  it("preserves the text when saving fails and allows retry", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<Editor save={save} />);
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "@futura_conta" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar anotações" }));
    await screen.findByRole("alert");
    expect(field).toHaveValue("@futura_conta");
    expect(screen.queryByText("Anotações salvas")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar anotações" }));
    await screen.findByText("Anotações salvas");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps newer edits unsaved when an earlier save finishes", async () => {
    let finish!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Editor save={save} />);
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "@primeira" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar anotações" }));
    expect(
      screen.getByRole("button", { name: "Salvar anotações" }),
    ).toBeDisabled();
    fireEvent.change(field, { target: { value: "@segunda" } });
    finish();
    await screen.findByText("Alterações não salvas");
    expect(field).toHaveValue("@segunda");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("@primeira");
  });
});
