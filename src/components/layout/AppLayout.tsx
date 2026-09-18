import { 
  LayoutDashboard, CheckSquare, StickyNote, Settings, FolderTree,
  Search, User, Menu, ChevronLeft, LogOut
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayoutContext } from "@/contexts/AppLayoutContext";
import logoImg from "@/assets/logo-organify.png";

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Tarefas", path: "/tarefas", icon: CheckSquare },
  { title: "Notas", path: "/notas", icon: StickyNote },
  { title: "Estruturas", path: "/estruturas", icon: FolderTree },
  { title: "Configurações", path: "/config", icon: Settings },
];

const mobileNavItems = navItems;

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFocusMode, setMobileFocusMode] = useState(false);
  const location = useLocation();
  const { signOut } = useAuth();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  const layoutContext = useMemo(() => ({ setMobileFocusMode }), []);

  return (
    <AppLayoutContext.Provider value={layoutContext}>
    <div className="min-h-[100dvh] min-w-0 bg-background">
      <header className={cn(
        "app-header fixed inset-x-0 top-0 z-50 flex items-center gap-2 border-b border-border bg-background/90 backdrop-blur-md sm:gap-3",
        mobileFocusMode && "max-lg:hidden",
      )}>
        <button
          type="button"
          aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent lg:hidden"
        >
          <Menu className="h-5 w-5 text-foreground" />
        </button>
        <button
          type="button"
          aria-label={desktopSidebarOpen ? "Recolher menu lateral" : "Expandir menu lateral"}
          onClick={() => setDesktopSidebarOpen((open) => !open)}
          className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent lg:flex"
        >
          {desktopSidebarOpen ? <ChevronLeft className="h-5 w-5 text-foreground" /> : <Menu className="h-5 w-5 text-foreground" />}
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <img src={logoImg} alt="Organizafy" className="h-7 max-w-[8.5rem] object-contain object-left sm:max-w-none" />
        </div>

        <div className="hidden sm:flex flex-1 max-w-md mx-auto">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Buscar..." className="w-full h-9 pl-9 pr-4 rounded-md bg-secondary border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </div>

        <div className="min-w-0 flex-1 sm:hidden" />

        <button type="button" onClick={signOut} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent" title="Sair" aria-label="Sair da conta">
          <LogOut className="h-4 w-4 text-muted-foreground" />
        </button>
        <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary transition-colors hover:bg-accent" aria-label="Perfil">
          <User className="h-4 w-4 text-foreground" />
        </button>
      </header>

      <div className={cn("app-body flex min-h-[100dvh] min-w-0", mobileFocusMode && "app-body-focus")}>
        <aside className={cn(
          "app-desktop-sidebar fixed bottom-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 lg:flex",
          desktopSidebarOpen ? "w-56" : "w-16"
        )}>
          <nav className="flex-1 py-4 px-2 space-y-1">
            {navItems.map((item) => {
              const isActive = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
              return (
                <NavLink key={item.path} to={item.path} className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-200",
                  isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}>
                  <item.icon className="w-5 h-5 shrink-0" />
                  {desktopSidebarOpen && <span>{item.title}</span>}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {mobileMenuOpen && (
          <div className="app-mobile-drawer fixed inset-x-0 bottom-0 z-40 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
            <aside className="relative h-full w-[min(18rem,86vw)] border-r border-sidebar-border bg-sidebar animate-slide-in-left" onClick={(e) => e.stopPropagation()} aria-label="Menu principal">
              <nav className="py-4 px-2 space-y-1">
                {navItems.map((item) => {
                  const isActive = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
                  return (
                    <NavLink key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)} className={cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                      isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}>
                      <item.icon className="w-5 h-5 shrink-0" />
                      <span>{item.title}</span>
                    </NavLink>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}

        <main className={cn(
          "app-main min-w-0 flex-1 overflow-x-clip transition-[margin] duration-300",
          desktopSidebarOpen ? "lg:ml-56" : "lg:ml-16",
          mobileFocusMode && "app-main-focus",
        )}>
          <div className={cn(
            "app-page-frame min-w-0 animate-fade-in p-4 sm:p-6 lg:p-8",
            mobileFocusMode && "app-page-frame-focus",
          )}>{children}</div>
        </main>
      </div>

      <nav className={cn(
        "mobile-bottom-nav fixed inset-x-0 bottom-0 z-50 flex items-start justify-around border-t border-border bg-background/95 px-2 pt-1.5 backdrop-blur-md lg:hidden",
        mobileFocusMode && "hidden",
      )} aria-label="Navegação principal">
        {mobileNavItems.map((item) => {
          const isActive = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
          return (
            <NavLink key={item.path} to={item.path} className={cn(
              "flex min-w-0 flex-1 touch-manipulation flex-col items-center gap-1 rounded-md px-1 py-1 transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}>
              <item.icon className={cn("h-5 w-5 shrink-0", isActive && "stroke-[2.5]")} />
              <span className="w-full truncate text-center text-[10px] font-medium">{item.title}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
    </AppLayoutContext.Provider>
  );
}
