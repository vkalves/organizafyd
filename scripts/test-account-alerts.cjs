// End-to-end monitor regression with synthetic API responses only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const api = fs.readFileSync(".env", "utf8").match(
  /^VITE_SUPABASE_URL=["']?([^\s"']+)/m,
)[1];
const project = new URL(api).hostname.split(".")[0];
const owner = "11111111-1111-4111-8111-111111111111";
const ids = [1, 2, 3, 4].map((i) => `22222222-2222-4222-8222-22222222222${i}`);
const accounts = ids.map((id, i) => ({
  id,
  user_id: owner,
  username: `conta_${i + 1}`,
}));
const now = new Date().toISOString();
const health = ids.map((account_id, i) => ({
  account_id,
  state: ["unavailable", "reconnect", "healthy", "unknown"][i],
  candidate: ["unavailable", "reconnect", "healthy", "unknown"][i],
  failures: i < 2 ? 3 : 0,
  checked_at: i === 3 ? null : now,
  last_healthy_at: i === 2 ? now : null,
  error_code: i === 0 ? "meta_100" : null,
}));
const alerts = ids.slice(0, 2).map((account_id, i) => ({
  id: `33333333-3333-4333-8333-33333333333${i}`,
  account_id,
  state: health[i].state,
  created_at: now,
  read_at: null,
  resolved_at: null,
}));
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    page = await context.newPage();
    const errors = [], checks = [];
    let failRead = true, failStatus = false, reads = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addInitScript(
      ({ project, owner }) =>
        localStorage.setItem(
          `sb-${project}-auth-token`,
          JSON.stringify({
            access_token: "fixture-only-token",
            refresh_token: "fixture-refresh",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: "bearer",
            user: {
              id: owner,
              email: "fixture@example.invalid",
              app_metadata: {},
              user_metadata: { avanca_connection_hint_seen: true },
            },
          }),
        ),
      { project, owner },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === base) return route.continue();
      if (url.origin !== new URL(api).origin) {
        return route.fulfill({ status: 200, body: "" });
      }
      const body = req.method() === "POST" ? req.postDataJSON() : null;
      if (url.pathname.includes("/auth/")) {
        return route.fulfill({
          json: {
            id: owner,
            email: "fixture@example.invalid",
            app_metadata: {},
            user_metadata: { avanca_connection_hint_seen: true },
          },
        });
      }
      if (url.pathname.endsWith("/functions/v1/app-admin")) {
        return route.fulfill({
          json: {
            account_status: "approved",
            is_admin: false,
            connection_allowed: true,
          },
        });
      }
      if (url.pathname.endsWith("/functions/v1/instagram-monitor")) {
        if (body.action === "status") {
          return route.fulfill(
            failStatus
              ? { status: 500, json: { error: "offline" } }
              : { json: { health, alerts, history_limit: 100 } },
          );
        }
        if (body.action === "read_all") {
          reads++;
          if (failRead) {
            return route.fulfill({ status: 500, json: { error: "failed" } });
          }
          alerts.forEach((a) => a.read_at = now);
          return route.fulfill({ json: { ok: true, updated: alerts.length } });
        }
        if (body.action === "refresh") {
          checks.push(body.id);
          return route.fulfill({ json: { status: "recent" } });
        }
      }
      if (url.pathname.endsWith("/functions/v1/instagram-publisher")) {
        return route.fulfill({
          json: body.action === "status"
            ? {
              accounts: ids.map((account_id) => ({
                account_id,
                reconnect_required: false,
                paused: false,
              })),
            }
            : {},
        });
      }
      if (url.pathname.endsWith("/rest/v1/instagram_accounts")) {
        return route.fulfill({ json: accounts });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(base + "/avanca/alertas");
    await page.getByRole("navigation", { name: "Menu principal" }).waitFor();
    const skip = page.getByRole("button", { name: "Pular apresentação" });
    if (await skip.isVisible()) await skip.click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole(
      "link",
      { name: "Alertas de contas", exact: true },
    ).click();
    await page.getByRole("heading", { name: "Alertas de contas" }).waitFor();
    await page.getByRole("button", { name: "Marcar todos como lidos" }).click();
    await page.getByText(
      "Não foi possível confirmar a leitura dos alertas. Atualize e tente novamente.",
      { exact: true },
    ).waitFor();
    assert.equal(reads, 1);
    assert.equal(await page.getByText("Não lido", { exact: true }).count(), 2);
    failRead = false;
    await page.getByRole("button", { name: "Marcar todos como lidos" }).click();
    await page.getByText("2 alerta(s) marcado(s) como lido(s).", {
      exact: true,
    }).waitFor();
    assert.equal(
      await page.getByText("Lido · ainda pendente", { exact: true }).count(),
      2,
    );
    await page.getByRole("button", { name: "Saúde das contas (4)" }).click();
    await page.getByRole("searchbox", { name: "Buscar conta" }).fill(
      "@conta_2",
    );
    await page.getByRole("button", { name: "Verificar conta", exact: true })
      .click();
    await page.getByText(/Conta verificada há menos de 1 minuto/).waitFor();
    assert.deepEqual(checks, [ids[1]]);
    await page.getByRole("searchbox").fill("");
    await page.getByRole("searchbox").blur();
    await page.screenshot({
      path: "/workspace/preview/alerts-desktop.png",
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert(
        await page.evaluate(() =>
          document.documentElement.scrollWidth <= innerWidth
        ),
        "horizontal overflow",
      );
      const bounds = await page.locator(".agonia-alerts-view .stat-card")
        .evaluateAll((cards) =>
          cards.every((card) =>
            card.getBoundingClientRect().right <= innerWidth &&
            card.getBoundingClientRect().left >= 0
          )
        );
      assert(bounds, "stat cards clipped outside the viewport");
      assert(
        await page.locator(".agonia-alerts-view .page-subtitle").evaluate(
          (el) => el.scrollWidth <= el.clientWidth,
        ),
        "subtitle clipped",
      );
      await page.getByRole("button", { name: "Mais opções" }).click();
      await page.getByRole("dialog", { name: "Menu principal" }).getByRole(
        "link",
        { name: "Alertas de contas", exact: true },
      ).click();
      await page.screenshot({
        path: `/workspace/preview/alerts-${width}.png`,
        fullPage: true,
      });
    }
    failStatus = true;
    await page.getByRole("button", { name: "Atualizar lista" }).click();
    await page.getByText("Não foi possível atualizar o monitoramento.", {
      exact: true,
    }).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      viewports: [1440, 390, 320],
      reads,
      manualChecks: checks.length,
      errors,
      checks:
        "Sidebar, mobile menu, bulk read failure/success, active read alerts, search, manual cooldown, monitor outage",
    }));
  } catch (e) {
    console.error(
      "Browser diagnostic:",
      page.url(),
      (await page.locator("body").innerText()).slice(0, 3000),
    );
    await page.screenshot({
      path: "/workspace/preview/alerts-error.png",
      fullPage: true,
    });
    throw e;
  } finally {
    await browser.close();
  }
})();
