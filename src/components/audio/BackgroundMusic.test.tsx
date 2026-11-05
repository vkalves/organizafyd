import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
import { BackgroundMusic } from "./BackgroundMusic";
beforeEach(() => {
  auth.user = null;
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function () {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function () {
    this.dispatchEvent(new Event("pause"));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("Background music", () => {
  it("starts quietly, supports volume and pause, and keeps the same audio after login", async () => {
    const view = render(<BackgroundMusic />);
    const audio = view.container.querySelector("audio")!;
    expect(audio).toHaveAttribute("src", "/audio/hotfy-background.m4a");
    expect(audio.volume).toBe(0.08);
    fireEvent.change(screen.getByLabelText("Volume da música de fundo"), {
      target: { value: "65" },
    });
    expect(audio.volume).toBe(0.65);
    auth.user = { id: "user" };
    view.rerender(<BackgroundMusic />);
    expect(view.container.querySelector("audio")).toBe(audio);
    expect(audio.volume).toBe(0.08);
    fireEvent.click(screen.getByRole("button", { name: "Pausar música" }));
    expect(localStorage.getItem("organizafy-music-enabled")).toBe("off");
    const plays = vi.mocked(audio.play).mock.calls.length;
    fireEvent.pointerDown(window);
    expect(audio.play).toHaveBeenCalledTimes(plays);
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir música" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Pausar música" }),
      ).toBeInTheDocument(),
    );
  });
  it("restores paused and muted preferences and never unmutes during login", () => {
    localStorage.setItem("organizafy-music-enabled", "off");
    localStorage.setItem("organizafy-music-volume", "0");
    const view = render(<BackgroundMusic />);
    const audio = view.container.querySelector("audio")!;
    auth.user = { id: "user" };
    view.rerender(<BackgroundMusic />);
    expect(audio.volume).toBe(0);
    expect(audio.play).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Reproduzir música" }),
    ).toBeInTheDocument();
  });
  it("recovers from browser autoplay restrictions on a gesture", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new Error("NotAllowedError"),
    );
    render(<BackgroundMusic />);
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce(),
    );
    fireEvent.pointerDown(window);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Pausar música" }),
      ).toBeInTheDocument(),
    );
  });
});
