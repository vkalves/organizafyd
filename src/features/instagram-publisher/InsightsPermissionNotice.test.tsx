import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InsightsPermissionNotice } from "./InsightsPermissionNotice";
afterEach(cleanup);
it("names accounts missing insights permission without claiming their likes are missing", () => {
  render(
    <InsightsPermissionNotice
      accounts={[{ id: "a", username: "alfa" }]}
      report={{
        checked_at: "now",
        accounts: [{
          account_id: "a",
          videos: [],
          complete: true,
          unavailable: false,
          insights_error: "permission_required",
        }],
      }}
    />,
  );
  expect(screen.getByText(/Algumas contas precisam/)).toHaveTextContent(
    "As curtidas disponíveis continuam aparecendo",
  );
  expect(screen.getByText("Métricas parciais")).toBeInTheDocument();
  expect(screen.getByText("@alfa").closest("details")).not.toHaveAttribute("open");
  screen.getByText("@alfa").closest("details")!.open = true;
  expect(screen.getByText("@alfa")).toBeVisible();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/avanca/conectar");
});
it("does not ask for renewed authorization when metrics are authorized", () => {
  render(
    <InsightsPermissionNotice
      accounts={[]}
      report={{ checked_at: "now", accounts: [] }}
    />,
  );
  expect(screen.queryByText("Métricas parciais")).not.toBeInTheDocument();
});
