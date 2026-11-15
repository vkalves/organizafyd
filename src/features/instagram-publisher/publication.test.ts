import { describe, it, expect, vi } from "vitest";
import { publishContainer } from "../../../supabase/functions/instagram-publisher/publication";

describe("publication confirmation", () => {
  it("retains the publication ID on success", async () => {
    const graph = vi.fn().mockResolvedValue({ id: "media" });
    expect(await publishContainer(graph, "account", "container")).toEqual({ mediaId: "media" });
    expect(graph).toHaveBeenCalledTimes(1);
  });
  it("confirms a lost response without publishing twice", async () => {
    const graph = vi.fn().mockRejectedValueOnce(new Error("network_error"))
      .mockResolvedValueOnce({ status_code: "PUBLISHED" });
    expect(await publishContainer(graph, "account", "container")).toEqual({ mediaId: null });
    expect(graph.mock.calls).toEqual([
      ["account/media_publish", { creation_id: "container" }, true],
      ["container", { fields: "status_code" }],
    ]);
  });
  it.each(["FINISHED", "IN_PROGRESS", "ERROR"])("keeps %s uncertain after a lost response", async (status_code) => {
    const graph = vi.fn().mockRejectedValueOnce(new Error("network_error")).mockResolvedValueOnce({ status_code });
    await expect(publishContainer(graph, "account", "container")).rejects.toThrow("network_error");
    expect(graph).toHaveBeenCalledTimes(2);
  });
  it("preserves the failure when confirmation also fails", async () => {
    const graph = vi.fn().mockRejectedValueOnce(new Error("network_error")).mockRejectedValueOnce(new Error("meta_500"));
    await expect(publishContainer(graph, "account", "container")).rejects.toThrow("network_error");
  });
});
