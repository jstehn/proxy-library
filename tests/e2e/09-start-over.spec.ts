import { expect, test } from "@playwright/test";

// A player starts over from the Account page.
test.describe.configure({ mode: "serial" });

test("a player starts over from their Account page, after a clear warning", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("rin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.locator('header a[href="/account"]:visible').click();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText("Every card is wiped")).toBeVisible();
  await expect(page.getByText(/your decks and your wishlist/)).toBeVisible();
  await expect(page.getByText("It does not recover all your funds")).toBeVisible();

  const confirmation = page.getByLabel("Type START OVER to confirm");
  await confirmation.fill("start");
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByText("Type START OVER to confirm.")).toBeVisible();

  await confirmation.fill("start over");
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(
    page.getByText("Done. Your library is empty and your balance is $50.00."),
  ).toBeVisible();
  await expect(page.getByTitle("Your wallet")).toHaveText("$50.00");
  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await expect(page.getByText(/^0 cards/)).toBeVisible();
  // Starting over empties the wishlist too (design doc 26, decision 4).
  await page.goto("/wishlist");
  await expect(page.getByText("Your wishlist is empty.")).toBeVisible();
});
