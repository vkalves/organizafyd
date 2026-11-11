import { describe, expect, it, vi } from "vitest";
import { instagramAuthorizeUrl, instagramGrant } from "../../../supabase/functions/instagram-login/instagram";
const config = { appId: "123456", secret: "private-secret" };
const callback = "https://example.com/callback";
describe("Instagram Login", () => {
 it("opens the official Instagram endpoint with business scopes and CSRF state, without Config ID or secret", () => {
  const url = new URL(instagramAuthorizeUrl(config, callback, "csrf-state"));
  expect(url.origin).toBe("https://www.instagram.com");
  expect(url.searchParams.get("scope")).toContain("instagram_business_content_publish");
  expect(url.searchParams.get("state")).toBe("csrf-state");
  expect(url.searchParams.get("redirect_uri")).toBe(callback);
  expect(url.searchParams.has("config_id")).toBe(false);
  expect(url.href).not.toContain(config.secret);
 });
 it("exchanges the code server-side, obtains a long-lived token, verifies the professional profile and publication access", async () => {
  const json = vi.fn().mockResolvedValueOnce({ data: [{ access_token: "short", permissions: "instagram_business_basic,instagram_business_content_publish" }] }).mockResolvedValueOnce({ access_token: "long", expires_in: 5184000 })
   .mockResolvedValueOnce({ user_id: "123456789", username: "professional", account_type: "BUSINESS" }).mockResolvedValueOnce({ data: [] });
  const grant = await instagramGrant(config, callback, "code", json);
  expect(json.mock.calls[0][0]).toBe("https://api.instagram.com/oauth/access_token");
  const form = json.mock.calls[0][1].body as URLSearchParams;
  expect(form.get("client_secret")).toBe(config.secret);expect(form.get("redirect_uri")).toBe(callback);
  expect(json.mock.calls[1][0]).toContain("ig_exchange_token");
  expect(json.mock.calls[3][0]).toContain("content_publishing_limit");
  expect(grant.accounts).toEqual([{ id: "123456789", username: "professional" }]);
  expect(grant.provider).toBe("instagram");expect(grant.token).toBe("long");
 });
 it("rejects missing publication permissions before saving a connection", async () => {
  const json = vi.fn().mockResolvedValue({ access_token: "short", permissions: ["instagram_business_basic"] });
  await expect(instagramGrant(config, callback, "code", json)).rejects.toThrow("missing_permission");
  expect(json).toHaveBeenCalledTimes(1);
 });
 it("rejects failed exchanges and personal accounts", async () => {
  await expect(instagramGrant(config, callback, "code", vi.fn().mockResolvedValue({}))).rejects.toThrow("meta_authorization_failed");
  const json = vi.fn().mockResolvedValueOnce({ access_token: "short" }).mockResolvedValueOnce({ access_token: "long", expires_in: 60 })
    .mockResolvedValueOnce({ user_id: "123456789", username: "personal", account_type: "PERSONAL" });
  await expect(instagramGrant(config, callback, "code", json)).rejects.toThrow("professional_required");
 });
});
