export type MetaApp = {
  id: string; name: string; appId: string; configId: string; active: boolean;
  createdAt: string; secretConfigured: boolean; accountCount: number;
};
export type MetaConfig = { ready: boolean; callback: string; apps: MetaApp[] };
