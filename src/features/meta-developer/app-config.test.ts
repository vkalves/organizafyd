import { describe, expect, it } from "vitest";
import { canManageMeta, validateAppConfig } from "../../../supabase/functions/instagram-login/app-config";
describe("Meta configuration authorization", () => {
  it("denies public users and trusts only server-managed admin metadata", () => {
    expect(canManageMeta(null)).toBe(false);
    expect(canManageMeta({})).toBe(false);
    expect(canManageMeta({ app_metadata: { role: "user" } })).toBe(false);
    expect(canManageMeta({ app_metadata: { role: "admin" } })).toBe(true);
  });
  it("requires a valid secret for first setup and permits preserving an existing one", () => {
    const input = { appId: "123456", configId: "654321", appSecret: "" };
    expect(() => validateAppConfig(input, false)).toThrow("invalid_app_config");
    expect(validateAppConfig(input, true).secret).toBe("");
    expect(() => validateAppConfig({ ...input, appSecret: "bad" }, true)).toThrow();
    expect(() => validateAppConfig({ ...input, appId: "abc" }, true)).toThrow();
  });
});
