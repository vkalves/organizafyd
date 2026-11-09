import { BackgroundMusic } from "@/components/audio/BackgroundMusic";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { WelcomeAnimation } from "@/components/common/WelcomeAnimation";

const PublicInfo = lazy(() => import("./pages/PublicInfo"));
const InstagramConnect = lazy(() => import("./pages/InstagramConnect"));
const Agonia = lazy(() => import("./pages/Agonia"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AppLoading() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="animate-pulse text-muted-foreground">Carregando...</div></div>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/auth" replace />;
  return <AppLayout>{children}</AppLayout>;
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
              <Route path="/" element={<Navigate to="/agonia" replace />} />
              <Route path="/agonia" element={<ProtectedRoute><Agonia /></ProtectedRoute>} />
              <Route path="/agonia/:section" element={<ProtectedRoute><Agonia /></ProtectedRoute>} />
              {["/tarefas", "/notas", "/slides", "/mapas", "/config", "/instagram", "/instagram/*", "/tiktok", "/x"].map(path => (
                <Route key={path} path={path} element={<Navigate to="/agonia" replace />} />
              ))}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <BackgroundMusic />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
