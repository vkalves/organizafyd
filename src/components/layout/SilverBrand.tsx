export function SilverBrand({ compact = false }: { compact?: boolean }) {
  return <span className={`silver-brand dispara-brand${compact ? " is-compact" : ""}`}>
    <img
      src={compact ? "/branding/dispara-simbolo-cromo.svg" : "/branding/dispara-horizontal-cromo.svg"}
      alt={compact ? "" : "DISPARA"}
      width={compact ? 36 : 144}
      height={36}
    />
  </span>;
}
