import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { Editor } from "./Editor";
import type { InstagramData } from "./data";
const data = {
  accounts: [{ id: "account-1", username: "bianca" }],
  projects: [],
  labels: [],
  account_labels: [],
  contents: [],
  tasks: [],
  metrics: [],
  history: [],
} as unknown as InstagramData;
afterEach(cleanup);
describe("Instagram editor workflows", () => {
  it("requires the actual publication date before recording publication", async () => {
    const save = vi.fn();
    render(
      <Editor
        request={{
          table: "contents",
          values: {
            account_id: "account-1",
            title: "Reel",
            status: "published",
          },
        }}
        data={data}
        onSave={save}
        onClose={() => {}}
        saving={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe quando",
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("requires a planned date for scheduled content", async () => {
    const save = vi.fn();
    render(
      <Editor
        request={{
          table: "contents",
          values: {
            account_id: "account-1",
            title: "Reel",
            status: "scheduled",
          },
        }}
        data={data}
        onSave={save}
        onClose={() => {}}
        saving={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "data planejada",
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("normalizes handles and leaves notes optional", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <Editor
        request={{
          table: "accounts",
          values: {
            username: "@Bianca.Test",
            name: "Bianca",
            niche: "yes",
            email: "bianca@test.com",
            phone: "11999999999",
            responsible: "Iphone 8 plus",
            category: "Bianca Rossi",
            account_created_on: "2026-01-01",
          },
        }}
        data={data}
        onSave={save}
        onClose={() => {}}
        saving={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "bianca.test",
          name: "Bianca",
          email: "bianca@test.com",
          status: "active",
          notes: null,
        }),
      ),
    );
  });
  it("does not silently discard a form after a server failure", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const close = vi.fn();
    render(
      <Editor
        request={{
          table: "accounts",
          values: {
            username: "bianca",
            niche: "no",
            email: "bianca@test.com",
            phone: "11999999999",
            responsible: "A13",
            category: "Sofia Fen",
            account_created_on: "2026-01-01",
          },
        }}
        data={data}
        onSave={save}
        onClose={close}
        saving={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Seus dados continuam",
    );
    expect(screen.getByLabelText(/@username/)).toHaveValue("bianca");
    expect(close).not.toHaveBeenCalled();
  });
});
