// Shared exact-origin policy for the AVANÇA connection and integration APIs.
const DEFAULT_SITE = "https://www.organizafy.site";
const KNOWN_ORIGINS = [
  DEFAULT_SITE,
  "https://organizafy.site",
  "https://organizafyd.vercel.app",
  "https://xn--avana-1ra.online",
  "https://www.xn--avana-1ra.online",
  "https://avanca.online",
  "https://www.avanca.online",
  "https://zyon-control-studio.adventurouswarbler3.chatgpt.site",
];
function exactOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.port || !/^[a-z0-9.-]+$/i.test(url.hostname)) throw new Error();
    return url.origin;
  } catch {
    throw new Error("invalid_integration_origin");
  }
}
/** Server configuration only. Never use a request parameter as a redirect origin. */
export function connectionSiteOrigin(configured?: string): string {
  return configured?.trim() ? exactOrigin(configured.trim()) : DEFAULT_SITE;
}
export function integrationOrigins(extra?: string, site = DEFAULT_SITE): Set<string> {
  const values = extra?.split(",").map(value => value.trim()).filter(Boolean) || [];
  if (values.length > 20) throw new Error("invalid_integration_origin");
  return new Set([...KNOWN_ORIGINS, exactOrigin(site), ...values.map(exactOrigin)]);
}
