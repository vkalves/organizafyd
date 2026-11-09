import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { LegacyWorkspaceRedirect } from "./LegacyWorkspaceRedirect";

afterEach(cleanup);
function Destination() {
  const { pathname, search, hash } = useLocation();
  return <p>{pathname}{search}{hash}</p>;
}
for (const [from, to] of [
  ["/agonia", "/disparo"],
  ["/agonia/visualizacoes?conta=1#ranking", "/disparo/visualizacoes?conta=1#ranking"],
  ["/agonia/fluxos", "/disparo/fluxos"],
]) {
  it(`preserva o acesso antigo ${from}`, () => {
    render(<MemoryRouter initialEntries={[from]}><Routes>
      <Route path="/agonia/*" element={<LegacyWorkspaceRedirect />} />
      <Route path="/disparo/*" element={<Destination />} />
    </Routes></MemoryRouter>);
    expect(screen.getByText(to)).toBeInTheDocument();
  });
}
