import { PublicationFeedback } from "@/features/instagram-publisher/PublicationSound";
import { InstagramAlerts } from "@/features/instagram-publisher/InstagramAlerts";
import { Shortcuts } from "@/components/shortcuts/Shortcuts";
import {
  LayoutDashboard,
  CheckSquare,
  StickyNote,
  Settings,
  Search,
  Menu,
  ChevronLeft,
  LogOut,
  Instagram,
  Music2,
  Network,
  Presentation,
  X,
  Sparkles,
  PlugZap,
  PlusCircle,
  Image,
  Link2,
  CalendarClock,
  Film,
  UserRound,
  ArrowLeftRight,
  Layers,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayoutContext } from "@/contexts/AppLayoutContext";
import { SilverBrand } from "./SilverBrand";
import {
  getWorkspaceMode,
  loadAgoniaProfile,
  setWorkspaceMode,
  type WorkspaceMode,
} from "@/features/agonia/schedule";
import agoniaMask from "@/assets/agonia-mask.webp";
import "./app-shell.css";

function XLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" {...props}>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

const classicNavItems = [
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

const agoniaNavItems = [
  { title: "Dashboard", path: "/agonia", icon: LayoutDashboard, exact: true },
  { title: "Modo Fluxo", path: "/agonia/fluxos", icon: Layers },
  { title: "Conectar", path: "/agonia/conectar", icon: PlugZap },
  { title: "Instagram", path: "/agonia/instagram", icon: Instagram },
  { title: "Novo Reel", path: "/agonia/reels-new", icon: PlusCircle },
  { title: "Stories", path: "/agonia/stories", icon: Image },
  { title: "Storys Com Link", path: "/agonia/stories-link", icon: Link2 },
  { title: "Agendamentos", path: "/agonia/scheduled", icon: CalendarClock },
  { title: "Publicados", path: "/agonia/reels", icon: Film, matchPaths: ["/agonia/reels", "/agonia/reels-test"] },
  { title: "Configurações", path: "/agonia/settings", icon: Settings },
  { title: "Meu Perfil", path: "/agonia/profile", icon: UserRound },
];

function isInstagramPath(path: string) {
  return path.startsWith("/instagram");
}

function AgoniaBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="silver-brand agonia-shell-brand">
      <span className="agonia-brand-mark">
        <img src={agoniaMask} alt="" width="38" height="38" />
      </span>
      {!compact && (
        <span>
          Organiza<span className="silver-text">fy</span>{" "}
          <small className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Agonia
          </small>
        </span>
      )}
    </span>
  );
}

function SideNav({
  collapsed,
  isAgoniaMode,
  onNavigate,
}: {
  collapsed?: boolean;
  isAgoniaMode: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const instagramOpen = isInstagramPath(location.pathname);

  if (isAgoniaMode) {
    return (
      <>
        {agoniaNavItems.map((item) => {
          const isActive = item.exact
            ? location.pathname === "/" ||
              location.pathname === "/agonia" ||
              location.pathname === "/agonia/"
            : item.matchPaths
              ? item.matchPaths.includes(location.pathname)
              : location.pathname === item.path;
          return (
            <div key={item.path} className="shell-nav-group">
              <NavLink
                to={item.path}
                onClick={onNavigate}
                title={item.title}
                aria-label={item.title}
                className={cn("shell-nav-link", isActive && "is-active", collapsed && "is-collapsed")}
              >
                <span className="shell-nav-icon">
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                </span>
                {!collapsed && <span className="shell-nav-label">{item.title}</span>}
              </NavLink>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {classicNavItems.map((item) => {
        const isActive =
          item.path === "/"
            ? location.pathname === "/"
            : item.path === "/instagram"
              ? instagramOpen
              : location.pathname.startsWith(item.path);
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
              <span className="shell-nav-icon">
                <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              </span>
              {!collapsed && <span className="shell-nav-label">{item.title}</span>}
            </NavLink>
          </div>
        );
      })}
    </>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFocusMode, setMobileFocusMode] = useState(false);
  const [profileTick, setProfileTick] = useState(0);
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(() =>
    getWorkspaceMode(),
  );
  const mobileMenuRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();

  const isAgoniaMode =
    workspaceMode === "agonia" || location.pathname.startsWith("/agonia");

  useEffect(() => {
    setMobileMenuOpen(false);
    if (location.pathname.startsWith("/agonia") && workspaceMode !== "agonia") {
      setWorkspaceMode("agonia");
      setWorkspaceModeState("agonia");
    }
  }, [location.pathname, workspaceMode]);

  useEffect(() => {
    const onModeChange = (event: Event) => {
      const custom = event as CustomEvent<WorkspaceMode>;
      setWorkspaceModeState(custom.detail || getWorkspaceMode());
    };
    window.addEventListener("organizafy-mode-changed", onModeChange);
    return () =>
      window.removeEventListener("organizafy-mode-changed", onModeChange);
  }, []);

  useEffect(() => {
    const onProfileUpdate = () => setProfileTick((n) => n + 1);
    window.addEventListener("agonia-profile-updated", onProfileUpdate);
    return () => window.removeEventListener("agonia-profile-updated", onProfileUpdate);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mobileMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
      if (event.key === "Tab") {
        const focusable = mobileMenuRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled])",
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
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

  const metadataName = user?.user_metadata?.display_name;
  const fallbackName =
    (typeof metadataName === "string" && metadataName.trim()) ||
    user?.email?.split("@")[0] ||
    "Minha conta";

  const agoniaProfile = useMemo(
    () => loadAgoniaProfile(user?.id, fallbackName),
    [user?.id, fallbackName, profileTick],
  );
  const displayName = agoniaProfile.username || fallbackName;
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join("")
    .toUpperCase();

  const currentPage = useMemo(() => {
    if (isAgoniaMode) {
      if (location.pathname === "/agonia/reels-test") return "Diagnóstico de Publicação";
      const match = agoniaNavItems.find((item) =>
        item.exact
          ? location.pathname === "/" || location.pathname === "/agonia"
          : location.pathname === item.path,
      );
      return match ? `Agonia Pro · ${match.title}` : "Agonia Pro · Dashboard";
    }
    return (
      classicNavItems.find((item) => item.path !== "/" && location.pathname.startsWith(item.path))?.title ||
      "Dashboard"
    );
  }, [isAgoniaMode, location.pathname]);

  const switchMode = useCallback(
    (targetAgonia: boolean) => {
      const nextMode: WorkspaceMode = targetAgonia ? "agonia" : "classic";
      setWorkspaceMode(nextMode);
      setWorkspaceModeState(nextMode);
      if (targetAgonia) {
        navigate("/agonia");
      } else {
        navigate("/");
      }
    },
    [navigate],
  );

  const mobileNavItems = isAgoniaMode
    ? agoniaNavItems.slice(0, 6)
    : classicNavItems.filter((item) => item.path !== "/config");

  return (
    <AppLayoutContext.Provider value={layoutContext}>
      <div
        className={cn(
          "workspace-shell min-h-[100dvh] min-w-0",
          desktopSidebarOpen && "shell-expanded",
          mobileFocusMode && "shell-mobile-focus",
          isAgoniaMode && "shell-agonia-mode",
        )}
      >
        <a href="#workspace-content" className="shell-skip-link">
          Ir para o conteúdo
        </a>
        <header className={cn("app-header shell-header", mobileFocusMode && "max-lg:hidden")}>
          <button
            type="button"
            aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-workspace-menu"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="shell-icon-button shell-mobile-toggle lg:hidden"
          >
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
            <span className="shell-eyebrow">{isAgoniaMode ? "Modo Agonia Pro" : "Central de operação"}</span>
            <span className="shell-current-page">{currentPage}</span>
          </div>

          <div className="shell-header-space" />

          {/* Seletor rápido de modo: Modelo Antigo vs Modo Agonia */}
          <div className="shell-mode-switcher" role="group" aria-label="Alternar modo do painel">
            <button
              type="button"
              onClick={() => switchMode(false)}
              aria-pressed={!isAgoniaMode}
              className={cn("shell-mode-pill", !isAgoniaMode && "is-active")}
            >
              Modelo Antigo
            </button>
            <button
              type="button"
              onClick={() => switchMode(true)}
              aria-pressed={isAgoniaMode}
              className={cn("shell-mode-pill shell-mode-pill-agonia", isAgoniaMode && "is-active")}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>Modo Agonia</span>
            </button>
          </div>

          <div className="shell-search hidden xl:flex">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <input type="search" placeholder="Buscar..." aria-label="Buscar" />
          </div>
          <PublicationFeedback />
          <InstagramAlerts />
          <div className="shell-shortcuts">
            <Shortcuts key={user?.id} />
          </div>
          <button
            type="button"
            onClick={signOut}
            className="shell-icon-button shell-header-signout"
            title="Sair"
            aria-label="Sair da conta"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <NavLink
            to={isAgoniaMode ? "/agonia/profile" : "/config"}
            className="shell-avatar"
            title={displayName}
            aria-label="Perfil e configurações"
          >
            {agoniaProfile.avatarDataUrl ? (
              <img
                src={agoniaProfile.avatarDataUrl}
                alt={displayName}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              initials
            )}
          </NavLink>
        </header>

        <div className={cn("app-body flex min-h-[100dvh] min-w-0", mobileFocusMode && "app-body-focus")}>
          <aside
            id="desktop-workspace-menu"
            className="app-desktop-sidebar shell-rail hidden lg:flex"
            aria-label="Menu lateral"
          >
            <NavLink
              to={isAgoniaMode ? "/agonia" : "/auth?welcome=1"}
              className="shell-brand"
              title={isAgoniaMode ? "Agonia Pro · Dashboard" : "Organizafy · Tela inicial"}
              aria-label={isAgoniaMode ? "Agonia Pro · Dashboard" : "Organizafy · Voltar à tela inicial"}
            >
              {isAgoniaMode ? (
                <AgoniaBrand compact={!desktopSidebarOpen} />
              ) : (
                <SilverBrand compact={!desktopSidebarOpen} />
              )}
            </NavLink>

            <button
              type="button"
              onClick={() => switchMode(!isAgoniaMode)}
              className={cn("shell-rail-mode-btn", !desktopSidebarOpen && "is-collapsed")}
              title={isAgoniaMode ? "Voltar para o Modelo Antigo (Organizafy)" : "Abrir Modo Agonia Pro"}
            >
              <ArrowLeftRight className="h-4 w-4 shrink-0" />
              {desktopSidebarOpen && (
                <span>{isAgoniaMode ? "Voltar ao Modelo Antigo" : "Ir para Modo Agonia"}</span>
              )}
            </button>

            <span className="shell-rail-divider" aria-hidden="true" />
            <nav className="shell-rail-nav" aria-label="Menu principal">
              <SideNav collapsed={!desktopSidebarOpen} isAgoniaMode={isAgoniaMode} />
            </nav>
            <div className="shell-rail-footer">
              <NavLink
                to={isAgoniaMode ? "/agonia/profile" : "/config"}
                className="shell-rail-account"
                title={displayName}
                aria-label="Perfil e configurações"
              >
                <span className="shell-avatar">
                  {agoniaProfile.avatarDataUrl ? (
                    <img
                      src={agoniaProfile.avatarDataUrl}
                      alt={displayName}
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </span>
                {desktopSidebarOpen && (
                  <span className="shell-account-name">
                    {displayName}
                    <span>{user?.email || "Editar perfil"}</span>
                  </span>
                )}
              </NavLink>
              <button
                type="button"
                onClick={signOut}
                className="shell-nav-link w-full"
                title="Sair"
                aria-label="Sair da conta"
              >
                <span className="shell-nav-icon">
                  <LogOut className="h-[18px] w-[18px]" />
                </span>
                {desktopSidebarOpen && <span className="shell-nav-label">Sair</span>}
              </button>
            </div>
          </aside>

          {mobileMenuOpen && (
            <div
              className="app-mobile-drawer shell-mobile-overlay fixed inset-x-0 bottom-0 z-[60] lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
            >
              <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
              <aside
                ref={mobileMenuRef}
                id="mobile-workspace-menu"
                className="shell-mobile-menu relative h-full w-[min(19rem,86vw)] animate-slide-in-left"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Menu principal"
              >
                <div className="shell-mobile-brand">
                  <NavLink
                    to={isAgoniaMode ? "/agonia" : "/auth?welcome=1"}
                    aria-label={isAgoniaMode ? "Agonia Pro" : "Organizafy"}
                  >
                    {isAgoniaMode ? <AgoniaBrand /> : <SilverBrand />}
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="shell-icon-button"
                    aria-label="Fechar menu"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="px-4 pb-3">
                  <button
                    type="button"
                    onClick={() => {
                      switchMode(!isAgoniaMode);
                      setMobileMenuOpen(false);
                    }}
                    className="shell-rail-mode-btn w-full"
                  >
                    <ArrowLeftRight className="h-4 w-4 shrink-0" />
                    <span>{isAgoniaMode ? "Voltar ao Modelo Antigo" : "Ir para Modo Agonia"}</span>
                  </button>
                </div>
                <p className="shell-eyebrow px-6 pb-3">
                  {isAgoniaMode ? "Painel Agonia Pro" : "Seu espaço de trabalho"}
                </p>
                <nav className="shell-mobile-nav space-y-1 px-4" aria-label="Menu principal">
                  <SideNav isAgoniaMode={isAgoniaMode} onNavigate={() => setMobileMenuOpen(false)} />
                </nav>
                <div className="shell-mobile-account">
                  <span className="shell-avatar">
                    {agoniaProfile.avatarDataUrl ? (
                      <img
                        src={agoniaProfile.avatarDataUrl}
                        alt={displayName}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      initials
                    )}
                  </span>
                  <span className="shell-account-name">
                    {displayName}
                    <span>{user?.email || "Conta pessoal"}</span>
                  </span>
                  <button
                    type="button"
                    onClick={signOut}
                    className="shell-icon-button ml-auto"
                    title="Sair"
                    aria-label="Sair da conta"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </aside>
            </div>
          )}

          <main
            id="workspace-content"
            tabIndex={-1}
            className={cn("app-main min-w-0 flex-1 overflow-x-clip", mobileFocusMode && "app-main-focus")}
          >
            <div className={cn("app-page-frame min-w-0 animate-fade-in", mobileFocusMode && "app-page-frame-focus")}>
              {children}
            </div>
          </main>
        </div>

        <nav
          className={cn(
            "mobile-bottom-nav shell-bottom-nav fixed inset-x-0 bottom-0 z-50 flex items-start justify-around lg:hidden",
            mobileFocusMode && "hidden",
          )}
          aria-label="Navegação principal"
        >
          {mobileNavItems.map((item) => {
            const isActive =
              item.path === "/" || item.path === "/agonia"
                ? location.pathname === item.path
                : location.pathname.startsWith(item.path);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                target={["/x", "/tiktok"].includes(item.path) ? "_blank" : undefined}
                rel={["/x", "/tiktok"].includes(item.path) ? "noopener noreferrer" : undefined}
                aria-label={item.title}
                className={cn(
                  "shell-bottom-link flex min-w-0 flex-1 touch-manipulation flex-col items-center",
                  isActive && "is-active",
                )}
              >
                <span className="shell-bottom-icon">
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                </span>
                <span className="w-full truncate text-center text-[10px] font-medium">{item.title}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </AppLayoutContext.Provider>
  );
}
