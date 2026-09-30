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
