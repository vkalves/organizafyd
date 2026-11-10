import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeAnimation } from "./WelcomeAnimation";

afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, "", "/"); });

describe("Boas-vindas AVANÇA", () => {
  it("não cobre o convite nem o retorno da autorização com a apresentação", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/instagram/conectar#code=fake-code&state=fake-state");
    render(<WelcomeAnimation />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("exibe a apresentação, fecha automaticamente e não repete durante a navegação", () => {
    vi.useFakeTimers();
    const view = render(<WelcomeAnimation />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Bem-vindo à Avança");
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<WelcomeAnimation />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("permite pular imediatamente", () => {
    render(<WelcomeAnimation />);
    fireEvent.click(screen.getByRole("button", { name: "Pular apresentação" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("permite fechar pelo teclado", () => {
    render(<WelcomeAnimation />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
