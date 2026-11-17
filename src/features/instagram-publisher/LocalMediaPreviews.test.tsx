import { render, screen, cleanup } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { LocalMediaPreviews } from "./LocalMediaPreviews";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows chosen files immediately and releases local URLs on replacement and unmount", () => {
  const create = vi.fn().mockReturnValueOnce("blob:video").mockReturnValueOnce("blob:image");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const view = render(<LocalMediaPreviews files={[new File(["video"], "reel.mp4", { type: "video/mp4" })]} />);
  expect(screen.getByLabelText("Prévia de reel.mp4")).toHaveAttribute("src", "blob:video");
  expect(screen.getByLabelText("Prévia de reel.mp4")).toHaveAttribute("controls");
  view.rerender(<LocalMediaPreviews files={[new File(["photo"], "foto.png", { type: "image/png" })]} />);
  expect(screen.getByAltText("Prévia de foto.png")).toHaveAttribute("src", "blob:image");
  expect(revoke).toHaveBeenCalledWith("blob:video");
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:image");
});

it("keeps a remaining preview URL stable as earlier files finish and bounds a large batch", () => {
  let count = 0;
  const create = vi.fn(() => `blob:${++count}`), revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const files = Array.from({ length: 100 }, (_, index) => new File(["video"], `reel-${index}.mp4`, { type: "video/mp4" }));
  const view = render(<LocalMediaPreviews files={files} />);
  expect(view.container.querySelectorAll("video")).toHaveLength(8);
  expect(create).toHaveBeenCalledTimes(8);
  view.rerender(<LocalMediaPreviews files={files.slice(1)} />);
  expect(create).toHaveBeenCalledTimes(9);
  expect(screen.getByLabelText("Prévia de reel-1.mp4")).toHaveAttribute("src", "blob:2");
  expect(revoke).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(revoke).toHaveBeenCalledTimes(9);
});
