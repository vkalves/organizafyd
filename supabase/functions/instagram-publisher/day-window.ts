export function dayWindow(timezone: string, now = Date.now()) {
  if (typeof timezone !== "string" || timezone.length > 100) throw new Error("invalid_timezone");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch { throw new Error("invalid_timezone"); }
  const key = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    return ["year", "month", "day"].map(type => parts.find(p => p.type === type)!.value).join("-");
  };
  const today = key(now);
  const utc = Date.parse(`${today}T00:00:00Z`);
  const tomorrow = new Date(utc + 86_400_000).toISOString().slice(0, 10);
  // Find actual local midnights, including days shortened or extended by DST.
  const boundary = (date: string, center: number) => {
    let low = center - 2 * 86_400_000;
    let high = center + 2 * 86_400_000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (key(mid) < date) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return { start: boundary(today, utc), end: boundary(tomorrow, utc + 86_400_000) };
}
