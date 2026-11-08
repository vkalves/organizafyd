import { PublicationFeedback } from "@/features/instagram-publisher/PublicationSound";
import { InstagramAlerts, useInstagramMonitor } from "@/features/instagram-publisher/InstagramAlerts";
import { Shortcuts } from "@/components/shortcuts/Shortcuts";
import {
  LayoutDashboard,
  CheckSquare,
  StickyNote,
  Settings,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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
  Layers,
  AlertTriangle,
  MoreHorizontal,
  ExternalLink,
  type LucideIcon,
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

type NavIcon = LucideIcon | ((props: SVGProps<SVGSVGElement>) => JSX.Element);

interface NavItem {
  title: string;
  path: string;
  icon: NavIcon;
  exact?: boolean;
  matchPaths?: string[];
  externalTab?: boolean;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const classicSections: NavSection[] = [
  {
    items: [
      { title: "Dashboard", path: "/", icon: LayoutDashboard, exact: true },
      { title: "Tarefas", path: "/tarefas", icon: CheckSquare },
      { title: "Notas", path: "/notas", icon: StickyNote },
    ],
  },
  {
    label: "Criação",
    items: [
      { title: "Mapas", path: "/mapas", icon: Network },
      { title: "Slides", path: "/slides", icon: Presentation },
    ],
  },
  {
    label: "Canais",
    items: [
      { title: "Instagram", path: "/instagram", icon: Instagram },
      { title: "TikTok", path: "/tiktok", icon: Music2, externalTab: true },
      { title: "X", path: "/x", icon: XLogoIcon, externalTab: true },
    ],
  },
  {
    items: [{ title: "Configurações", path: "/config", icon: Settings }],
  },
];

const agoniaSections: NavSection[] = [
  {
    items: [
      { title: "Dashboard", path: "/agonia", icon: LayoutDashboard, exact: true },
      { title: "Modo Fluxo", path: "/agonia/fluxos", icon: Layers },
      { title: "Alertas", path: "/agonia/alertas", icon: AlertTriangle },
      { title: "Conectar", path: "/agonia/conectar", icon: PlugZap },
    ],
  },
  {
    label: "Publicação",
    items: [
      { title: "Instagram", path: "/agonia/instagram", icon: Instagram },
      { title: "Novo Reel", path: "/agonia/reels-new", icon: PlusCircle },
      { title: "Stories", path: "/agonia/stories", icon: Image },
      { title: "Stories c/ Link", path: "/agonia/stories-link", icon: Link2 },
      { title: "Agendamentos", path: "/agonia/scheduled", icon: CalendarClock },
      { title: "Publicados", path: "/agonia/reels", icon: Film, matchPaths: ["/agonia/reels", "/agonia/reels-test"] },
    ],
  },
  {
    label: "Conta",
    items: [
      { title: "Configurações", path: "/agonia/settings", icon: Settings },
      { title: "Meu Perfil", path: "/agonia/profile", icon: UserRound },
    ],
  },
];

const classicNavItems = classicSections.flatMap((s) => s.items);
const agoniaNavItems = agoniaSections.flatMap((s) => s.items);

function AgoniaBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="silver-brand agonia-shell-brand">
      <span className="agonia-brand-mark">
        <img src={agoniaMask} alt="" width="28" height="28" />
      </span>
      {!compact && (
        <span className="flex items-center gap-1.5">
          <span>
            Organiza<span className="silver-text">fy</span>
          </span>
          <span className="rounded-md border border-border bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-muted-foreground">
            Agonia
          </span>
        </span>
      )}
    </span>
  );
}

function isItemActive(item: NavItem, pathname: string, isAgoniaMode: boolean) {
  if (isAgoniaMode) {
    if (item.exact) {
      return pathname === "/" || pathname === "/agonia" || pathname === "/agonia/";
    }
    if (item.matchPaths) return item.matchPaths.includes(pathname);
    return pathname === item.path;
  }
  if (item.path === "/") return pathname === "/";
  if (item.path === "/instagram") return pathname.startsWith("/instagram");
  return pathname.startsWith(item.path);
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
  const monitor = useInstagramMonitor();
  const unreadAlertsCount =
    monitor.data?.alerts.filter((a) => !a.read_at && !a.resolved_at).length ?? 0;

  const sections = isAgoniaMode ? agoniaSections : classicSections;

  return (
    <>
      {sections.map((section, sectionIdx) => (
        <div key={section.label || sectionIdx} className="shell-nav-section">
          {section.label && !collapsed && (
            <p className="shell-nav-section-label">{section.label}</p>
          )}
          {section.label && collapsed && (
            <span className="shell-nav-section-rule" aria-hidden="true" />
          )}
          {section.items.map((item) => {
            const isActive = isItemActive(item, location.pathname, isAgoniaMode);
            const showAlertBadge = item.path === "/agonia/alertas" && unreadAlertsCount > 0;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                target={item.externalTab ? "_blank" : undefined}
                rel={item.externalTab ? "noopener noreferrer" : undefined}
                onClick={onNavigate}
                title={item.externalTab ? `${item.title} · abre em nova aba` : item.title}
                aria-label={item.title}
                className={cn(
                  "shell-nav-link",
                  isActive && "is-active",
                  collapsed && "is-collapsed",
                )}
              >
                <span className="shell-nav-icon relative">
                  <item.icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
                  {showAlertBadge && collapsed && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />
                  )}
                </span>
                {!collapsed && (
                  <span className="shell-nav-label">
                    <span className="truncate">{item.title}</span>
                    {showAlertBadge && (
                      <span className="shell-nav-badge">{unreadAlertsCount}</span>
                    )}
                    {item.externalTab && (
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-40" aria-hidden="true" />
                    )}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      ))}
    </>
  );
}

function ModeSwitcher({
  isAgoniaMode,
  collapsed,
  onSwitch,
}: {
  isAgoniaMode: boolean;
  collapsed?: boolean;
  onSwitch: (targetAgonia: boolean) => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onSwitch(!isAgoniaMode)}
        className="shell-mode-compact"
        title={isAgoniaMode ? "Alternar para modo Padrão" : "Alternar para modo Agonia"}
        aria-label={isAgoniaMode ? "Alternar para modo Padrão" : "Alternar para modo Agonia"}
      >
        <Sparkles className="h-4 w-4 shrink-0" />
      </button>
    );
  }

  return (
    <div className="shell-mode-switcher" role="group" aria-label="Modo de operação">
      <button
        type="button"
        onClick={() => onSwitch(false)}
        aria-pressed={!isAgoniaMode}
        className={cn("shell-mode-pill", !isAgoniaMode && "is-active")}
      >
        Padrão
      </button>
      <button
        type="button"
        onClick={() => onSwitch(true)}
        aria-pressed={isAgoniaMode}
        className={cn("shell-mode-pill", isAgoniaMode && "is-active")}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span>Agonia</span>
      </button>
    </div>
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
        isItemActive(item, location.pathname, true),
      );
      return match?.title || "Dashboard";
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
      navigate(targetAgonia ? "/agonia" : "/");
    },
    [navigate],
  );

  // Mobile bottom bar: 4 primary destinations + "Mais" drawer trigger
  const mobilePrimaryItems = useMemo(() => {
    if (isAgoniaMode) {
      return [
        agoniaNavItems[0], // Dashboard
        agoniaNavItems[1], // Modo Fluxo
        agoniaNavItems[5], // Novo Reel
        agoniaNavItems[8], // Agendamentos
      ];
    }
    return [
      classicNavItems[0], // Dashboard
      classicNavItems[1], // Tarefas
      classicNavItems[2], // Notas
      classicNavItems[5], // Instagram
    ];
  }, [isAgoniaMode]);

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

        {/* Desktop Sidebar */}
        <aside
          id="desktop-workspace-menu"
          className="app-desktop-sidebar shell-rail hidden lg:flex"
          aria-label="Menu lateral"
        >
          <div className="shell-rail-top">
            <NavLink
              to={isAgoniaMode ? "/agonia" : "/"}
              className="shell-brand"
              title={isAgoniaMode ? "Agonia · Dashboard" : "Organizafy · Dashboard"}
              aria-label={isAgoniaMode ? "Agonia · Dashboard" : "Organizafy · Dashboard"}
            >
              {isAgoniaMode ? (
                <AgoniaBrand compact={!desktopSidebarOpen} />
              ) : (
                <SilverBrand compact={!desktopSidebarOpen} />
              )}
            </NavLink>
            <button
              type="button"
              aria-label={desktopSidebarOpen ? "Recolher menu lateral" : "Expandir menu lateral"}
              aria-expanded={desktopSidebarOpen}
              aria-controls="desktop-workspace-menu"
              onClick={() => setDesktopSidebarOpen((open) => !open)}
              className="shell-icon-button shell-collapse-btn"
              title={desktopSidebarOpen ? "Recolher menu" : "Expandir menu"}
            >
              {desktopSidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
          </div>

          <ModeSwitcher
            isAgoniaMode={isAgoniaMode}
            collapsed={!desktopSidebarOpen}
            onSwitch={switchMode}
          />

          <nav className="shell-rail-nav" aria-label="Menu principal">
            <SideNav collapsed={!desktopSidebarOpen} isAgoniaMode={isAgoniaMode} />
          </nav>

          <div className="shell-rail-footer">
            <NavLink
              to={isAgoniaMode ? "/agonia/profile" : "/config"}
              className={cn("shell-rail-account", !desktopSidebarOpen && "is-collapsed")}
              title={`${displayName} · Configurações`}
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
                  <span>{user?.email || "Configurações"}</span>
                </span>
              )}
            </NavLink>
            <button
              type="button"
              onClick={signOut}
              className="shell-icon-button shell-rail-signout"
              title="Sair da conta"
              aria-label="Sair da conta"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        {/* Top Bar */}
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

          <div className="shell-header-title">
            {isAgoniaMode && <span className="shell-eyebrow">Agonia</span>}
            <span className="shell-current-page">{currentPage}</span>
          </div>

          <div className="shell-header-space" />

          <div className="shell-header-tools">
            <div className="shell-shortcuts">
              <Shortcuts key={user?.id} />
            </div>
            <PublicationFeedback />
            <InstagramAlerts />
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div
            className="app-mobile-drawer shell-mobile-overlay fixed inset-0 z-[60] lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <div className="absolute inset-0 bg-black/70" />
            <aside
              ref={mobileMenuRef}
              id="mobile-workspace-menu"
              className="shell-mobile-menu relative h-full w-[min(18.5rem,86vw)] animate-slide-in-left"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Menu principal"
            >
              <div className="shell-mobile-brand">
                <NavLink
                  to={isAgoniaMode ? "/agonia" : "/"}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label={isAgoniaMode ? "Agonia" : "Organizafy"}
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

              <div className="px-3.5 pb-3">
                <ModeSwitcher
                  isAgoniaMode={isAgoniaMode}
                  onSwitch={(target) => {
                    switchMode(target);
                    setMobileMenuOpen(false);
                  }}
                />
              </div>

              <nav className="shell-mobile-nav px-3" aria-label="Menu principal">
                <SideNav isAgoniaMode={isAgoniaMode} onNavigate={() => setMobileMenuOpen(false)} />
              </nav>

              <div className="shell-mobile-account">
                <NavLink
                  to={isAgoniaMode ? "/agonia/profile" : "/config"}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex min-w-0 flex-1 items-center gap-2.5"
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
                  <span className="shell-account-name">
                    {displayName}
                    <span>{user?.email || "Configurações"}</span>
                  </span>
                </NavLink>
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

        {/* Main Workspace */}
        <div className={cn("app-body flex min-h-[100dvh] min-w-0", mobileFocusMode && "app-body-focus")}>
          <main
            id="workspace-content"
            tabIndex={-1}
            className={cn("app-main min-w-0 flex-1 overflow-x-clip", mobileFocusMode && "app-main-focus")}
          >
            <div className={cn("app-page-frame min-w-0", mobileFocusMode && "app-page-frame-focus")}>
              {children}
            </div>
          </main>
        </div>

        {/* Mobile Bottom Bar */}
        <nav
          className={cn(
            "mobile-bottom-nav shell-bottom-nav fixed inset-x-0 bottom-0 z-50 flex items-center justify-around lg:hidden",
            mobileFocusMode && "hidden",
          )}
          aria-label="Navegação rápida"
        >
          {mobilePrimaryItems.map((item) => {
            const isActive = isItemActive(item, location.pathname, isAgoniaMode);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                aria-label={item.title}
                className={cn(
                  "shell-bottom-link flex min-w-0 flex-1 touch-manipulation flex-col items-center",
                  isActive && "is-active",
                )}
              >
                <span className="shell-bottom-icon">
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                </span>
                <span className="w-full truncate text-center text-[11px] font-medium">{item.title}</span>
              </NavLink>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Mais opções"
            aria-expanded={mobileMenuOpen}
            className={cn(
              "shell-bottom-link flex min-w-0 flex-1 touch-manipulation flex-col items-center",
              mobileMenuOpen && "is-active",
            )}
          >
            <span className="shell-bottom-icon">
              <MoreHorizontal className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            </span>
            <span className="w-full truncate text-center text-[11px] font-medium">Mais</span>
          </button>
        </nav>
      </div>
    </AppLayoutContext.Provider>
  );
}
