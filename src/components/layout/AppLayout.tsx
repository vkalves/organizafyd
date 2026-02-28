import { 
  LayoutDashboard, GitBranch, CheckSquare, DollarSign, StickyNote, Link2, Settings,
  Search, Plus, User, Menu, ChevronLeft, LogOut
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import logoImg from "@/assets/logo-organify.png";

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Funis", path: "/funis", icon: GitBranch },
  { title: "Tarefas", path: "/tarefas", icon: CheckSquare },
  { title: "Financeiro", path: "/financeiro", icon: DollarSign },
  { title: "Notas", path: "/notas", icon: StickyNote },
  { title: "Links", path: "/links", icon: Link2 },
  { title: "Configurações", path: "/config", icon: Settings },
];

const mobileNavItems = navItems.slice(0, 6);

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const { signOut, user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/90 backdrop-blur-md flex items-center px-4 gap-3">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 rounded-md hover:bg-accent transition-colors">
          <Menu className="w-5 h-5 text-foreground" />
        </button>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden lg:flex p-2 rounded-md hover:bg-accent transition-colors">
          {sidebarOpen ? <ChevronLeft className="w-5 h-5 text-foreground" /> : <Menu className="w-5 h-5 text-foreground" />}
        </button>

        <div className="flex items-center gap-2">
          <img src={logoImg} alt="Organify" className="h-7 w-auto" />
        </div>

        <div className="hidden sm:flex flex-1 max-w-md mx-auto">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Buscar..." className="w-full h-9 pl-9 pr-4 rounded-md bg-secondary border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </div>

        <div className="flex-1 sm:hidden" />

        <button onClick={signOut} className="p-2 rounded-md hover:bg-accent transition-colors" title="Sair">
          <LogOut className="w-4 h-4 text-muted-foreground" />
        </button>
        <button className="p-2 rounded-full bg-secondary hover:bg-accent transition-colors">
          <User className="w-4 h-4 text-foreground" />
        </button>
      </header>

      <div className="flex flex-1 pt-14">
        <aside className={cn(
          "hidden lg:flex flex-col fixed top-14 left-0 bottom-0 bg-sidebar border-r border-sidebar-border transition-all duration-300 z-40",
          sidebarOpen ? "w-56" : "w-16"
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
                  {sidebarOpen && <span>{item.title}</span>}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-40 pt-14" onClick={() => setSidebarOpen(false)}>
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
            <aside className="relative w-64 h-full bg-sidebar border-r border-sidebar-border animate-slide-in-left" onClick={(e) => e.stopPropagation()}>
              <nav className="py-4 px-2 space-y-1">
                {navItems.map((item) => {
                  const isActive = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
                  return (
                    <NavLink key={item.path} to={item.path} onClick={() => setSidebarOpen(false)} className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
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

        <main className={cn("flex-1 min-h-[calc(100vh-3.5rem)] pb-20 lg:pb-0 transition-all duration-300", sidebarOpen ? "lg:ml-56" : "lg:ml-16")}>
          <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">{children}</div>
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16 bg-background/95 backdrop-blur-md border-t border-border flex items-center justify-around px-2">
        {mobileNavItems.map((item) => {
          const isActive = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
          return (
            <NavLink key={item.path} to={item.path} className={cn(
              "flex flex-col items-center gap-1 px-2 py-1 rounded-md transition-colors min-w-0",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}>
              <item.icon className={cn("w-5 h-5", isActive && "stroke-[2.5]")} />
              <span className="text-[10px] font-medium truncate">{item.title}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
