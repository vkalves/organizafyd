export function SilverBrand({ compact = false }: { compact?: boolean }) {
  return <span className="silver-brand">
    <img src="/branding/dispara-simbolo-cromo.svg" alt="" width="36" height="36" />
    {!compact && <span>DISPARO</span>}
  </span>;
}
