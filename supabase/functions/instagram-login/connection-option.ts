export function selectConnectionApp<T extends { id: string; active: boolean }>(
  apps: T[], requested: unknown, platformReady: boolean,
) {
  // Only an explicit null requests the platform. Older clients may send an empty string.
  if (requested === null) {
    if (!platformReady) throw new Error("not_configured");
    return null;
  }
  if (requested !== undefined && typeof requested !== "string") throw new Error("app_not_found");
  if (requested) {
    const app = apps.find(app => app.id === requested && app.active);
    if (!app) throw new Error("app_not_found");
    return app;
  }
  const app = apps.find(app => app.active);
  if (app) return app;
  if (platformReady) return null;
  throw new Error("not_configured");
}
