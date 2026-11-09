import { Navigate, useLocation } from "react-router-dom";

/** Keep existing bookmarks, OAuth returns and external integrations working. */
export function LegacyWorkspaceRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/agonia(?=\/|$)/, "/disparo")}${search}${hash}`} replace />;
}
