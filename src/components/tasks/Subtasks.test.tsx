import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Subtasks, type Subtask } from "./Subtasks";

afterEach(cleanup);

function Harness() {
  const [items, setItems] = useState<Subtask[]>([{ id: "existing", text: "Pesquisar", done: false }]);
  return <Subtasks items={items} onChange={next => { setItems(next); return true; }} collapsible />;
}

describe("Subtarefas", () => {
  it("adds, edits, completes and removes subtasks while preserving existing items", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Nova subtarefa"), { target: { value: "  Escrever  " } });
    fireEvent.keyDown(screen.getByLabelText("Nova subtarefa"), { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("Nova subtarefa")).toHaveValue(""));
    expect(screen.getByText("Pesquisar")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Editar subtarefa: Escrever"));
    fireEvent.change(screen.getByLabelText("Editar subtarefa"), { target: { value: "Publicar" } });
    fireEvent.click(screen.getByLabelText("Salvar subtarefa"));
    await waitFor(() => expect(screen.getByText("Publicar")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Concluir subtarefa: Publicar"));
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1"));
    await waitFor(() => expect(screen.getByLabelText("Excluir subtarefa: Publicar")).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Excluir subtarefa: Publicar"));
    await waitFor(() => expect(screen.queryByText("Publicar")).not.toBeInTheDocument());
    expect(screen.getByText("0/1 concluídas")).toBeInTheDocument();
  });

  it("retains the draft after a failed save and prevents simultaneous writes", async () => {
    let finish: (success: boolean) => void;
    const onChange = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<Subtasks items={[]} onChange={onChange} />);
    expect(screen.getByLabelText("Adicionar subtarefa")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nova subtarefa"), { target: { value: "Revisar" } });
    fireEvent.click(screen.getByLabelText("Adicionar subtarefa"));
    expect(screen.getByLabelText("Adicionar subtarefa")).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Nova subtarefa"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    finish!(false);
    await waitFor(() => expect(screen.getByLabelText("Adicionar subtarefa")).toBeEnabled());
    expect(screen.getByLabelText("Nova subtarefa")).toHaveValue("Revisar");
  });
});
