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
