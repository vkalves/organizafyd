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
  expect(screen.getByRole("status")).toHaveTextContent(
    "As curtidas disponíveis continuam aparecendo",
  );
  expect(screen.getByText("@alfa")).toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/avanca/conectar");
});
it("does not ask for renewed authorization when metrics are authorized", () => {
  render(
    <InsightsPermissionNotice
      accounts={[]}
      report={{ checked_at: "now", accounts: [] }}
    />,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
