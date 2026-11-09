import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeAnimation } from "./WelcomeAnimation";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Boas-vindas", () => {
  it("aparece ao abrir, fecha automaticamente e não reaparece ao renderizar novamente", () => {
    vi.useFakeTimers();
    const view = render(<WelcomeAnimation />);
    expect(screen.getByRole("status")).toHaveTextContent("Bem-vindo à Organizafy!");
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    view.rerender(<WelcomeAnimation />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("permite fechar antes do prazo", () => {
    render(<WelcomeAnimation />);
    fireEvent.click(screen.getByRole("button", { name: "Fechar boas-vindas" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
