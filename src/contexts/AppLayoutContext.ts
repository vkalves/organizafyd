import { createContext, useContext } from "react";

export interface AppLayoutContextValue {
  setMobileFocusMode: (active: boolean) => void;
}

export const AppLayoutContext = createContext<AppLayoutContextValue | null>(null);

export function useAppLayout() {
  const context = useContext(AppLayoutContext);
  if (!context) throw new Error("useAppLayout must be used inside AppLayout");
  return context;
}
