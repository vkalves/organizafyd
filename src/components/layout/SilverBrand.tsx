export function SilverBrand({ compact = false }: { compact?: boolean }) {
  return <span className="silver-brand">
    <img src="/hotfy/h-192.png" alt="" width="36" height="36" />
    {!compact && <span>Organiza<span className="silver-text">fy</span></span>}
  </span>;
}
