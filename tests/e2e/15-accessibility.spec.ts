import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The confirmation dialog (refactor P33): focus stays inside it, Escape closes it, focus returns
// to the button that opened it, and nothing is deleted until the player confirms.
test.describe.configure({ mode: "serial" });

test("deleting a deck needs a confirmation, and the dialog behaves like a dialog", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByLabel("Deck name").fill("Doomed deck");
  await page.getByRole("button", { name: "Create deck" }).click();
  await expect(page.getByRole("heading", { name: "Doomed deck" })).toBeVisible();

  await page.getByText("Deck settings").click();
  const opener = page.getByRole("button", { name: "Delete this deck" });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading")).toContainText("Delete “Doomed deck”?");

  // Tab never reaches the page behind it: focus is on a dialog button, or has left the page for
  // the browser's own controls (then the active element is the body). The page behind is inert.
  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.press("Tab");
    const onPageBehind = await dialog.evaluate((element) => {
      const active = document.activeElement;
      return active !== document.body && !element.contains(active);
    });
    expect(onPageBehind).toBe(false);
  }

  await dialog.getByRole("button", { name: "Cancel" }).focus();
  // Escape closes it, focus goes back to the opener, and the deck is still there.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.getByRole("heading", { name: "Doomed deck" })).toBeVisible();

  // Cancel does nothing either.
  await opener.click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Doomed deck" })).toBeVisible();

  // Confirming deletes it.
  await opener.click();
  await dialog.getByRole("button", { name: "Delete deck" }).click();
  await expect(page).toHaveURL(/\/decks$/);
  await expect(page.getByRole("link", { name: "Doomed deck" })).toHaveCount(0);
});
