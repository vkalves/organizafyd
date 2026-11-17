import { describe, it, expect } from "vitest";
import { publicationWait } from "./publication-wait";
import type { Post } from "./model";
const post = { status: "scheduled", scheduled_at: new Date(0).toISOString() } as Post;
describe("actionable publication waiting states", () => {
  it("explains a paused flow instead of claiming it is ready", () => {
    expect(publicationWait(post, { state: "paused", last_error: null })).toMatch(/Fluxo pausado/);
  });
  it("directs expired connections to reconnect before resuming a flow", () => {
    expect(publicationWait(post, { state: "paused" }, { account_id: "a", paused: false, reconnect_required: true })).toMatch(/Reconecte/);
  });
  it("distinguishes an overdue queue, video processing, quota, and ambiguous publication", () => {
    expect(publicationWait(post)).toMatch(/intervalo da conta/);
    expect(publicationWait({ ...post, status: "processing" })).toMatch(/Preparando mídia/);
    expect(publicationWait({ ...post, error_code: "publishing_quota_wait" })).toMatch(/Limite temporário/);
    expect(publicationWait({ ...post, status: "uncertain" })).toMatch(/Não reenvie/);
  });
});
