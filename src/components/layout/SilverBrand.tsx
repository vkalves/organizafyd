export function SilverBrand({ compact = false }: { compact?: boolean }) {
  return <span className={`silver-brand avanca-brand${compact ? " is-compact" : ""}`}>
    <img
      src={compact ? "/branding/avanca-simbolo-claro.svg" : "/branding/avanca-horizontal-claro.svg"}
      alt={compact ? "" : "AVANÇA"}
      width={compact ? 106 : 460}
      height={154}
    />
  </span>;
}
