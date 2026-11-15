// TypeScript / integration-return.ts / browser / bounded companion sign-in handoff
export function integrationReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 200) return "/avanca";
  try {
    const url = new URL(value, "https://local.invalid");
    if (!value.startsWith("/") || value.startsWith("//") || url.origin !== "https://local.invalid" || url.pathname !== "/avanca/integracao" || url.hash) return "/avanca";
    const username = (url.searchParams.get("expected_username") || "").trim().replace(/^@/, "").toLowerCase();
    return "/avanca/integracao" + (/^[a-z0-9._]{1,30}$/.test(username) ? `?expected_username=${encodeURIComponent(username)}` : "");
  } catch { return "/avanca"; }
}
