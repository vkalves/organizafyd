const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://csaplfphtvufxjhbpstl.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_0jOQSggJs6BwyZKy0hFCJw_uyjFC3p9";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
}

function publicFileUrl(storagePath) {
  const base = String(SUPABASE_URL).replace(/\/$/, "");
  return `${base}/storage/v1/object/public/media/${storagePath}`;
}

function isVideo(mime) {
  return String(mime).startsWith("video/");
}

function renderItem(item) {
  const url = publicFileUrl(item.storage_path);
  const name = escapeHtml(item.name || "arquivo");
  const safeUrl = escapeHtml(url);
  const media = isVideo(item.mime_type)
    ? `<video src="${safeUrl}" controls playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;background:#000"></video>`
    : `<img src="${safeUrl}" alt="${name}" style="width:100%;height:100%;object-fit:cover">`;
  return `\n    <article class="file">\n      <div class="thumb">${media}</div>\n      <p class="name">${name}</p>\n      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Abrir</a>\n    </article>`;
}

function renderCard(title, items) {
  const list = Array.isArray(items) ? items : [];
  const body = list.length
    ? `<div class="grid">${list.map(renderItem).join("")}</div>`
    : `<p class="empty">Nenhum arquivo</p>`;
  return `<section class="card"><h2>${title}</h2>${body}</section>`;
}

export default async function handler(req, res) {
  try {
    const token = String(req.query.token || "").replace(/[^a-zA-Z0-9]/g, "");
    if (!token) {
      res.status(400).send("Link inválido ou indisponível.");
      return;
    }

    const response = await fetch(`${String(SUPABASE_URL).replace(/\/$/, "")}/rest/v1/rpc/get_public_media`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: token }),
    });

    const payload = await response.json().catch(() => []);
    const rows = Array.isArray(payload) ? payload : [];
    const referencias = rows.filter((row) => row && row.card === "referencias");
    const originais = rows.filter((row) => row && row.card === "original");

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Referências e Original</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, system-ui, sans-serif; background:#0b0b0b; color:#fff; }
    header { border-bottom:1px solid #292929; padding:16px 24px; font-weight:700; letter-spacing:.04em; }
    main { max-width:72rem; margin:0 auto; padding:24px; }
    h1 { font-size:1.5rem; margin:0; }
    .sub { color:#888; font-size:.875rem; margin:8px 0 24px; }
    .cards { display:grid; grid-template-columns:1fr; gap:16px; }
    @media (min-width:1024px) { .cards { grid-template-columns:1fr 1fr; } }
    .card { background:#111; border:1px solid #292929; border-radius:10px; padding:20px; }
    h2 { font-size:.875rem; margin:0 0 16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    @media (min-width:640px) { .grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
    .file { border:1px solid #292929; background:#1a1a1a; border-radius:8px; overflow:hidden; }
    .thumb { aspect-ratio:1; background:#1a1a1a; }
    .name { margin:0; padding:6px 8px 0; font-size:11px; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    a { display:inline-flex; margin:6px 8px 8px; font-size:11px; color:#fff; }
    .empty { color:#888; font-size:.875rem; text-align:center; padding:40px 0; }
  </style>
</head>
<body>
  <header>ORGANIZAFY</header>
  <main>
    <h1>Referências e Original</h1>
    <p class="sub">Somente visualização</p>
    <div class="cards">
      ${renderCard("Referências", referencias)}
      ${renderCard("Original", originais)}
    </div>
  </main>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=30");
    res.status(200).send(html);
  } catch (error) {
    res.status(500).send("Link inválido ou indisponível.");
  }
}
