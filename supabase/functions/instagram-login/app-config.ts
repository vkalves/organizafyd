/** Only server-managed app metadata can authorize changes to platform credentials. */
export function canManageMeta(user: { app_metadata?: Record<string, unknown> } | null): boolean {
  return user?.app_metadata?.role === "admin";
}
export function validateAppConfig(body: Record<string, unknown>, configured: boolean) {
  const appId = typeof body.appId === "string" ? body.appId.trim() : "";
  const configId = typeof body.configId === "string" ? body.configId.trim() : "";
  const secret = typeof body.appSecret === "string" ? body.appSecret.trim() : "";
  if (!/^\d{5,40}$/.test(appId) || !/^\d{5,40}$/.test(configId) ||
      (secret && !/^[a-fA-F0-9]{32}$/.test(secret)) || (!secret && !configured)) {
    throw new Error("invalid_app_config");
  }
  return { appId, configId, secret };
}
