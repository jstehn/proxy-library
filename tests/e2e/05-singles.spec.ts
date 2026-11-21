import { expect, test } from "@playwright/test";

// Buying singles from the store.
test.describe.configure({ mode: "serial" });

test("the admin searches the store with Scryfall syntax and buys a list of singles", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Singles", exact: true })).toBeVisible();

  // The store's search box reads keywords, and says what it ignored.
  await page.goto("/singles?q=kw%3Aflying");
  await expect(page.getByText(/3 cards match\./)).toBeVisible();
  await page.getByLabel("Search cards").fill("kw:flying colour:u");
  await page.getByLabel("Search cards").press("Enter");
  await expect(page.getByText('Unknown keyword "colour:" (ignored)')).toBeVisible();
  await page.getByRole("link", { name: "Search help" }).click();
  await expect(page.getByRole("heading", { name: "Search help" })).toBeVisible();

  // Buy a list: each line priced, a line that can't be bought explained, then buy it all.
  await page.goto("/singles");
  await page.getByRole("link", { name: "Buy a list of cards" }).click();
  await page.getByLabel("Only buy what I don't already own").uncheck();
  await page.getByLabel("Cards to buy").fill("2 Banishing Light\n1 Not A Real Card");
  const quote = page.getByRole("region", { name: "What it would buy" });
  await expect(quote.getByText("⚠ no card by that name")).toBeVisible();
  await expect(quote.getByLabel("Printing of Banishing Light")).toBeVisible();
  await page.getByRole("button", { name: "Buy 2 cards for $0.24" }).click();
  await expect(
    page.getByText("Bought 2 cards for $0.24. They're in your collection."),
  ).toBeVisible();

  await page.goto("/collection?q=%21%22Banishing+Light%22");
  await expect(page.getByRole("heading", { name: "Collection" })).toBeVisible();
  await expect(page.getByText(/^\d+ cards \(\d+ different\)/)).toBeVisible();
});
