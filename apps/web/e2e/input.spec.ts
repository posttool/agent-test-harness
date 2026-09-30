import { expect, test, type Page } from "@playwright/test";

const phone = (page: Page) => page.frameLocator('[data-testid="experience"]');

async function fresh(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Agent Harness")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Clear memory" }).click();
  await expect(page.getByText("Memory is empty.")).toBeVisible();
}

/** Another client drives the agent, so this page's phone keeps getting new state. */
async function busyElsewhere(page: Page, text: string) {
  const other = await page.context().browser()!.newPage();
  await other.goto("/");
  // The phone is one shared device, so it is already unlocked here.
  await phone(other).getByTestId("input").fill(text);
  await phone(other).getByTestId("send").click();
  return other;
}

test("text typed in the input bar survives redraws while the agent is busy", async ({ page }) => {
  await fresh(page);
  const p = phone(page);
  await p.getByTestId("unlock").click();
  const input = p.getByTestId("input");
  await input.click();
  await input.pressSequentially("remind me to call ");

  const other = await busyElsewhere(page, "Buy my sister a sweater");
  await expect(p.getByText("Needs your answer")).toBeVisible(); // this phone redrew
  await expect(input).toHaveValue("remind me to call ");
  await expect(input).toBeFocused();
  await page.keyboard.type("Mom");
  await expect(input).toHaveValue("remind me to call Mom");
  await other.close();
});

test("text typed in a form field on the phone survives redraws", async ({ page }) => {
  await fresh(page);
  const p = phone(page);
  await p.getByTestId("unlock").click();
  await p.getByTestId("input").fill("Buy my sister a sweater");
  await p.getByTestId("send").click();
  await p.getByTestId("nav-spaces").click();
  const note = p.locator('[data-field="note"]');
  await note.click();
  await note.pressSequentially("size M, ");

  const other = await busyElsewhere(page, "Another errand");
  await expect(p.getByRole("button", { name: /Sweater color/ })).toHaveCount(2); // a second question arrived
  await expect(note.first()).toHaveValue("size M, ");
  await page.keyboard.type("no wool");
  await expect(note.first()).toHaveValue("size M, no wool");
  await other.close();
});

test("one spoken utterance is sent to the agent exactly once", async ({ page }) => {
  // A fake recognizer that behaves like the buggy case: the same final result twice.
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "en";
      onresult: (e: unknown) => void = () => {};
      onend: () => void = () => {};
      onerror: () => void = () => {};
      start() {
        const result = Object.assign([{ transcript: "hello from voice" }], { isFinal: true });
        setTimeout(() => this.onresult({ results: [result] }), 50);
        setTimeout(() => this.onresult({ results: [result, result] }), 100);
        setTimeout(() => this.onend(), 200);
      }
      stop() {
        this.onend();
      }
    }
    const w = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown };
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
  await fresh(page);
  const p = phone(page);
  await p.getByTestId("unlock").click();
  await p.getByTestId("mic").click();

  await page.getByRole("tab", { name: "Traces" }).click();
  await expect(page.locator(".collapsible-head", { hasText: "hello from voice" })).toHaveCount(1);
  await page.waitForTimeout(1000);
  await expect(page.locator(".collapsible-head", { hasText: "hello from voice" })).toHaveCount(1);
  await expect(p.getByTestId("input")).toHaveValue("");
});
