// npm install --no-save playwright; npx playwright install chromium
// With the dev server running: node scripts/test-instagram-mobile.cjs
// Fixtures intercept all Supabase requests; no production data is read or written.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const url =
  process.env.VITE_SUPABASE_URL ||
  fs
    .readFileSync(".env", "utf8")
    .match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1];
const project = new URL(url).hostname.split(".")[0],
  uid = "11111111-1111-1111-1111-111111111111";
const base = {
  id: "a1",
  user_id: uid,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const today = new Date();
today.setHours(14, 0, 0, 0);
const fixture = {
  instagram_projects: [{ ...base, id: "p1", name: "Bianca", image_url: null }],
  instagram_accounts: [
    {
      ...base,
      username: "bianca.principal",
      name: "Bianca",
      status: "active",
      project_id: "p1",
      responsible: "Mariana",
      notes: "Preparar conteúdos e revisar a bio.",
      avatar_url: null,
    },
  ],
  instagram_labels: [{ ...base, id: "l1", name: "Principal" }],
  instagram_account_labels: [
    { ...base, id: "al1", account_id: "a1", label_id: "l1" },
  ],
  instagram_contents: [
    {
      ...base,
      id: "c1",
      account_id: "a1",
      title: "Bastidores do projeto",
      format: "Reel",
      status: "scheduled",
      planned_at: today.toISOString(),
      caption: "Uma nova semana de ideias.",
    },
  ],
  instagram_tasks: [
    {
      ...base,
      id: "t1",
      account_id: "a1",
      title: "Atualizar link da bio",
      due_at: today.toISOString(),
      status: "todo",
      priority: "high",
    },
  ],
  instagram_metrics: [
    {
      ...base,
      id: "m1",
      account_id: "a1",
      recorded_on: "2026-09-13",
      followers: 11820,
      following: 90,
      posts: 31,
    },
    {
      ...base,
      id: "m2",
      account_id: "a1",
      recorded_on: "2026-09-20",
      followers: 12450,
      following: 95,
      posts: 35,
    },
  ],
  instagram_history: [
    {
      ...base,
      id: "h1",
      account_id: "a1",
      action: "instagram_accounts:insert",
      details: { status: "active" },
    },
  ],
};
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ project, uid }) => {
      localStorage.setItem(
        `sb-${project}-auth-token`,
        JSON.stringify({
          access_token: "test-only-token",
          refresh_token: "test-only-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: uid,
            aud: "authenticated",
            role: "authenticated",
            email: "test@example.invalid",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { project, uid },
  );
  await page.route(`${url}/**`, async (route) => {
    const u = new URL(route.request().url());
    const table = u.pathname.split("/").pop();
    if (u.pathname.includes("/auth/"))
      return route.fulfill({
        json: { id: uid, email: "test@example.invalid" },
      });
    let rows = fixture[table] || [];
    const method = route.request().method();
    if (method === "POST") {
      const value = route.request().postDataJSON();
      const row = { ...base, ...value, id: `new-${Date.now()}` };
      rows.push(row);
      return route.fulfill({ json: row });
    }
    if (method === "PATCH") {
      const id = u.searchParams.get("id")?.replace("eq.", "");
      const row = rows.find((r) => r.id === id);
      Object.assign(row, route.request().postDataJSON());
      return route.fulfill({ json: row });
    }
    if (method === "DELETE") {
      const id = u.searchParams.get("id")?.replace("eq.", "");
      fixture[table] = rows.filter((r) => r.id !== id);
      return route.fulfill({ json: { id } });
    }
    return route.fulfill({ json: rows });
  });
  const check = async (label, width) => {
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    assert.ok(
      overflow.scroll <= overflow.width,
      `${label} overflows at ${width}: ${JSON.stringify(overflow)}`,
    );
  };
  for (const width of [320, 360, 375, 390, 412, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:8080/instagram");
    await page.getByRole("link", { name: "Gerenciar" }).waitFor();
    await check("dashboard", width);
    await page.getByRole("button", { name: "Nova conta", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await check("account form", width);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("link", { name: "Gerenciar" }).click();
    for (const tab of [
      "Visão geral",
      "Conteúdos",
      "Calendário",
      "Tarefas",
      "Métricas",
      "Informações",
      "Histórico",
    ]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await check(tab, width);
    }
    await page.goto("http://127.0.0.1:8080/instagram/hoje");
    await page.getByText("Atualizar link da bio", { exact: true }).waitFor();
    await check("Hoje", width);
    console.log(`PASS mobile ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:8080/instagram");
  await page.getByRole("link", { name: "Gerenciar" }).waitFor();
  await page.screenshot({ path: "/tmp/instagram-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Projetos e etiquetas" }).click();
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await page.getByLabel("Nome do projeto *").fill("Projeto teste");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.ok(fixture.instagram_projects.some((p) => p.name === "Projeto teste"));
  await page.goto("http://127.0.0.1:8080/instagram/hoje");
  await page
    .getByRole("checkbox", { name: "Concluir Atualizar link da bio" })
    .click();
  await page.waitForTimeout(300);
  assert.equal(fixture.instagram_tasks[0].status, "done");
  await page.goto("http://127.0.0.1:8080/instagram/conta/a1");
  await page.getByRole("button", { name: "Calendário", exact: true }).click();
  await page
    .getByRole("button", { name: "Adicionar conteúdo", exact: true })
    .click();
  assert.ok(await page.locator("#ig-planned_at").inputValue());
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Informações", exact: true }).click();
  await page
    .getByRole("button", { name: "Excluir conta", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancelar" }).click();
  assert.equal(fixture.instagram_accounts.length, 1);
  assert.deepEqual(errors, []);
  console.log("PASS UI workflows and no browser exceptions");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
