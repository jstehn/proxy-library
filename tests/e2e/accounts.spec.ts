import { expect, test, type Page } from "@playwright/test";

// The tests share one database and build on each other, so they run in order.
test.describe.configure({ mode: "serial" });

// The whole accounts journey from design doc 02, section 12, in a real browser:
// first visitor becomes admin → creates an invite → a second player registers with it →
// the admin gives and takes money → the admin disables them → they can no longer get in.

async function register(page: Page, username: string, displayName: string) {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
}

test("first admin invites a player, manages their money, then disables them", async ({
  page,
  browser,
}) => {
  // Signed-out visitors are sent to sign in.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);

  // The very first player needs no invite and becomes the admin.
  await page.goto("/register");
  await expect(page.getByText("The first account becomes the admin")).toBeVisible();
  await register(page, "admin", "Admin");
  await expect(page.getByRole("heading", { name: "Welcome, Admin" })).toBeVisible();

  // The admin creates an invite and reads the code off the page.
  await page.getByRole("link", { name: "Invites" }).click();
  await page.getByRole("button", { name: "Create invite" }).click();
  const inviteCode = await page.locator("code").first().innerText();
  expect(inviteCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // A second player, in their own browser, registers with the shared link.
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await player.goto(`/register?invite=${inviteCode}`);
  await expect(player.getByLabel("Invite code")).toHaveValue(inviteCode);
  await register(player, "jack", "Jack");
  await expect(player.getByRole("heading", { name: "Welcome, Jack" })).toBeVisible();

  // The invite now shows as used.
  await page.reload();
  await expect(page.getByText("used by @jack")).toBeVisible();

  // --- Wallet (design doc 03) ---
  // Jack's wallet opened with the $50 starting grant, shown in his header.
  await expect(player.getByRole("link", { name: "$50.00" })).toBeVisible();

  // The admin gives Jack $25, then takes $10 back, each with a note.
  await page.getByRole("link", { name: "Players" }).click();
  const jackMoney = page.getByRole("listitem").filter({ hasText: "@jack" });
  await jackMoney.getByLabel("Amount for @jack").fill("25");
  await jackMoney.getByLabel("Note for @jack").fill("Won Friday's draft");
  await jackMoney.getByRole("button", { name: "Give" }).click();
  await expect(jackMoney.getByText("Gave $25.00.")).toBeVisible();

  await jackMoney.getByLabel("Amount for @jack").fill("10.00");
  await jackMoney.getByLabel("Note for @jack").fill("Typo in last grant");
  await jackMoney.getByRole("button", { name: "Take away" }).click();
  await expect(jackMoney.getByText("Took away $10.00.")).toBeVisible();

  // A balance can never go below $0.
  await jackMoney.getByLabel("Amount for @jack").fill("1000");
  await jackMoney.getByLabel("Note for @jack").fill("Too much");
  await jackMoney.getByRole("button", { name: "Take away" }).click();
  await expect(jackMoney.getByText("They only have $65.00")).toBeVisible();

  // Jack sees his balance and the history with the notes.
  await player.goto("/wallet");
  await expect(player.getByRole("heading", { name: "Wallet" })).toBeVisible();
  await expect(player.getByText("$65.00").first()).toBeVisible();
  await expect(player.getByText("Won Friday's draft")).toBeVisible();
  await expect(player.getByText("Typo in last grant")).toBeVisible();

  // The admin disables Jack.
  await page.getByRole("link", { name: "Players" }).click();
  const jackRow = page.getByRole("listitem").filter({ hasText: "@jack" });
  await jackRow.getByRole("button", { name: "Disable" }).click();
  await expect(jackRow.getByText("disabled", { exact: true })).toBeVisible();

  // Jack's open browser is signed out, and signing in again is refused.
  await player.goto("/");
  await expect(player).toHaveURL(/\/sign-in$/);
  await player.getByLabel("Username").fill("jack");
  await player.getByLabel("Password").fill("secret-password");
  await player.getByRole("button", { name: "Sign in" }).click();
  await expect(player.getByText("This account has been disabled")).toBeVisible();

  await playerContext.close();
});

test("the admin browses the catalog (loaded from recorded fixtures)", async ({ page }) => {
  // Answer card-image requests locally, so the app never downloads images during the test.
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));

  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Admin" })).toBeVisible();

  // The catalog page shows the fixture sync and Bloomburrow enabled as a Standard set.
  await page.getByRole("link", { name: "Catalog" }).click();
  await expect(page.getByText("succeeded")).toBeVisible();
  // Find the set's row by its exact code ("BLB" also appears inside the sync details).
  const blbRow = page.getByRole("listitem").filter({ has: page.getByText("BLB", { exact: true }) });
  await expect(blbRow.getByText("Standard")).toBeVisible();
  await expect(blbRow.getByRole("button", { name: "Enabled" })).toBeVisible();

  // Players browse sets and cards, with variant labels and prices.
  await page.getByRole("link", { name: "Sets" }).click();
  await page.getByRole("link", { name: /Bloomburrow/ }).click();
  await expect(page.getByRole("heading", { name: "Bloomburrow" })).toBeVisible();
  await expect(page.getByText("Banishing Light")).toBeVisible();
  await expect(page.getByText("Borderless · Showcase").first()).toBeVisible();
  await expect(page.getByText(/Nonfoil \$\d+\.\d\d/).first()).toBeVisible();

  // Hovering a card enlarges it with its printed text and stats laid over the image.
  await page.getByRole("button", { name: "Beza, the Bounding Spring: show card text" }).hover();
  await expect(page.getByText("When Beza enters, create a Treasure token")).toBeVisible();
  await expect(page.getByText("4/5")).toBeVisible();
  await expect(page.getByText("Illustrated by Martin Wittfooth")).toBeVisible();
});

test("the admin opens packs in the Pack lab", async ({ page }) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));

  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Admin" })).toBeVisible();

  await page.getByRole("link", { name: "Pack lab" }).click();
  await page.getByLabel("Booster").selectOption("BLB/play");
  await page.getByLabel("Packs").selectOption("10");
  await page.getByRole("button", { name: "Open packs" }).click();

  await expect(page.getByRole("heading", { name: "10 × Bloomburrow Play booster" })).toBeVisible();
  // Expected vs observed, per rarity: the fixture's play booster always has one rare or mythic.
  const rareRow = page.getByRole("row").filter({ hasText: "Rares" });
  await expect(rareRow).toBeVisible();
  await expect(page.getByText(/Cards inside an average pack are worth \$\d+\.\d\d/)).toBeVisible();

  // Three sample packs of 14 cards, in reveal order.
  for (const number of [1, 2, 3]) {
    await expect(
      page.getByRole("region", { name: `Pack ${number}` }).getByRole("listitem"),
    ).toHaveCount(14);
  }
});

test("the admin buys a pack in the store, opens it, and finds the cards in their collection", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));

  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTitle("Your wallet")).toHaveText("$50.00");

  await page.getByRole("link", { name: "Store", exact: true }).click();
  await page
    .getByRole("link", { name: /Bloomburrow/ })
    .first()
    .click();
  await expect(page.getByText("$5.49")).toBeVisible();
  const pack = page.getByRole("listitem").filter({ hasText: "Bloomburrow Play Booster Pack" });
  await pack.getByRole("button", { name: "Buy" }).click();
  await expect(pack.getByText(/waiting in your inventory/)).toBeVisible();
  await expect(page.getByTitle("Your wallet")).toHaveText("$44.51");

  await page.getByRole("link", { name: "Inventory" }).click();
  await page.getByRole("button", { name: "Open Bloomburrow Play Booster Pack" }).click();
  await expect(page.getByRole("heading", { name: "Opened" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Bloomburrow Play Booster Pack" }).getByRole("listitem"),
  ).toHaveCount(14);

  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await expect(page.getByText(/14 cards \(\d+ different\)/)).toBeVisible();
});

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
  await page.getByLabel("Sort by").selectOption("value");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page).toHaveURL(/sort=value/);
  await page.getByRole("listitem").first().getByRole("link").click();

  await expect(page.getByRole("heading", { name: "Price history" })).toBeVisible();
  await page
    .getByRole("button", { name: /^Sell \(/ })
    .first()
    .click();
  await expect(page.getByText(/^Sold for \$\d+\.\d\d\.$/)).toBeVisible();
  await expect(page.getByTitle("Your wallet")).not.toHaveText(balanceBefore);
  await expect(page.getByText(/Your store history for this card/)).toBeVisible();
});
