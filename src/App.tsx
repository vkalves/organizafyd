import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { AppErrorBoundary } from "@/components/common/AppErrorBoundary";
import { lazy, Suspense } from "react";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Instagram = lazy(() => import("./pages/Instagram"));
const Funis = lazy(() => import("./pages/Funis"));
const Tarefas = lazy(() => import("./pages/Tarefas"));
const Financeiro = lazy(() => import("./pages/Financeiro"));
const Notas = lazy(() => import("./pages/Notas"));
const LinksPage = lazy(() => import("./pages/LinksPage"));
const Config = lazy(() => import("./pages/Config"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="Carregando página">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        Carregando…
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  return <AppLayout>{children}</AppLayout>;
}

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner richColors position="top-right" />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<FullPageLoader />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/instagram" element={<ProtectedRoute><Instagram /></ProtectedRoute>} />
                <Route path="/funis" element={<ProtectedRoute><Funis /></ProtectedRoute>} />
                <Route path="/tarefas" element={<ProtectedRoute><Tarefas /></ProtectedRoute>} />
                <Route path="/financeiro" element={<ProtectedRoute><Financeiro /></ProtectedRoute>} />
                <Route path="/notas" element={<ProtectedRoute><Notas /></ProtectedRoute>} />
                <Route path="/links" element={<ProtectedRoute><LinksPage /></ProtectedRoute>} />
                <Route path="/config" element={<ProtectedRoute><Config /></ProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
