import {
  CheckSquare,
  ChevronLeft,
  DollarSign,
  GitBranch,
  Instagram,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  MoreHorizontal,
  Search,
  Settings,
  StickyNote,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import logoImg from "@/assets/logo-organify.png";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard, shortcut: "D" },
  { title: "Instagram", path: "/instagram", icon: Instagram, shortcut: "I" },
  { title: "Funis", path: "/funis", icon: GitBranch, shortcut: "F" },
  { title: "Tarefas", path: "/tarefas", icon: CheckSquare, shortcut: "T" },
  { title: "Financeiro", path: "/financeiro", icon: DollarSign, shortcut: "$" },
  { title: "Notas", path: "/notas", icon: StickyNote, shortcut: "N" },
  { title: "Links", path: "/links", icon: Link2, shortcut: "L" },
  { title: "Configurações", path: "/config", icon: Settings, shortcut: "," },
] as const;

const mobileNavItems = navItems.filter((item) => ["/", "/tarefas", "/instagram", "/financeiro"].includes(item.path));

function isRouteActive(currentPath: string, itemPath: string) {
  return itemPath === "/" ? currentPath === "/" : currentPath.startsWith(itemPath);
}

function NavigationItems({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const location = useLocation();

  return (
    <nav className="space-y-1" aria-label="Navegação principal">
      {navItems.map((item) => {
        const active = isRouteActive(location.pathname, item.path);
        return (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            title={compact ? item.title : undefined}
            className={cn(
              "group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              compact && "justify-center px-2",
            )}
          >
            <item.icon className={cn("h-[18px] w-[18px] shrink-0", active && "stroke-[2.4]")} />
            {!compact && <span className="truncate font-medium">{item.title}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("organizafy:sidebar") === "collapsed");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();

  const displayName = useMemo(() => {
    const metadataName = user?.user_metadata?.display_name;
    if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
    return user?.email?.split("@")[0] || "Usuário";
  }, [user]);
  const initials = displayName.slice(0, 2).toLocaleUpperCase("pt-BR");

  useEffect(() => {
    localStorage.setItem("organizafy:sidebar", sidebarCollapsed ? "collapsed" : "expanded");
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const goTo = (path: string) => {
    setCommandOpen(false);
    navigate(path);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#conteudo-principal" className="skip-link">Pular para o conteúdo</a>

      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3 border-b border-border/80 bg-background/90 px-3 backdrop-blur-xl sm:px-5">
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setMobileMenuOpen(true)}
          className="icon-button lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          onClick={() => setSidebarCollapsed((current) => !current)}
          className="icon-button hidden lg:inline-flex"
        >
          {sidebarCollapsed ? <Menu className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>

        <Link to="/" aria-label="Ir para o dashboard" className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <img src={logoImg} alt="Organizafy" className="h-7 w-auto sm:h-8" />
        </Link>

        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="mx-auto flex h-10 w-full max-w-xl items-center gap-2 rounded-xl border border-border bg-secondary/70 px-3 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Buscar ferramenta ou navegar…</span>
          <kbd className="ml-auto hidden rounded-md border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground sm:inline">Ctrl K</kbd>
        </button>

        <Link
          to="/config"
          title={displayName}
          aria-label="Abrir configurações do perfil"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initials || <User className="h-4 w-4" />}
        </Link>
        <button type="button" onClick={() => void signOut()} className="icon-button shrink-0" title="Sair" aria-label="Sair da conta">
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      <aside className={cn(
        "fixed bottom-0 left-0 top-16 z-30 hidden border-r border-sidebar-border bg-sidebar px-2 py-4 transition-[width] duration-200 lg:block",
        sidebarCollapsed ? "w-[72px]" : "w-60",
      )}>
        <NavigationItems compact={sidebarCollapsed} />
      </aside>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[min(86vw,320px)] border-sidebar-border bg-sidebar p-3 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menu principal</SheetTitle>
          <Link to="/" onClick={() => setMobileMenuOpen(false)} className="mb-6 inline-flex px-2 pt-2">
            <img src={logoImg} alt="Organizafy" className="h-8 w-auto" />
          </Link>
          <NavigationItems onNavigate={() => setMobileMenuOpen(false)} />
          <div className="mt-6 border-t border-sidebar-border pt-4">
            <p className="truncate px-3 text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </SheetContent>
      </Sheet>

      <main
        id="conteudo-principal"
        className={cn(
          "min-h-screen px-4 pb-24 pt-24 transition-[margin] duration-200 sm:px-6 lg:pb-10 lg:pt-24",
          sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-60",
        )}
      >
        <div key={location.pathname} className="animate-fade-in">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[72px] grid-cols-5 border-t border-border/80 bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Navegação rápida">
        {mobileNavItems.map((item) => {
          const active = isRouteActive(location.pathname, item.path);
          return (
            <NavLink key={item.path} to={item.path} className={cn("flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium", active ? "text-foreground" : "text-muted-foreground")}>
              <item.icon className={cn("h-5 w-5", active && "stroke-[2.6]")} />
              <span className="truncate">{item.title}</span>
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setMobileMenuOpen(true)} className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium text-muted-foreground">
          <MoreHorizontal className="h-5 w-5" />
          <span>Mais</span>
        </button>
      </nav>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Digite o nome de uma ferramenta…" />
        <CommandList>
          <CommandEmpty>Nenhuma ferramenta encontrada.</CommandEmpty>
          <CommandGroup heading="Navegar">
            {navItems.map((item) => (
              <CommandItem key={item.path} value={`${item.title} ${item.path}`} onSelect={() => goTo(item.path)}>
                <item.icon className="mr-2 h-4 w-4" />
                <span>{item.title}</span>
                <CommandShortcut>{item.shortcut}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
