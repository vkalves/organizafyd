import { ChessMark } from "./ChessMark";
export function SilverBrand({ compact = false }: { compact?: boolean }) {
  return <span className={`silver-brand avanca-brand avanca-brand-depth${compact ? " is-compact" : ""}`}>
    <ChessMark />{!compact && <span className="avanca-wordmark">avança</span>}
  </span>;
}
