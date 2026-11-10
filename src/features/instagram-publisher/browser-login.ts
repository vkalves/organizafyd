type Browser = Pick<
  Window,
  | "open"
  | "location"
  | "matchMedia"
  | "screenX"
  | "screenY"
  | "outerWidth"
  | "outerHeight"
>;

/** Keep mobile authorization in its originating tab. Reserve desktop popups on the click gesture. */
export async function openBrowserLogin(
  createInvite: () => Promise<string>,
  browser: Browser = window,
): Promise<"same-tab" | "popup"> {
  const sameTab = browser.matchMedia(
    "(max-width: 767px), (pointer: coarse)",
  ).matches;
  let popup: Window | null = null;
  if (!sameTab) {
    const width = 600,
      height = 750;
    const left =
      browser.screenX + Math.max(0, (browser.outerWidth - width) / 2);
    const top =
      browser.screenY + Math.max(0, (browser.outerHeight - height) / 2);
    popup = browser.open(
      "about:blank",
      "instagram_oauth",
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,status=yes`,
    );
    if (popup) popup.opener = null;
  }
  try {
    const url = await createInvite();
    if (popup && !popup.closed) {
      popup.location.href = url;
      return "popup";
    }
    browser.location.assign(url);
    return "same-tab";
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    throw error;
  }
}
