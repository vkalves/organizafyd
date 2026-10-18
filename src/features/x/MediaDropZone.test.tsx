import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MediaDropZone } from "./MediaDropZone";
afterEach(cleanup);
it("keeps the drop highlight across nested targets and clears it on drop", () => {
  const receive = vi.fn();
  render(
    <MediaDropZone label="Mídias" onFiles={receive}>
      <span>Conteúdo</span>
    </MediaDropZone>,
  );
  const zone = screen.getByRole("region", { name: "Mídias" });
  const dataTransfer = {
    types: ["Files"],
    files: [new File(["photo"], "a.jpg", { type: "image/jpeg" })],
    dropEffect: "none",
  };
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.dragEnter(screen.getByText("Conteúdo"), { dataTransfer });
  fireEvent.dragLeave(screen.getByText("Conteúdo"), { dataTransfer });
  expect(zone).toHaveClass("is-dragging");
  fireEvent.dragOver(zone, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe("copy");
  fireEvent.drop(zone, { dataTransfer });
  expect(receive).toHaveBeenCalledWith(dataTransfer.files);
  expect(zone).not.toHaveClass("is-dragging");
});
it("blocks drops while processing and ignores dragged links", () => {
  const receive = vi.fn();
  const { rerender } = render(
    <MediaDropZone label="Mídias" disabled onFiles={receive}>
      Conteúdo
    </MediaDropZone>,
  );
  const zone = screen.getByRole("region", { name: "Mídias" });
  const dataTransfer = {
    types: ["Files"],
    files: [new File(["x"], "a.jpg")],
    dropEffect: "copy",
  };
  fireEvent.dragOver(zone, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe("none");
  fireEvent.drop(zone, { dataTransfer });
  expect(receive).not.toHaveBeenCalled();
  rerender(
    <MediaDropZone label="Mídias" onFiles={receive}>
      Conteúdo
    </MediaDropZone>,
  );
  fireEvent.drop(zone, {
    dataTransfer: { types: ["text/uri-list"], files: [] },
  });
  expect(receive).not.toHaveBeenCalled();
});
