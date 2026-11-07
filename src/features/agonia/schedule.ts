export const TIMEZONES = [
  "America/Sao_Paulo",
  "America/New_York",
  "Europe/Lisbon",
  "UTC",
] as const;

export type AgoniaSettings = {
  timezone: string;
  intervalMinutes: number;
  defaultCaption: string;
};

export const DEFAULT_SETTINGS: AgoniaSettings = {
  timezone: "America/Sao_Paulo",
  intervalMinutes: 5,
  defaultCaption: "",
};

const storageKey = (userId: string) => `agonia:settings:${userId}`;

export function loadSettings(userId: string | undefined): AgoniaSettings {
  if (!userId || typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId)) || "{}");
    return {
      timezone:
        typeof raw.timezone === "string" && isValidTimezone(raw.timezone)
          ? raw.timezone
          : DEFAULT_SETTINGS.timezone,
      intervalMinutes: clampInterval(raw.intervalMinutes),
      defaultCaption:
        typeof raw.defaultCaption === "string"
          ? raw.defaultCaption.slice(0, 2200)
          : "",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(userId: string, settings: AgoniaSettings) {
  localStorage.setItem(
    storageKey(userId),
    JSON.stringify({
      ...settings,
      intervalMinutes: clampInterval(settings.intervalMinutes),
    }),
  );
}

export function clampInterval(value: unknown) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.intervalMinutes;
  // A Meta/o backend exigem pelo menos 3 min entre mídias da mesma conta;
  // para contas diferentes aceitamos 0 (todas no mesmo minuto).
  return Math.min(1440, Math.max(0, n));
}

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function offsetMinutes(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (asUtc - Math.floor(utcMs / 1000) * 1000) / 60000;
}

/** Converte "YYYY-MM-DDTHH:mm" no fuso informado para um ISO UTC. */
export function localToUtcIso(local: string, timeZone: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error("Informe uma data válida.");
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = wall - offsetMinutes(wall, timeZone) * 60000;
  guess = wall - offsetMinutes(guess, timeZone) * 60000;
  return new Date(guess).toISOString();
}

/** Distribui as contas a partir de `startIso`, uma a cada `intervalMinutes`. */
export function buildSchedule(
  accountIds: string[],
  startIso: string,
  intervalMinutes: number,
) {
  const start = Date.parse(startIso);
  const step = clampInterval(intervalMinutes) * 60000;
  return accountIds.map((accountId, index) => ({
    accountId,
    scheduledAt: new Date(start + index * step).toISOString(),
  }));
}
