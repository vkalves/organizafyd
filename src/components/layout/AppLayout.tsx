import { PublicationFeedback } from "@/features/instagram-publisher/PublicationSound";
import { InstagramAlerts, useInstagramMonitor } from "@/features/instagram-publisher/InstagramAlerts";
import { Shortcuts } from "@/components/shortcuts/Shortcuts";
import {
  LayoutDashboard,
  BarChart3,
  Settings,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Instagram,
  X,
  PlugZap,
  PlusCircle,
  Image,
  Link2,
  CalendarClock,
  Film,
  UserRound,
  Layers,
  Code2,
  AlertTriangle,
  MoreHorizontal,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayoutContext } from "@/contexts/AppLayoutContext";
import { loadAgoniaProfile } from "@/features/agonia/schedule";
import { SilverBrand } from "./SilverBrand";
import "./app-shell.css";

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

const agoniaSections: NavSection[] = [
  {
    items: [
      { title: "Dashboard", path: "/dispara", icon: LayoutDashboard, exact: true },
      { title: "Modo Fluxo", path: "/dispara/fluxos", icon: Layers },
      { title: "Alertas", path: "/dispara/alertas", icon: AlertTriangle },
      { title: "Conectar", path: "/dispara/conectar", icon: PlugZap },
      { title: "Meta Developer", path: "/dispara/meta-developer", icon: Code2 },
    ],
  },
  {
    label: "Publicação",
    items: [
      { title: "Instagram", path: "/dispara/instagram", icon: Instagram },
      { title: "Novo Reel", path: "/dispara/reels-new", icon: PlusCircle },
      { title: "Stories", path: "/dispara/stories", icon: Image },
      { title: "Stories c/ Link", path: "/dispara/stories-link", icon: Link2 },
      { title: "Agendamentos", path: "/dispara/scheduled", icon: CalendarClock },
      { title: "Publicados", path: "/dispara/reels", icon: Film, matchPaths: ["/dispara/reels", "/dispara/reels-test"] },
    ],
  },
  {
    label: "Conta",
    items: [
      { title: "Visualizações", path: "/dispara/visualizacoes", icon: BarChart3 },
      { title: "Configurações", path: "/dispara/settings", icon: Settings },
      { title: "Meu Perfil", path: "/dispara/profile", icon: UserRound },
    ],
  },
];

const agoniaNavItems = agoniaSections.flatMap((s) => s.items);

function AgoniaBrand({ compact = false }: { compact?: boolean }) {
  return <SilverBrand compact={compact} />;
}

function isItemActive(item: NavItem, pathname: string) {
  if (item.exact) {
    return pathname === "/" || pathname === "/dispara" || pathname === "/dispara/";
  }
  if (item.matchPaths) return item.matchPaths.includes(pathname);
  return pathname === item.path;
}

function SideNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const monitor = useInstagramMonitor();
  const unreadAlertsCount =
    monitor.data?.alerts.filter((a) => !a.read_at && !a.resolved_at).length ?? 0;

  return (
    <>
      {agoniaSections.map((section, sectionIdx) => (
        <div key={section.label || sectionIdx} className="shell-nav-section">
          {section.label && !collapsed && (
            <p className="shell-nav-section-label">{section.label}</p>
          )}
          {section.label && collapsed && (
            <span className="shell-nav-section-rule" aria-hidden="true" />
          )}
          {section.items.map((item) => {
            const isActive = isItemActive(item, location.pathname);
            const showAlertBadge = item.path === "/dispara/alertas" && unreadAlertsCount > 0;
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
                  item.path === "/dispara/reels-new" && "shell-nav-create",
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

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFocusMode, setMobileFocusMode] = useState(false);
  const [profileTick, setProfileTick] = useState(0);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { signOut, user } = useAuth();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

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
    if (location.pathname === "/dispara/reels-test") return "Diagnóstico de Publicação";
    const match = agoniaNavItems.find((item) =>
      isItemActive(item, location.pathname),
    );
    return match?.title || "Dashboard";
  }, [location.pathname]);

  // Mobile bottom bar: 4 primary destinations + "Mais" drawer trigger
  const mobilePrimaryItems = useMemo(
    () => agoniaNavItems.filter((item) =>
      ["/dispara", "/dispara/fluxos", "/dispara/reels-new", "/dispara/scheduled"].includes(item.path),
    ),
    [],
  );

  return (
    <AppLayoutContext.Provider value={layoutContext}>
      <div
        className={cn(
          "workspace-shell min-h-[100dvh] min-w-0 shell-agonia-mode",
          desktopSidebarOpen && "shell-expanded",
          mobileFocusMode && "shell-mobile-focus",
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
              to="/dispara"
              className="shell-brand"
              title="AVANÇA · Dashboard"
              aria-label="AVANÇA · Dashboard"
            >
              <AgoniaBrand compact={!desktopSidebarOpen} />
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

          <nav className="shell-rail-nav" aria-label="Menu principal">
            <SideNav collapsed={!desktopSidebarOpen} />
          </nav>

          <div className="shell-rail-footer">
            <NavLink
              to="/dispara/profile"
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
            <span className="shell-eyebrow"><SilverBrand compact /></span>
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
                  to="/dispara"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="AVANÇA"
                >
                  <AgoniaBrand />
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

              <nav className="shell-mobile-nav px-3" aria-label="Menu principal">
                <SideNav onNavigate={() => setMobileMenuOpen(false)} />
              </nav>

              <div className="shell-mobile-account">
                <NavLink
                  to="/dispara/profile"
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
            const isActive = isItemActive(item, location.pathname);
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
