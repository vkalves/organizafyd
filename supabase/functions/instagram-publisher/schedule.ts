const SLOT = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseSlots(slots: string[]) {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 24)
    throw new Error("invalid_slots");
  const minutes = slots.map((slot) => {
    if (typeof slot !== "string") throw new Error("invalid_slots");
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
  if (
    typeof timeZone !== "string" ||
    timeZone.length > 80 ||
    !/^[A-Za-z_][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(timeZone)
  )
    return false;
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

function slotAtOrAfter(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
  cursor: number,
) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const first = zonedTimeToUtc(year, month, day, hour, minute, timeZone);
  if (first === null || first >= cursor) return first;

  // If the date contains a backward clock change shortly after this slot,
  // the same wall-clock time may occur a second time.
  const firstWall = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = firstWall - first;
  const sample = first + 3 * 60 * 60 * 1000;
  const sampleParts = zonedParts(sample, timeZone);
  const sampleWall = Date.UTC(
    sampleParts.year,
    sampleParts.month - 1,
    sampleParts.day,
    sampleParts.hour,
    sampleParts.minute,
    sampleParts.second,
  );
  const sampleOffset = sampleWall - sample;
  const repeatedBy = firstOffset - sampleOffset;
  if (repeatedBy <= 0) return null;

  const second = first + repeatedBy;
  const parts = zonedParts(second, timeZone);
  return parts.year === year &&
    parts.month === month &&
    parts.day === day &&
    parts.hour === hour &&
    parts.minute === minute &&
    second >= cursor
    ? second
    : null;
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
    // The queue applies a three-minute confirmed-publication floor. Add that
    // floor to the planned cursor as well so a short rest cannot select a slot
    // which the worker will have to skip.
    if (crossed > previous) cursor += restMs + 2 * 60_000;
    let found: number | null = null;
    const cursorParts = zonedParts(cursor, timeZone);
    let year = cursorParts.year,
      month = cursorParts.month,
      day = cursorParts.day;
    for (let step = 0; step < 800 && found === null; step++) {
      for (const minutes of slotMinutes) {
        const at = slotAtOrAfter(year, month, day, minutes, timeZone, cursor);
        if (at !== null) {
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
