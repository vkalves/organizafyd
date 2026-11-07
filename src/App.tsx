import { BackgroundMusic } from "@/components/audio/BackgroundMusic";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";

const TikTokPublisher = lazy(() => import("./pages/TikTokPublisher"));
const PublicInfo = lazy(() => import("./pages/PublicInfo"));

const XPublisher = lazy(() => import("./pages/XPublisher"));
const InstagramConnect = lazy(() => import("./pages/InstagramConnect"));
const InstagramPublisher = lazy(() => import("./pages/InstagramPublisher"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Agonia = lazy(() => import("./pages/Agonia"));
const Tarefas = lazy(() => import("./pages/Tarefas"));
const Notas = lazy(() => import("./pages/Notas"));
const Slides = lazy(() => import("./pages/Slides"));
const MapasMentais = lazy(() => import("./pages/MapasMentais"));
const Config = lazy(() => import("./pages/Config"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AppLoading() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="animate-pulse text-muted-foreground">Carregando...</div></div>;
}

function ProtectedRoute({ children, standalone = false }: { children: React.ReactNode; standalone?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to={standalone ? `/auth?next=${location.pathname.startsWith("/tiktok") ? "tiktok" : "x"}${location.hash}` : "/auth"} replace />;
  return standalone ? <>{children}</> : <AppLayout>{children}</AppLayout>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<AppLoading />}>
            <Routes>
              {["/sobre", "/privacidade", "/termos", "/exclusao-de-dados", "/contato"].map(path => <Route key={path} path={path} element={<PublicInfo />} />)}
              <Route path="/tiktok" element={<ProtectedRoute standalone><TikTokPublisher /></ProtectedRoute>} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/tarefas" element={<ProtectedRoute><Tarefas /></ProtectedRoute>} />
              <Route path="/notas" element={<ProtectedRoute><Notas /></ProtectedRoute>} />
              <Route path="/slides" element={<ProtectedRoute><Slides /></ProtectedRoute>} />
              <Route path="/mapas" element={<ProtectedRoute><MapasMentais /></ProtectedRoute>} />
              <Route path="/instagram/conectar" element={<InstagramConnect />} />
              <Route path="/instagram" element={<ProtectedRoute><InstagramPublisher /></ProtectedRoute>} />
              <Route path="/instagram/*" element={<Navigate to="/instagram" replace />} />
              <Route path="/instagram/publicar" element={<ProtectedRoute><InstagramPublisher /></ProtectedRoute>} />
              <Route path="/agonia" element={<ProtectedRoute><Agonia /></ProtectedRoute>} />
              <Route path="/agonia/:section" element={<ProtectedRoute><Agonia /></ProtectedRoute>} />
              <Route path="/x" element={<ProtectedRoute standalone><XPublisher /></ProtectedRoute>} />
              <Route path="/config" element={<ProtectedRoute><Config /></ProtectedRoute>} />
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
