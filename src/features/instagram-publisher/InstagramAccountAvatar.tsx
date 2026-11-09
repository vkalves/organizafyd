import { useState } from "react";
export function InstagramAccountAvatar({ username, name, url }: { username: string; name?: string; url?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  let safeUrl: string | null = null;
  try {
    const parsed = new URL(url || "");
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) safeUrl = parsed.href;
  } catch { /* Use initials for missing or invalid images. */ }
  return <span className="ig-account-avatar">
    {safeUrl && failedUrl !== safeUrl ? (
      <img src={safeUrl} alt={`Foto de perfil de @${username}`} width={38} height={38} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(safeUrl)} />
    ) : <span aria-hidden="true">{(name?.trim() || username).slice(0, 2).toUpperCase()}</span>}
  </span>;
}
