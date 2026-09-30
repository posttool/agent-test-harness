import { expect, test, type Page } from "@playwright/test";

const phone = (page: Page) => page.frameLocator('[data-testid="experience"]');

async function clear(page: Page) {
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Clear memory" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Agent Harness")).toBeVisible();
  await clear(page);
});

test("starts blank", async ({ page }) => {
  await expect(page.getByText("Memory is empty.")).toBeVisible();
  await page.getByRole("tab", { name: "Traces" }).click();
  await expect(page.getByText("No reasoning yet.")).toBeVisible();
  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByText("No data streams.")).toBeVisible();
  await expect(phone(page).getByTestId("lock-screen")).toBeVisible();
});

test("toggles dark and light mode", async ({ page }) => {
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByTitle("Toggle theme").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
  await page.getByTitle("Toggle theme").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(before);
});

test("a disambiguation round-trips from the phone to the loop and back", async ({ page }) => {
  const p = phone(page);
  await p.getByTestId("unlock").click();
  await p.getByTestId("input").fill("Buy my sister a sweater");
  await p.getByTestId("send").click();

  await expect(p.getByText("Needs your answer")).toBeVisible();
  await p.getByTestId("nav-spaces").click();
  await expect(p.getByRole("heading", { name: "Sweater color" })).toBeVisible();
  await p.getByTestId("choice").filter({ hasText: "Blue" }).click();

  await page.getByRole("tab", { name: "Traces" }).click();
  await expect(page.getByText("Sweater for my sister").first()).toBeVisible();
  await expect(page.locator(".badge", { hasText: "ended" }).first()).toBeVisible();
  await expect(p.getByText("Needs your answer")).toHaveCount(0);
});

test("clear memory resets traces and the phone", async ({ page }) => {
  await phone(page).getByTestId("unlock").click();
  await phone(page).getByTestId("input").fill("hello");
  await phone(page).getByTestId("send").click();
  await page.getByRole("tab", { name: "Traces" }).click();
  await expect(page.getByText("Sweater for my sister").first()).toBeVisible();
  await clear(page);
  await expect(page.getByText("No reasoning yet.")).toBeVisible();
});

test("two clients share one live agent (cross-device)", async ({ page, browser }) => {
  const other = await browser.newPage();
  await other.goto("/");
  await expect(other.getByText("2 clients")).toBeVisible();
  await other.getByRole("tab", { name: "Traces" }).click();

  await phone(page).getByTestId("unlock").click();
  await phone(page).getByTestId("input").fill("Buy my sister a sweater");
  await phone(page).getByTestId("send").click();

  await expect(other.getByText("Sweater for my sister").first()).toBeVisible();
  await expect(phone(other).getByText("Needs your answer")).toBeVisible();
  await other.close();
});

test("the skin asks the agent for the weather and shows it (skin need)", async ({ page }) => {
  const p = phone(page);
  await p.getByTestId("unlock").click();
  await expect(p.getByTestId("weather")).toContainText("14°C · Rain from 6pm");
  await page.getByRole("tab", { name: "Traces" }).click();
  await expect(page.getByText("Weather for the phone").first()).toBeVisible();
});

test("plays the Liquid Glass Claude Design skin in a sandboxed frame", async ({ page }) => {
  const problems: string[] = [];
  // Script errors and CSP refusals fail the test; a font the network can't reach does not.
  page.on("pageerror", (e) => void problems.push(e.message));
  page.on("console", (m) => void (m.type() === "error" && m.text().includes("Refused") && problems.push(m.text())));
  await page.getByTestId("skin-picker").selectOption("liquid-glass");
  const frame = page.getByTestId("experience");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const p = phone(page);
  // The lock screen renders the design (its static chrome is the designer's).
  await expect(p.getByText("Swipe up to open")).toBeVisible();
  // The Dynamic Island expands through the design's own logic.
  const island = p.locator("button[aria-expanded]");
  await island.click();
  await expect(island).toHaveAttribute("aria-expanded", "true");
  // Swiping to Home in the design unlocks the phone in the runtime.
  await p.getByRole("link", { name: "Swipe up to open home screen" }).click();
  await expect(p.locator('a[href="Main.dc.html"]')).toBeVisible();
  await expect(p.getByText("Swipe up to open")).toHaveCount(0);
  await page.getByTestId("skin-picker").selectOption("default");
  await expect(phone(page).getByTestId("nav-home")).toBeVisible();
  expect(problems).toEqual([]);
});

test("the bound Liquid Glass skin shows live harness data, not the designer's copy", async ({ page }) => {
  await page.getByTestId("skin-picker").selectOption("liquid-glass");
  const p = phone(page);
  // The clock is the harness's virtual time; the designer's "9:41" and brief copy are gone.
  const meta = (await page.locator(".experience-meta").innerText()).split("·")[1]!.trim();
  await expect(p.getByText(meta.slice(11, 16), { exact: true }).first()).toBeVisible();
  await expect(p.getByText("Design review at 10:30", { exact: false })).toHaveCount(0);
  // Opening the Brief screen asks the agent for the weather (a skin need), which fills it in.
  await p.getByRole("link", { name: "Open brief" }).click();
  await expect(p.getByText("14°C").first()).toBeVisible();
  // With no brief items, waiting messages or calendar, those lists are empty rather than sample copy.
  await expect(p.getByText("Can you look at deck v3", { exact: false })).toHaveCount(0);
});

test("serves the Claude Design skin page with a strict content security policy", async ({ request }) => {
  const res = await request.get("/dc-skin.html");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("font-src https://fonts.gstatic.com");
  const skins = (await (await request.get("/api/skins")).json()) as { id: string }[];
  expect(skins.map((s) => s.id)).toEqual(["default", "liquid-glass"]);
  expect((await request.get("/api/skins/..%2Fpackage.json")).status()).toBe(404);
});
