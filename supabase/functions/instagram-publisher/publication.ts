type Graph = (path: string, params: Record<string, string>, post?: boolean) => Promise<{ id?: string; status_code?: string }>;

// Publishing may succeed even if its response is lost. Confirm using the same
// container; never issue a second media_publish request after an ambiguous result.
export async function publishContainer(graph: Graph, account: string, container: string) {
  try {
    const result = await graph(`${account}/media_publish`, { creation_id: container }, true);
    if (!result.id) throw new Error("missing_publication_id");
    return { mediaId: result.id };
  } catch (error) {
    try {
      const state = await graph(container, { fields: "status_code" });
      if (state.status_code === "PUBLISHED") return { mediaId: null };
    } catch { /* Preserve the original failure if confirmation is unavailable. */ }
    throw error;
  }
}
