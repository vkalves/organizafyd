const SLOT = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseSlots(slots: string[]) {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 24)
    throw new Error("invalid_slots");
  const minutes = slots.map((slot) => {
    const match = SLOT.exec(slot);
    if (!match) throw new Error("invalid_slots");
    return Number(match[1]) * 60 + Number(match[2]);
  });
  const unique = [...new Set(minutes)].sort((a, b) => a - b);
  if (unique.length !== slots.length) throw new Error("invalid_slots");
  for (let i = 0; i < unique.length; i++) {
    const next = i + 1 < unique.length ? unique[i + 1] : unique[0] + 1440;
    if (next - unique[i] < 3) throw new Error("invalid_slots");
  }
  return unique;
}

export function isValidTimeZone(timeZone: string) {
  if (typeof timeZone !== "string" || timeZone.length > 80) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  const hour = get("hour") === 24 ? 0 : get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Retorna null se esse relógio não existe nesse dia (buraco de horário de verão). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 4; i++) {
    const parts = zonedParts(utc, timeZone);
    const delta =
      Date.UTC(year, month - 1, day, hour, minute) -
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      );
    if (delta === 0) return utc;
    utc += delta;
  }
  const parts = zonedParts(utc, timeZone);
  return parts.year === year &&
    parts.month === month &&
    parts.day === day &&
    parts.hour === hour &&
    parts.minute === minute
    ? utc
    : null;
}

function nextDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function slotInstants(
  count: number,
  fromMs: number,
  slotMinutes: number[],
  timeZone: string,
  options: { offset?: number; batch?: number; restMs?: number } = {},
) {
  const offset = options.offset ?? 0;
  const batch = options.batch || 500;
  const restMs = options.restMs ?? 0;
  const times: number[] = [];
  let cursor = fromMs;
  let guard = 0;
  while (times.length < count) {
    if (++guard > count + 4000) throw new Error("invalid_schedule");
    const index = times.length;
    const crossed =
      Math.floor((offset + index) / batch) - Math.floor(offset / batch);
    const previous =
      index === 0
        ? 0
        : Math.floor((offset + index - 1) / batch) - Math.floor(offset / batch);
    if (crossed > previous) cursor += restMs;
    let found: number | null = null;
    let cursorParts = zonedParts(cursor, timeZone);
    let year = cursorParts.year,
      month = cursorParts.month,
      day = cursorParts.day;
    for (let step = 0; step < 800 && found === null; step++) {
      for (const minutes of slotMinutes) {
        const at = zonedTimeToUtc(
          year,
          month,
          day,
          Math.floor(minutes / 60),
          minutes % 60,
          timeZone,
        );
        if (at !== null && at >= cursor) {
          found = at;
          break;
        }
      }
      const next = nextDay(year, month, day);
      year = next.year;
      month = next.month;
      day = next.day;
    }
    if (found === null) throw new Error("invalid_schedule");
    times.push(found);
    cursor = found + 60_000;
  }
  return times;
}
