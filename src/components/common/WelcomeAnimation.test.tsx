import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeAnimation } from "./WelcomeAnimation";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Boas-vindas DISPARO", () => {
  it("exibe a apresentação, fecha automaticamente e não repete durante a navegação", () => {
    vi.useFakeTimers();
    const view = render(<WelcomeAnimation />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Bem-vindo ao DISPARO");
    act(() => vi.advanceTimersByTime(5500));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<WelcomeAnimation />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("permite pular imediatamente", () => {
    render(<WelcomeAnimation />);
    fireEvent.click(screen.getByRole("button", { name: "Pular apresentação" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("abre a plataforma pelo botão principal", () => {
    render(<WelcomeAnimation />);
    fireEvent.click(screen.getByRole("button", { name: "Entrar no DISPARO" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("permite fechar pelo teclado", () => {
    render(<WelcomeAnimation />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
