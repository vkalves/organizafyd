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
  dailyLimit?: number;
  maxRetries?: number;
  pauseOnRepeatedFailures?: boolean;
};

export const DEFAULT_SETTINGS: AgoniaSettings = {
  timezone: "America/Sao_Paulo",
  intervalMinutes: 5,
  defaultCaption: "",
  dailyLimit: 0,
  maxRetries: 3,
  pauseOnRepeatedFailures: true,
};

export type MetaAppConfig = {
  id: string;
  name: string;
  appId: string;
  active: boolean;
  createdAt: string;
};

export type AccountMetaMap = Record<
  string,
  {
    modelName?: string;
    metaAppId?: string;
    lastCheckedAt?: string;
  }
>;

export type AgoniaProfile = {
  username: string;
  avatarDataUrl: string;
};

export type WorkspaceMode = "agonia" | "classic";

const storageKey = (userId: string) => `agonia:settings:${userId}`;
const appsKey = (userId: string) => `agonia:meta-apps:${userId}`;
const accountMetaKey = (userId: string) => `agonia:account-meta:${userId}`;
const profileKey = (userId: string) => `agonia:profile:${userId}`;
const WORKSPACE_MODE_KEY = "organizafy:workspace-mode";

export function getWorkspaceMode(): WorkspaceMode {
  if (typeof localStorage === "undefined") return "classic";
  try {
    return localStorage.getItem(WORKSPACE_MODE_KEY) === "agonia"
      ? "agonia"
      : "classic";
  } catch {
    return "classic";
  }
}

export function setWorkspaceMode(mode: WorkspaceMode) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(WORKSPACE_MODE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent("organizafy-mode-changed", { detail: mode }),
    );
  } catch {
    /* ignore storage quota errors */
  }
}

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
      dailyLimit:
        typeof raw.dailyLimit === "number" && Number.isFinite(raw.dailyLimit)
          ? Math.max(0, Math.min(10000, Math.round(raw.dailyLimit)))
          : 0,
      maxRetries:
        typeof raw.maxRetries === "number" && Number.isFinite(raw.maxRetries)
          ? Math.max(1, Math.min(5, Math.round(raw.maxRetries)))
          : 3,
      pauseOnRepeatedFailures:
        typeof raw.pauseOnRepeatedFailures === "boolean"
          ? raw.pauseOnRepeatedFailures
          : true,
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

const DEFAULT_META_APPS: MetaAppConfig[] = [
  {
    id: "app-default-1",
    name: "App Principal 01",
    appId: "1096552783081849",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function loadMetaApps(userId: string | undefined): MetaAppConfig[] {
  if (!userId || typeof localStorage === "undefined") return DEFAULT_META_APPS;
  try {
    const raw = JSON.parse(localStorage.getItem(appsKey(userId)) || "null");
    if (!Array.isArray(raw) || !raw.length) return DEFAULT_META_APPS;
    return raw.filter(
      (item): item is MetaAppConfig =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.appId === "string",
    );
  } catch {
    return DEFAULT_META_APPS;
  }
}

export function saveMetaApps(userId: string, apps: MetaAppConfig[]) {
  localStorage.setItem(appsKey(userId), JSON.stringify(apps));
}

export function loadAccountMeta(userId: string | undefined): AccountMetaMap {
  if (!userId || typeof localStorage === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(accountMetaKey(userId)) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function saveAccountMeta(userId: string, meta: AccountMetaMap) {
  localStorage.setItem(accountMetaKey(userId), JSON.stringify(meta));
}

export function loadAgoniaProfile(
  userId: string | undefined,
  fallbackName: string,
): AgoniaProfile {
  if (!userId || typeof localStorage === "undefined") {
    return { username: fallbackName, avatarDataUrl: "" };
  }
  try {
    const raw = JSON.parse(localStorage.getItem(profileKey(userId)) || "{}");
    return {
      username:
        typeof raw.username === "string" && raw.username.trim()
          ? raw.username.trim().slice(0, 80)
          : fallbackName,
      avatarDataUrl:
        typeof raw.avatarDataUrl === "string" ? raw.avatarDataUrl : "",
    };
  } catch {
    return { username: fallbackName, avatarDataUrl: "" };
  }
}

export function saveAgoniaProfile(userId: string, profile: AgoniaProfile) {
  localStorage.setItem(profileKey(userId), JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent("agonia-profile-updated"));
}

export function parseCaptionVariants(
  primaryCaption: string,
  variantsRaw: string,
): string[] {
  const blocks = variantsRaw
    .split(/^\s*---\s*$/m)
    .map((item) => item.trim())
    .filter(Boolean);
  const base = primaryCaption.trim();
  if (!blocks.length) return [base];
  return base ? [base, ...blocks] : blocks;
}

export function clampInterval(value: unknown) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.intervalMinutes;
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
