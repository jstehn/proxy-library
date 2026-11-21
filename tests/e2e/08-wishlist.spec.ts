import { expect, test } from "@playwright/test";

// Wishing for cards and buying one.
test.describe.configure({ mode: "serial" });

test("a player wishes for cards, sees what they can afford, and buys one (design doc 26)", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("rin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTitle("Your wallet")).toHaveText("$45.00");

  // Dawn's Truce, any printing, with a $10 target: the cheapest is $9.82, so it's at target.
  await page.goto("/singles?q=%21%22Dawn%27s+Truce%22");
  await page.getByRole("link", { name: "Dawn's Truce" }).first().click();
  await page.locator("summary", { hasText: "Add to wishlist" }).click();
  await page.getByLabel("Target price").fill("10");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/wishlist-add-phone-dark.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Add to wishlist" }).click();
  await expect(page.getByText("Added to your wishlist.")).toBeVisible();
  await expect(page.getByText(/★ On your wishlist: 1 copy, any printing/)).toBeVisible();
  await expect(page.locator('[title="1 at or under your target price"]:visible')).toBeVisible();

  // Lumra, only this printing in foil: far more than Rin has.
  await page.goto("/singles?q=%21%22Lumra%2C+Bellow+of+the+Woods%22");
  await page.getByRole("link", { name: "Lumra, Bellow of the Woods" }).first().click();
  await page.locator("summary", { hasText: "Add to wishlist" }).click();
  await page.getByLabel("Only this printing").check();
  await page.getByLabel("Finish").selectOption("foil");
  await page.getByRole("button", { name: "Add to wishlist" }).click();
  await expect(page.getByText("Added to your wishlist.")).toBeVisible();

  // The list: the one at target first, then the one she's short of.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: /^Wishlist\b/ })
    .click();
  const rows = page.getByRole("main").getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Dawn's Truce");
  await expect(rows.nth(0)).toContainText("You can afford this");
  await expect(rows.nth(1)).toContainText("Lumra, Bellow of the Woods");
  await expect(rows.nth(1)).toContainText(/\$[\d,.]+ short/);

  // Screenshots for review: dark mode, and a phone's width (user preference).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/wishlist-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/wishlist-phone-dark.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });

  // Buying the Truce fills the wish, so it leaves the list and lands in her collection.
  await rows.nth(0).getByRole("button", { name: "Buy ($9.82)" }).click();
  await expect(
    page.getByText("Bought Dawn's Truce for $9.82. That was every copy you wanted"),
  ).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTitle("Your wallet")).toHaveText("$35.18");

  // Remove takes a wish off without buying.
  await rows.nth(0).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Your wishlist is empty.")).toBeVisible();

  // A wish for Starting over to clear (next test).
  await page.goto("/singles?q=%21%22Dawn%27s+Truce%22");
  await page.getByRole("link", { name: "Dawn's Truce" }).first().click();
  await page.locator("summary", { hasText: /Add (to wishlist|or change a wish)/ }).click();
  await page.getByRole("button", { name: "Add to wishlist" }).click();
  await expect(page.getByText("Added to your wishlist.")).toBeVisible();
});
