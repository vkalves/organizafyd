export function selectConnectionApp<T extends { id: string; active: boolean }>(
  apps: T[], requested: unknown, platformReady: boolean,
) {
  if (requested != null && typeof requested !== "string") throw new Error("app_not_found");
  if (requested) {
    const app = apps.find(app => app.id === requested && app.active);
    if (!app) throw new Error("app_not_found");
    return app;
  }
  if (platformReady) return null;
  const app = apps.find(app => app.active);
  if (!app) throw new Error("not_configured");
  return app;
}
