import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "qa", email: "qa@example.test" }, signOut: vi.fn() }) }));
vi.mock("@/components/shortcuts/Shortcuts", () => ({ Shortcuts: () => null }));
vi.mock("@/features/instagram-publisher/PublicationSound", () => ({ PublicationFeedback: () => null }));
vi.mock("@/features/instagram-publisher/InstagramAlerts", () => ({ useInstagramMonitor: () => ({ data: { alerts: [] } }), InstagramAlerts: () => null }));
const adminAccess = vi.hoisted(() => ({ is_admin: false }));
vi.mock("@/features/administration/api", () => ({ useAdministrationAccess: () => ({ data: adminAccess }) }));
import { AppLayout } from "./AppLayout";
function Location() { return <output aria-label="Rota atual">{useLocation().pathname}</output>; }
function show() { render(<MemoryRouter initialEntries={["/avanca"]}><AppLayout><Location /></AppLayout></MemoryRouter>); }
afterEach(() => { cleanup(); localStorage.clear(); adminAccess.is_admin = false; });
const destinations = ["/avanca", "/avanca/fluxos", "/avanca/alertas", "/avanca/conectar", "/avanca/meta-developer", "/avanca/instagram", "/avanca/reels-new", "/avanca/stories", "/avanca/stories-link", "/avanca/scheduled", "/avanca/reels", "/avanca/visualizacoes", "/avanca/settings", "/avanca/profile"];
describe("Avança — navegação preservada", () => {
  it("mostra a administração apenas quando o servidor reconhece o administrador", () => {
    show();
    expect(screen.queryByRole("link", { name: "Administração" })).not.toBeInTheDocument();
    cleanup(); adminAccess.is_admin = true; show();
    expect(screen.getByRole("link", { name: "Administração" })).toHaveAttribute("href", "/avanca/admin");
  });
  it("prioriza criar e agendar na barra móvel, mantendo os demais destinos em Mais", () => {
    show();
    const quickNav = screen.getByRole("navigation", { name: "Navegação rápida" });
    expect(within(quickNav).getAllByRole("link").map(a => a.getAttribute("href"))).toEqual(["/avanca", "/avanca/fluxos", "/avanca/reels-new", "/avanca/scheduled"]);
    expect(within(quickNav).getByRole("button", { name: "Mais opções" })).toBeInTheDocument();
  });
  it("mantém todos os destinos expandidos e recolhidos", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "Menu principal" });
    expect(within(nav).getAllByRole("link").map(a => a.getAttribute("href"))).toEqual(destinations);
    fireEvent.click(screen.getByRole("button", { name: "Recolher menu lateral" }));
    const links = within(nav).getAllByRole("link");
    expect(links.map(a => a.getAttribute("href"))).toEqual(destinations);
    for (const link of links) {
      expect(link).toHaveAccessibleName();
      fireEvent.click(link);
      expect(screen.getByLabelText("Rota atual")).toHaveTextContent(link.getAttribute("href")!);
    }
    fireEvent.click(screen.getByRole("button", { name: "Expandir menu lateral" }));
    expect(within(nav).getByRole("link", { name: "Agendamentos" })).toBeInTheDocument();
  });
  it("mantém todos os destinos no menu móvel e fecha ao navegar", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
    const dialog = screen.getByRole("dialog", { name: "Menu principal" });
    const nav = within(dialog).getByRole("navigation", { name: "Menu principal" });
    expect(within(nav).getAllByRole("link").map(a => a.getAttribute("href"))).toEqual(destinations);
    fireEvent.click(within(nav).getByRole("link", { name: "Configurações" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Rota atual")).toHaveTextContent("/avanca/settings");
  });
  it("fecha com Escape e restaura o foco ao acionador", () => {
    show();
    const trigger = screen.getByRole("button", { name: "Abrir menu" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
