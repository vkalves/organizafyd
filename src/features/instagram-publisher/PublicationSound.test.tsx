import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  unlock: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("./sound", () => ({
  playConfirmation: mocks.play,
  unlockAudio: mocks.unlock,
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toast } }));
import { PublicationSound } from "./PublicationSound";
import type { Post } from "./model";
const post = (status: Post["status"]) => ({ id: "p", status }) as Post;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});
describe("Confirmação sonora de publicação", () => {
  it("não toca para o histórico carregado inicialmente", () => {
    render(<PublicationSound posts={[post("published")]} userId="u" />);
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it("toca uma vez ao passar de pendente para publicado", () => {
    const view = render(
      <PublicationSound posts={[post("scheduled")]} userId="u" />,
    );
    view.rerender(<PublicationSound posts={[post("published")]} userId="u" />);
    view.rerender(<PublicationSound posts={[post("published")]} userId="u" />);
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect(mocks.play).toHaveBeenCalledWith("published");
  });
  it("não confirma falhas ou resultados incertos", () => {
    const view = render(
      <PublicationSound posts={[post("scheduled")]} userId="u" />,
    );
    view.rerender(<PublicationSound posts={[post("failed")]} userId="u" />);
    view.rerender(<PublicationSound posts={[post("uncertain")]} userId="u" />);
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it("respeita o silêncio e reinicia o histórico ao trocar usuário", () => {
    vi.stubGlobal("localStorage", { getItem: () => "off", setItem: vi.fn() });
    const view = render(
      <PublicationSound posts={[post("scheduled")]} userId="u" />,
    );
    view.rerender(<PublicationSound posts={[post("published")]} userId="u" />);
    view.rerender(<PublicationSound posts={[post("published")]} userId="v" />);
    expect(mocks.play).not.toHaveBeenCalled();
  });
});
