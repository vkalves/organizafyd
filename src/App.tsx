import { AccountApprovalGate } from "@/features/administration/AccountApprovalGate";
import { InteractionFeedback } from "@/components/common/InteractionFeedback";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { WelcomeAnimation } from "@/components/common/WelcomeAnimation";
import { integrationReturnPath } from "@/lib/integration-return";
import { LegacyWorkspaceRedirect } from "@/components/common/LegacyWorkspaceRedirect";

const PublicInfo = lazy(() => import("./pages/PublicInfo"));
const InstagramConnect = lazy(() => import("./pages/InstagramConnect"));
const Agonia = lazy(() => import("./pages/Agonia"));
const AutomationIntegration = lazy(() => import("./pages/AutomationIntegration"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AppLoading() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="animate-pulse text-muted-foreground">Carregando...</div></div>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/auth" replace state={{ returnTo: integrationReturnPath(location.pathname + location.search) }} />;
  return <AccountApprovalGate><AppLayout>{children}</AppLayout></AccountApprovalGate>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <WelcomeAnimation />
          <Suspense fallback={<AppLoading />}>
            <Routes>
              {["/sobre", "/privacidade", "/termos", "/exclusao-de-dados", "/contato"].map(path => <Route key={path} path={path} element={<PublicInfo />} />)}
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/instagram/conectar" element={<InstagramConnect />} />
              <Route path="/" element={<Navigate to="/avanca" replace />} />
              <Route path="/avanca" element={<ProtectedRoute><Agonia /></ProtectedRoute>} />
              <Route path="/avanca/integracao" element={<ProtectedRoute><AutomationIntegration /></ProtectedRoute>} />
              <Route path="/avanca/stories-link" element={<Navigate to="/avanca/stories" replace />} />
              <Route path="/avanca/:section" element={<ProtectedRoute><Agonia /></ProtectedRoute>} />
              <Route path="/agonia/*" element={<LegacyWorkspaceRedirect />} />
              <Route path="/dispara/*" element={<LegacyWorkspaceRedirect />} />
              <Route path="/disparo/*" element={<LegacyWorkspaceRedirect />} />
              {["/tarefas", "/notas", "/slides", "/mapas", "/config", "/instagram", "/instagram/*", "/tiktok", "/x"].map(path => (
                <Route key={path} path={path} element={<Navigate to="/avanca" replace />} />
              ))}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <InteractionFeedback />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
