import { describe, expect, it, vi } from "vitest";
import { openBrowserLogin } from "./browser-login";
function setup(mobile: boolean, blocked = false) {
  const popup = {
    closed: false,
    location: { href: "about:blank" },
    close: vi.fn(),
    opener: {},
  };
  const browser = {
    matchMedia: vi.fn(() => ({ matches: mobile })),
    open: vi.fn(() => (blocked ? null : popup)),
    location: { assign: vi.fn() },
    screenX: 10,
    screenY: 10,
    outerWidth: 1280,
    outerHeight: 900,
  };
  return {
    popup,
    browser,
    env: browser as unknown as Parameters<typeof openBrowserLogin>[1],
  };
}
describe("Browser Instagram authorization", () => {
  it("keeps phone/tablet authorization in the originating tab without creating a popup", async () => {
    const { browser, env } = setup(true);
    await expect(
      openBrowserLogin(
        async () => "https://example.test/instagram/conectar#invite=test",
        env,
      ),
    ).resolves.toBe("same-tab");
    expect(browser.open).not.toHaveBeenCalled();
    expect(browser.location.assign).toHaveBeenCalledWith(
      "https://example.test/instagram/conectar#invite=test",
    );
  });
  it("reserves a desktop popup before the asynchronous request completes and severs its opener", async () => {
    const { browser, env, popup } = setup(false);
    let ready!: (url: string) => void;
    const pending = openBrowserLogin(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
      env,
    );
    expect(browser.open).toHaveBeenCalledWith(
      "about:blank",
      "instagram_oauth",
      expect.any(String),
    );
    expect(popup.opener).toBeNull();
    ready("https://example.test/invite");
    await expect(pending).resolves.toBe("popup");
    expect(popup.location.href).toBe("https://example.test/invite");
    expect(browser.location.assign).not.toHaveBeenCalled();
  });
  it("continues in the same tab if a desktop popup is blocked or closed during the request", async () => {
    for (const blocked of [true, false]) {
      const { browser, env, popup } = setup(false, blocked);
      await expect(
        openBrowserLogin(async () => {
          popup.closed = true;
          return "https://example.test/invite";
        }, env),
      ).resolves.toBe("same-tab");
      expect(browser.location.assign).toHaveBeenCalledWith(
        "https://example.test/invite",
      );
    }
  });
  it("does not navigate or leave a blank desktop popup behind when invitation creation fails", async () => {
    for (const mobile of [false, true]) {
      const { browser, env, popup } = setup(mobile);
      await expect(
        openBrowserLogin(async () => {
          throw new Error("offline");
        }, env),
      ).rejects.toThrow("offline");
      expect(browser.location.assign).not.toHaveBeenCalled();
      expect(popup.location.href).toBe("about:blank");
      expect(popup.close).toHaveBeenCalledTimes(mobile ? 0 : 1);
    }
  });
});
