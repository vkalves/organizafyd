import { Shortcuts } from "@/components/shortcuts/Shortcuts";
import {
  LayoutDashboard, CheckSquare, StickyNote, Settings,
  Search, Menu, ChevronLeft, LogOut, Instagram,
  Music2, Globe, Clock, CheckCircle2, Network, Presentation, X,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayoutContext } from "@/contexts/AppLayoutContext";
import logoImg from "@/assets/logo-organify.png";
import "./app-shell.css";

function XLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" {...props}>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Tarefas", path: "/tarefas", icon: CheckSquare },
  { title: "Notas", path: "/notas", icon: StickyNote },
  { title: "Mapas", path: "/mapas", icon: Network },
  { title: "Slides", path: "/slides", icon: Presentation },
  { title: "Instagram", path: "/instagram", icon: Instagram },
  { title: "TikTok", path: "/tiktok", icon: Music2 },
  { title: "X", path: "/x", icon: XLogoIcon },
  { title: "Configurações", path: "/config", icon: Settings },
];

const instagramSubs = [
  { title: "Contas", path: "/instagram", icon: Globe },
  { title: "Conteúdos pendentes", path: "/instagram/pendentes", icon: Clock },
  { title: "Conteúdos prontos", path: "/instagram/prontos", icon: CheckCircle2 },
];

const mobileNavItems = navItems.filter((item) => item.path !== "/config");

function isInstagramPath(path: string) {
  return path.startsWith("/instagram");
}

function isInstagramSubActive(path: string, subPath: string) {
  if (subPath === "/instagram/pendentes") {
    return path.startsWith("/instagram/pendentes") || path.endsWith("/hoje");
  }
  if (subPath === "/instagram/prontos") {
    return path.includes("/prontos") || path.endsWith("/tarefas");
  }
  return (
    isInstagramPath(path) &&
    !path.startsWith("/instagram/pendentes") &&
    !path.includes("/prontos") &&
    !path.endsWith("/hoje") &&
    !path.endsWith("/tarefas")
  );
}

function SideNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const instagramOpen = isInstagramPath(location.pathname);
  return (
    <>
      {navItems.map((item) => {
        const isActive = item.path === "/"
          ? location.pathname === "/"
          : item.path === "/instagram" ? instagramOpen : location.pathname.startsWith(item.path);
        return (
          <div key={item.path} className="shell-nav-group">
            <NavLink
              to={item.path}
              target={["/x", "/tiktok"].includes(item.path) ? "_blank" : undefined}
              rel={["/x", "/tiktok"].includes(item.path) ? "noopener noreferrer" : undefined}
              onClick={onNavigate}
              title={["/x", "/tiktok"].includes(item.path) ? `${item.title} · abrir em nova guia` : item.title}
              aria-label={item.title}
              className={cn("shell-nav-link", isActive && "is-active", collapsed && "is-collapsed")}
            >
              <span className="shell-nav-icon"><item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /></span>
              {!collapsed && <span className="shell-nav-label">{item.title}</span>}
            </NavLink>
            {item.path === "/instagram" && instagramOpen && (
              <div className={cn("shell-subnav", collapsed && "is-collapsed")}>
                {instagramSubs.map((sub) => (
                  <NavLink
                    key={sub.path}
                    to={sub.path}
                    title={sub.title}
                    aria-label={sub.title}
                    onClick={onNavigate}
                    className={cn("shell-nav-link shell-subnav-link", isInstagramSubActive(location.pathname, sub.path) && "is-active", collapsed && "is-collapsed")}
                  >
                    <span className="shell-nav-icon"><sub.icon className="h-4 w-4 shrink-0" aria-hidden="true" /></span>
                    {!collapsed && <span className="shell-nav-label">{sub.title}</span>}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function BrandMark() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7" fill="none" aria-hidden="true">
      <path d="M23.3 13a10 10 0 1 1-6.5-8.4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="m8.6 12.7 4.5 4.5L23 7.3" stroke="currentColor" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFocusMode, setMobileFocusMode] = useState(false);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { signOut, user } = useAuth();

  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mobileMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
      if (event.key === "Tab") {
        const focusable = mobileMenuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [mobileMenuOpen]);

  const layoutContext = useMemo(() => ({ setMobileFocusMode }), []);
  const currentPage = navItems.find((item) => item.path !== "/" && location.pathname.startsWith(item.path))?.title || "Dashboard";
  const metadataName = user?.user_metadata?.display_name;
  const displayName = (typeof metadataName === "string" && metadataName.trim()) || user?.email?.split("@")[0] || "Minha conta";
  const initials = displayName.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase();

  return (
    <AppLayoutContext.Provider value={layoutContext}>
      <div className={cn("workspace-shell min-h-[100dvh] min-w-0", desktopSidebarOpen && "shell-expanded", mobileFocusMode && "shell-mobile-focus")}>
        <a href="#workspace-content" className="shell-skip-link">Ir para o conteúdo</a>
        <header className={cn("app-header shell-header", mobileFocusMode && "max-lg:hidden")}>
          <button type="button" aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={mobileMenuOpen} aria-controls="mobile-workspace-menu" onClick={() => setMobileMenuOpen((open) => !open)} className="shell-icon-button shell-mobile-toggle lg:hidden">
            {mobileMenuOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
          </button>
          <button
            type="button"
            aria-label={desktopSidebarOpen ? "Recolher menu lateral" : "Expandir menu lateral"}
            aria-expanded={desktopSidebarOpen}
            aria-controls="desktop-workspace-menu"
            onClick={() => setDesktopSidebarOpen((open) => !open)}
            className="shell-icon-button shell-desktop-toggle hidden lg:flex"
            title={desktopSidebarOpen ? "Recolher menu lateral" : "Expandir menu lateral"}
          >
            {desktopSidebarOpen ? <ChevronLeft className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
          </button>
          <span className="shell-header-divider" aria-hidden="true" />
          <div className="shell-header-title">
            <span className="shell-eyebrow">Central de operação</span>
            <span className="shell-current-page">{currentPage}</span>
          </div>
          <div className="shell-header-space" />
          <div className="shell-search hidden lg:flex">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <input type="search" placeholder="Buscar..." aria-label="Buscar" />
          </div>
          <div className="shell-shortcuts"><Shortcuts key={user?.id} /></div>
          <button type="button" onClick={signOut} className="shell-icon-button shell-header-signout" title="Sair" aria-label="Sair da conta">
            <LogOut className="h-4 w-4" />
          </button>
          <NavLink to="/config" className="shell-avatar" title={displayName} aria-label="Perfil e configurações">
            {initials}
          </NavLink>
        </header>

        <div className={cn("app-body flex min-h-[100dvh] min-w-0", mobileFocusMode && "app-body-focus")}>
          <aside id="desktop-workspace-menu" className="app-desktop-sidebar shell-rail hidden lg:flex" aria-label="Menu lateral">
            <NavLink to="/" className="shell-brand" title="Organizafy · Dashboard" aria-label="Organizafy · Dashboard">
              <span className="shell-brand-mark"><BrandMark /></span>
              {desktopSidebarOpen && <span className="shell-brand-name">Organizafy<span>Seu espaço de trabalho</span></span>}
            </NavLink>
            <span className="shell-rail-divider" aria-hidden="true" />
            <nav className="shell-rail-nav" aria-label="Menu principal"><SideNav collapsed={!desktopSidebarOpen} /></nav>
            <div className="shell-rail-footer">
              <button type="button" onClick={signOut} className="shell-nav-link" title="Sair" aria-label="Sair da conta">
                <span className="shell-nav-icon"><LogOut className="h-[18px] w-[18px]" /></span>
                {desktopSidebarOpen && <span className="shell-nav-label">Sair da conta</span>}
              </button>
              <NavLink to="/config" className="shell-rail-account" title={displayName} aria-label="Perfil e configurações">
                <span className="shell-avatar">{initials}</span>
                {desktopSidebarOpen && <span className="shell-account-name">{displayName}<span>Conta pessoal</span></span>}
              </NavLink>
            </div>
          </aside>

          {mobileMenuOpen && (
            <div className="app-mobile-drawer shell-mobile-overlay fixed inset-x-0 bottom-0 z-[60] lg:hidden" onClick={() => setMobileMenuOpen(false)}>
              <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
              <aside ref={mobileMenuRef} id="mobile-workspace-menu" className="shell-mobile-menu relative h-full w-[min(19rem,86vw)] animate-slide-in-left" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Menu principal">
                <div className="shell-mobile-brand"><img src={logoImg} alt="Organizafy" /><button type="button" onClick={() => setMobileMenuOpen(false)} className="shell-icon-button" aria-label="Fechar menu"><X className="h-4 w-4" /></button></div>
                <p className="shell-eyebrow px-6 pb-4">Seu espaço de trabalho</p>
                <nav className="shell-mobile-nav space-y-1 px-4" aria-label="Menu principal"><SideNav onNavigate={() => setMobileMenuOpen(false)} /></nav>
                <div className="shell-mobile-account"><span className="shell-avatar">{initials}</span><span className="shell-account-name">{displayName}<span>Conta pessoal</span></span><button type="button" onClick={signOut} className="shell-icon-button ml-auto" title="Sair" aria-label="Sair da conta"><LogOut className="h-4 w-4" /></button></div>
              </aside>
            </div>
          )}

          <main id="workspace-content" tabIndex={-1} className={cn("app-main min-w-0 flex-1 overflow-x-clip", mobileFocusMode && "app-main-focus")}>
            <div className={cn("app-page-frame min-w-0 animate-fade-in", mobileFocusMode && "app-page-frame-focus")}>{children}</div>
          </main>
        </div>

        <nav className={cn("mobile-bottom-nav shell-bottom-nav fixed inset-x-0 bottom-0 z-50 flex items-start justify-around lg:hidden", mobileFocusMode && "hidden")} aria-label="Navegação principal">
          {mobileNavItems.map((item) => {
            const isActive = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
            return (
              <NavLink key={item.path} to={item.path} target={["/x", "/tiktok"].includes(item.path) ? "_blank" : undefined} rel={["/x", "/tiktok"].includes(item.path) ? "noopener noreferrer" : undefined} aria-label={item.title} className={cn("shell-bottom-link flex min-w-0 flex-1 touch-manipulation flex-col items-center", isActive && "is-active")}>
                <span className="shell-bottom-icon"><item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /></span>
                <span className="w-full truncate text-center text-[10px] font-medium">{item.title}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </AppLayoutContext.Provider>
  );
}
