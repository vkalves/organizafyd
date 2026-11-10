import { afterEach, describe, expect, it, vi } from "vitest";
import { hybridStorage } from "../../../supabase/functions/_shared/hybrid-storage";
import {
  ownsPath,
  uploadAllowed,
  validBucket,
  validPath,
} from "../../../supabase/functions/s3-storage/policy";
const user = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
describe("AWS storage ownership and limits", () => {
  it("rejects unknown buckets, traversal and other owners", () => {
    expect(validBucket("__proto__")).toBe(false);
    expect(validBucket("x-media")).toBe(true);
    for (
      const path of [
        `${user}/../secret`,
        `${user}/./secret`,
        `${user}//secret`,
        `${user}/bad\\file`,
        `${user}/bad\nfile`,
        "/file",
      ]
    ) expect(validPath(path)).toBe(false);
    expect(validPath(`${user}/slides/board/file.jpg`)).toBe(true);
    expect(ownsPath(user, `${user}extra/file.jpg`)).toBe(false);
  });
  it("preserves private-bucket media type and size restrictions", () => {
    expect(uploadAllowed("instagram-publisher", "image/jpeg", 100)).toBe(true);
    expect(uploadAllowed("instagram-publisher", "text/html", 100)).toBe(false);
    expect(uploadAllowed("tiktok-media", "image/jpeg", 4194305)).toBe(false);
    expect(uploadAllowed("x-media", "image/jpeg", 0)).toBe(false);
  });
});
describe("hybrid storage compatibility", () => {
  function client(invoke = vi.fn()) {
    return { storage: { from: vi.fn() }, functions: { invoke } };
  }
  it("keeps the original SDK while the feature is disabled", () => {
    const c = client();
    expect(hybridStorage(c, "https://project.supabase.co", false)).toBe(
      c.storage,
    );
  });
  it("keeps stored object paths and only returns an authorized signed URL", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://signed.example" },
      error: null,
    });
    const storage = hybridStorage(
      client(invoke),
      "https://project.supabase.co",
    );
    expect(
      (await storage.from("instagram-publisher").createSignedUrl(
        `${user}/photo.jpg`,
        600,
      )).data.signedUrl,
    ).toBe("https://signed.example");
    expect(invoke).toHaveBeenCalledWith("s3-storage", {
      body: {
        action: "signed",
        bucket: "instagram-publisher",
        path: `${user}/photo.jpg`,
        expiresIn: 600,
      },
    });
  });
  it("sends the file directly to the signed S3 destination after authorization", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        url: "https://bucket.s3.us-east-2.amazonaws.com",
        fields: { key: "media/file", policy: "signed" },
      },
      error: null,
    });
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetcher);
    const result = await hybridStorage(
      client(invoke),
      "https://project.supabase.co",
    ).from("media").upload(
      `${user}/file.jpg`,
      new Blob(["test"], { type: "image/jpeg" }),
    );
    expect(result.error).toBe(null);
    expect(invoke.mock.calls[0][1].body.size).toBe(4);
    expect(fetcher.mock.calls[0][1].body).toBeInstanceOf(FormData);
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  });
  it("never uploads or falls back silently when authorization fails", async () => {
    const c = client(
      vi.fn().mockResolvedValue({
        data: null,
        error: {
          context: { status: 403, json: async () => ({ error: "forbidden" }) },
        },
      }),
    );
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await hybridStorage(c, "").from("media").upload(
      `${user}/file.jpg`,
      new Blob(["x"]),
    );
    expect(result.error.statusCode).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    expect(c.storage.from).not.toHaveBeenCalled();
  });
  it("keeps duplicate status codes so interrupted TikTok submissions remain idempotent", async () => {
    const invoke = vi.fn().mockResolvedValue({
      error: {
        context: {
          json: async () => ({
            error: "The resource already exists",
            statusCode: "409",
          }),
        },
      },
    });
    const result = await hybridStorage(client(invoke), "").from("tiktok-media")
      .upload(`${user}/file.jpg`, new Blob(["x"]));
    expect(result.error.statusCode).toBe("409");
  });
  it("uses an encoded public gateway URL for existing public media", () => {
    const url =
      hybridStorage(client(), "https://project.supabase.co/").from("media")
        .getPublicUrl(`${user}/a & b.jpg`).data.publicUrl;
    expect(new URL(url).searchParams.get("path")).toBe(`${user}/a & b.jpg`);
  });
});
