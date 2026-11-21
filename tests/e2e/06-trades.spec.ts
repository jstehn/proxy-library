import { expect, test } from "@playwright/test";
import { openAdminPage, register } from "./helpers";

// A player offers money for a card.
test.describe.configure({ mode: "serial" });

test("a new player offers money for one of the admin's cards, and the admin accepts", async ({
  page,
  browser,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await openAdminPage(page, "Invites");
  await page.getByRole("button", { name: "Create invite" }).click();
  // Read the new code from the confirmation (the list below also shows test 1's used invite).
  const inviteCode = await page
    .getByText(/^New invite/)
    .locator("code")
    .first()
    .innerText();

  // Rin joins and offers $5.00 for a Plains from the admin's collection.
  const rinContext = await browser.newContext();
  const rin = await rinContext.newPage();
  await rin.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await rin.goto(`/register?invite=${inviteCode}`);
  await register(rin, "rin", "Rin");
  await rin.getByRole("link", { name: "Trades", exact: true }).click();
  await rin.getByRole("link", { name: "New trade" }).click();
  await rin.getByRole("link", { name: "Admin" }).click();
  await rin.getByLabel("Search their cards").fill("Plains");
  await rin.getByLabel("Search their cards").press("Enter");
  // No waiting between the steps: the controls always build on the latest change, even while
  // the page for the previous one is still loading (this used to drop the card).
  await expect(rin.getByRole("button", { name: /^Add Plains/ }).first()).toBeVisible();
  await rin
    .getByRole("button", { name: /^Add Plains/ })
    .first()
    .click();
  await rin.getByLabel("Money you give").fill("5.00");
  await rin.getByLabel("Money you give").press("Enter");
  await rin.getByRole("button", { name: "Propose trade" }).click();
  await expect(rin.getByRole("heading", { name: "Trade: Rin ⇄ Admin" })).toBeVisible();
  await expect(rin.getByText("1 × Plains")).toBeVisible();
  await expect(rin.getByText("$5.00", { exact: true })).toBeVisible();

  // The admin sees the badge, opens the trade and accepts it.
  await page.goto("/");
  await expect(page.locator(`[title="1 waiting for you"]:visible`)).toBeVisible();
  const balanceBefore = await page.getByTitle("Your wallet").innerText();
  await page
    .getByRole("link", { name: /^Trades\b/ })
    .first()
    .click();
  await page.getByRole("link", { name: "From Rin" }).click();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText(/^accepted ·/)).toBeVisible();
  await expect(page.getByTitle("Your wallet")).not.toHaveText(balanceBefore);

  // Rin now owns the Plains, and paid $5.00.
  await rin.goto("/collection"); // a fresh load, not the browser's cached copy
  await expect(rin.getByText(/1 cards \(1 different\)/)).toBeVisible();
  await expect(rin.getByTitle("Your wallet")).toHaveText("$45.00");
  await rinContext.close();
});
