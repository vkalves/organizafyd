const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const invalid = () => new Error("invalid_media_delivery");
async function key(secret: string) {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function validPath(path: string) {
  return /^[0-9a-f-]{36}\/[a-zA-Z0-9/_-]+\.(mp4|jpe?g)$/i.test(path) && !path.includes("//");
}
// Each job receives its own short-lived capability. Never expose a service key
// or accept arbitrary upstream URLs in this public media endpoint.
export async function campaignMediaUrl(value: string, job: string, base: string, secret: string, now = Date.now()) {
  if (!value.startsWith("storage://") || !validPath(value.slice(10))) throw invalid();
  const path = value.slice(10), expires = String(Math.floor(now / 1000) + 3600);
  const signature = hex(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(JSON.stringify([path, job, expires]))));
  const url = new URL(`${base}/functions/v1/instagram-media`);
  url.search = new URLSearchParams({ path, job, expires, signature }).toString();
  return url.toString();
}
export async function verifyMediaUrl(url: URL, secret: string, now = Date.now()) {
  const path = url.searchParams.get("path") || "", job = url.searchParams.get("job") || "";
  const expires = url.searchParams.get("expires") || "", signature = url.searchParams.get("signature") || "";
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (!validPath(path) || !/^[0-9a-f-]{36}$/i.test(job) || !/^\d+$/.test(expires) || remaining <= 0 || remaining > 3600 || !/^[0-9a-f]{64}$/.test(signature)) throw invalid();
  const bytes = Uint8Array.from(signature.match(/../g)!, pair => parseInt(pair, 16));
  if (!await crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(JSON.stringify([path, job, expires])))) throw invalid();
  return path;
}
