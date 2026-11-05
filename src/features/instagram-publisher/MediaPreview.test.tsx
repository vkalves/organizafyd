import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
const signed = vi.hoisted(() => vi.fn());
vi.mock("./flows-api", () => ({ previewMedia: signed }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}));
import { MediaPreview } from "./MediaPreview";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function show(url: string) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MediaPreview url={url} />
    </QueryClientProvider>,
  );
}
describe("Selected media preview", () => {
  it("resolves private videos into signed playback sources", async () => {
    signed.mockResolvedValue(
      "https://storage.example/video.mp4?token=temporary",
    );
    const view = show("storage://owner/video.mp4");
    await waitFor(() =>
      expect(view.container.querySelector("video")).toHaveAttribute(
        "src",
        "https://storage.example/video.mp4?token=temporary",
      ),
    );
    expect(signed).toHaveBeenCalledWith("storage://owner/video.mp4");
    expect(view.container.querySelector("video")).toHaveAttribute("controls");
  });
  it("shows remote images and recovers visibly from playback errors", async () => {
    show("https://example.com/photo.jpg");
    const image = await screen.findByAltText("Mídia selecionada");
    fireEvent.error(image);
    expect(screen.getByText(/Prévia indisponível/)).toBeInTheDocument();
    expect(signed).not.toHaveBeenCalled();
  });
});
