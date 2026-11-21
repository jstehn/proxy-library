import { expect, test } from "@playwright/test";

// Sorting the collection, and selling a copy to the store.
test.describe.configure({ mode: "serial" });

test("the admin sorts their collection, opens a card, and sells a copy to the store", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));

  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  const balanceBefore = await page.getByTitle("Your wallet").innerText();

  // The pack opened in the previous test: sort it by value and open the most valuable card.
  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await page.getByLabel("Sections").selectOption("none");
  await page.getByLabel("Sort by").selectOption("value");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page).toHaveURL(/sort=value/);
  await page.getByRole("listitem").first().getByRole("link").click();

  await expect(page.getByRole("heading", { name: "Price history" })).toBeVisible();
  // The first finish you actually own: forms for finishes you have none of are disabled.
  await page
    .locator("button:enabled", { hasText: /^Sell \(/ })
    .first()
    .click();
  await expect(page.getByText(/^Sold for \$\d+\.\d\d\.$/)).toBeVisible();
  await expect(page.getByTitle("Your wallet")).not.toHaveText(balanceBefore);
  await expect(page.getByText(/Your store history for this card/)).toBeVisible();
});
