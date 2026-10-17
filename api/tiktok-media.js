// Public image delivery on the app's verified domain. Never accepts a remote URL.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD"].includes(req.method)) return res.status(405).end();
  const path = typeof req.query.path === "string" ? req.query.path : "";
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|webp)$/.test(path))
    return res.status(400).end();
  const base = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!base) return res.status(503).end();
  try {
    const upstream = await fetch(
      `${base.replace(/\/$/, "")}/storage/v1/object/public/tiktok-media/${path}`,
      { redirect: "error", signal: AbortSignal.timeout(15000) },
    );
    if (!upstream.ok) return res.status(404).end();
    const type = upstream.headers.get("content-type")?.split(";")[0];
    if (!["image/jpeg", "image/webp"].includes(type))
      return res.status(415).end();
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > 4194304) return res.status(413).end();
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(bytes.byteLength));
    return req.method === "HEAD"
      ? res.status(200).end()
      : res.status(200).send(Buffer.from(bytes));
  } catch {
    return res.status(502).end();
  }
}
