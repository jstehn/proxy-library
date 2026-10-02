import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

// The tests share one database and build on each other, so they run in order.
test.describe.configure({ mode: "serial" });

// The whole accounts journey from design doc 02, section 12, in a real browser:
// first visitor becomes admin → creates an invite → a second player registers with it →
// the admin gives and takes money → the admin disables them → they can no longer get in.

/** Admin pages live behind the "Admin" link, in their own menu. */
async function openAdminPage(page: Page, name: string) {
  await page.locator(`header a[href="/admin"]:visible`).click(); // not the account link, also "Admin"
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name }).click();
}

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
  await openAdminPage(page, "Invites");
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
  await openAdminPage(page, "Players");
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

  // The admin resets Jack's library, after typing his username to confirm (design doc 12).
  await openAdminPage(page, "Players");
  const jackReset = page.getByRole("listitem").filter({ hasText: "@jack" });
  await jackReset.getByText("Reset library…").click();
  await jackReset.getByLabel("Type jack to confirm").fill("jak");
  await jackReset.getByRole("button", { name: "Reset library" }).click();
  await expect(jackReset.getByText("Type jack to confirm.")).toBeVisible();
  await jackReset.getByLabel("Type jack to confirm").fill("jack");
  await jackReset.getByRole("button", { name: "Reset library" }).click();
  await expect(jackReset.getByText("Balance is now $50.00.")).toBeVisible();
  await player.goto("/wallet");
  await expect(player.getByText("Library reset by admin")).toBeVisible();

  // The admin disables Jack.
  await openAdminPage(page, "Players");
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
  await openAdminPage(page, "Catalog");
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
  // (The fixtures also hold a Japanese-only Beza, so there are two; hover the first.)
  await page
    .getByRole("button", { name: "Beza, the Bounding Spring: show card text" })
    .first()
    .hover();
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

  await openAdminPage(page, "Pack lab");
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

  // Wizards' official photo (design doc 13), served from our disk, and WPN's product details.
  const photo = pack.locator('img[src^="/api/artwork/"]');
  await photo.scrollIntoViewIfNeeded(); // it loads lazily, when it comes into view
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  // It fits inside its box (the same size as the generated art), whatever the photo's shape.
  const [photoBox, frameBox] = await Promise.all([
    photo.boundingBox(),
    photo.locator("..").boundingBox(),
  ]);
  expect(photoBox && frameBox).toBeTruthy();
  expect(photoBox!.height).toBeLessThanOrEqual(frameBox!.height + 1);
  expect(photoBox!.width).toBeLessThanOrEqual(frameBox!.width + 1);
  await pack.getByText("What's inside").click();
  await expect(pack.getByText("From Wizards of the Coast's product page.")).toBeVisible();
  await expect(
    page.getByText(/unofficial Fan Content permitted under the Fan Content Policy/),
  ).toBeVisible();
  await pack.getByRole("button", { name: "Buy" }).click();
  await expect(pack.getByText(/waiting in your inventory/)).toBeVisible();
  await expect(page.getByTitle("Your wallet")).toHaveText("$44.51");

  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Open Bloomburrow Play Booster Pack" }).click();

  // The opener (design doc 08), with "reduce motion" on so it runs without waiting on animations.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Tear open Bloomburrow Play Booster Pack" }).click();
  await expect(page.getByRole("button", { name: /^Face-down card/ })).toHaveCount(14);
  await page.getByRole("button", { name: "Reveal next" }).click();
  await expect(page.getByRole("button", { name: /^Face-down card/ })).toHaveCount(13);
  await page.getByRole("button", { name: "Reveal all" }).click();
  await expect(page.getByText(/This pack is worth \$\d+\.\d\d at market price/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

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

test("the admin builds a Commander deck from a pasted list and exports it", async ({ page }) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));

  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByLabel("Deck name").fill("Beza's Bounty");
  await page.getByLabel("Format").selectOption("commander");
  await page.getByRole("button", { name: "Create deck" }).click();
  await expect(page.getByRole("heading", { name: "Beza's Bounty" })).toBeVisible();

  await page
    .getByLabel("Paste a deck list")
    .fill("Commander\n1 Beza, the Bounding Spring\nDeck\n97 Plains\n1 Card That Does Not Exist");
  await page.getByRole("button", { name: "Add these cards" }).click();
  await expect(
    page.getByText(/Added 98 cards\. Not in the catalog: Card That Does Not Exist\./),
  ).toBeVisible();

  // 98 cards (needs 100): reported, but it doesn't block building. (Whether Beza is owned depends
  // on the random pack test 4 opened, so shortages are tested in the unit and integration tests.)
  const problems = page.getByRole("region", { name: "Problems" });
  await expect(problems.getByText("The deck has 98 cards; it needs exactly 100.")).toBeVisible();
  const stats = page.getByRole("region", { name: "Deck statistics" });
  await expect(stats.getByText("Land", { exact: true })).toBeVisible();
  await expect(stats.getByText("98 / 100")).toBeVisible();

  // Browse the collection: search, select a card (it's shown large), choose a quantity, add.
  await page.getByRole("searchbox", { name: "Search your cards" }).fill("t:basic plains");
  const collection = page.getByRole("list", { name: "Cards you own" });
  await collection.getByRole("button", { name: /^Plains, you own \d+, 97 in this deck$/ }).click();
  const selected = page.getByRole("region", { name: "Selected: Plains" });
  await selected.getByRole("button", { name: "One more to add" }).click();
  await selected.getByRole("button", { name: "One more to add" }).click();
  await selected.getByRole("button", { name: "One fewer to add" }).click();
  await selected.getByRole("button", { name: "Add to deck" }).click();
  await expect(page.getByText("Added 2 Plains (now 99).")).toBeVisible();
  await expect(stats.getByText("100 / 100")).toBeVisible(); // the statistics follow at once
  await expect(problems.getByText(/The deck has \d+ cards/)).toHaveCount(0);

  // The deck list's own controls, and hovering a name previews the card.
  const deckList = page.getByRole("region", { name: "Deck list" });
  await deckList.getByRole("button", { name: "One fewer Plains" }).click();
  await expect(stats.getByText("99 / 100")).toBeVisible();
  await expect(problems.getByText("The deck has 99 cards; it needs exactly 100.")).toBeVisible();
  await deckList.getByRole("button", { name: "One more Plains" }).click();
  await expect(stats.getByText("100 / 100")).toBeVisible();
  await deckList.getByRole("button", { name: "Plains", exact: true }).hover();
  await expect(page.locator("[data-card-preview]")).toBeVisible();

  // Proxies: choose options, see what they make, and download the PDF.
  await page.getByRole("link", { name: "Print proxies" }).click();
  await expect(page.getByText(/^1 card on 1 page, 9 to a page\./)).toBeVisible(); // Beza; Plains skipped
  await page.getByText("Include them").click();
  await page.getByText("1/8 inch (3 mm)").click();
  await expect(page.getByText(/^100 cards on 17 pages, 6 to a page \(sideways\)\./)).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Bezas Bounty proxies.pdf");
  const pdf = readFileSync(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(17);
  await page.getByRole("link", { name: "Back to the deck" }).click();

  await page.getByRole("link", { name: "Export" }).click();
  await expect(page.getByLabel("Deck list, names only")).toHaveValue(
    "Commander\n1 Beza, the Bounding Spring\n\nDeck\n99 Plains",
  );

  await page.getByRole("link", { name: "Decks", exact: true }).first().click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Beza's Bounty" })
      .getByText(/^(short \d+|all owned)$/),
  ).toBeVisible();
});

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
  await expect(page.getByText(/^\d+ cards \(1 different\)/)).toBeVisible();
});

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
  await page.getByRole("link", { name: /^Trades\s*\d*$/ }).click();
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

test("the home page shows recent activity, and the collection downloads as a file", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Earlier tests bought a pack and traded; the feed shows both, without prices for purchases.
  await expect(page.getByText("Admin bought Bloomburrow Play Booster Pack")).toBeVisible();
  await expect(page.getByText(/Admin and Rin traded 1 card and some money/)).toBeVisible();

  await page.getByRole("link", { name: "Collection", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Moxfield CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("collection-moxfield.csv");
  const text = await (await file.createReadStream()).toArray();
  expect(Buffer.concat(text).toString("utf8")).toMatch(/^Count,Tradelist Count,Name,Edition/);
});

test("on a phone, the main menu folds into a Menu button", async ({ browser }) => {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await phone.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Decks", exact: true })).toBeHidden();
  await page.getByText("Menu", { exact: true }).click();
  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Decks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Decks", exact: true })).toBeHidden(); // closed after navigating
  await phone.close();
});

test("a player starts over from their Account page, after a clear warning", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("rin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.locator('header a[href="/account"]:visible').click();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText("Every card is wiped")).toBeVisible();
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
});

/** Signs in on a page of its own browser context. */
async function signIn(page: Page, username: string) {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTitle("Your wallet")).toBeVisible();
}

/** The pick screen's heading ("Round 1 of 3, pick 4 …"), or "" when there's none. */
async function pickHeading(page: Page): Promise<string> {
  const heading = page.getByRole("heading", { name: /^Round \d of 3, pick \d+/ });
  return (await heading.count()) === 0 ? "" : ((await heading.textContent()) ?? "");
}

/**
 * Picks the first card of the pack in front of this player, if there is one, and waits for the
 * page to move on. Returns whether it picked.
 */
async function pickFirstCard(page: Page): Promise<boolean> {
  const pack = page.getByRole("list", { name: "Your pack" });
  if (!(await pack.isVisible())) return false;
  const before = await pickHeading(page);
  await pack.getByRole("button").first().dblclick();
  await expect.poll(() => pickHeading(page)).not.toBe(before);
  return true;
}

test("two players draft live together, and each gets a draft deck (design doc 17)", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  // Rin hosts (she has $50 after starting over); the admin joins.
  const rinContext = await browser.newContext();
  const rin = await rinContext.newPage();
  await signIn(rin, "rin");
  await rin.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect(rin.getByRole("heading", { name: "Drafts", exact: true })).toBeVisible();
  await rin.getByLabel("Players, at most").selectOption("2");
  await rin.getByLabel("Pick timer").selectOption("off");
  await rin.getByRole("button", { name: "Host and pay the fee" }).click();
  await expect(rin.getByRole("heading", { name: /Bloomburrow draft/ })).toBeVisible();
  await expect(rin.getByText("live", { exact: true })).toBeVisible();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, "admin");
  await admin.getByRole("link", { name: "Drafts", exact: true }).click();
  await admin.getByRole("button", { name: /^Join for \$/ }).click();
  await expect(admin.getByRole("heading", { name: /Bloomburrow draft/ })).toBeVisible();

  // Rin's lobby shows the admin arrive without a reload (ADR 0018), and she starts.
  await expect(rin.getByRole("listitem").filter({ hasText: "Admin" })).toBeVisible();
  await rin.getByRole("button", { name: "Start the draft" }).click();
  // The admin's page moves to the first pick by itself.
  await expect(admin.getByRole("heading", { name: /^Round 1 of 3, pick 1/ })).toBeVisible();
  // Basic lands were taken out of the packs (and dealt to the players), so a pack has 14 cards
  // or fewer.
  const packSize = await admin.getByRole("list", { name: "Your pack" }).getByRole("button").count();
  expect(packSize).toBeGreaterThanOrEqual(12);
  expect(packSize).toBeLessThanOrEqual(14);

  // Both draft every card. Halfway, Rin reloads the page and carries on where she was.
  let picks = 0;
  let reloaded = false;
  for (let turn = 0; turn < 300; turn += 1) {
    const finished = await rin.getByText(/Your \d+ cards are in your collection/).isVisible();
    if (finished && (await admin.getByText(/Your \d+ cards/).isVisible())) break;
    for (const player of [rin, admin]) if (await pickFirstCard(player)) picks += 1;
    if (!reloaded && picks >= 40) {
      reloaded = true;
      await rin.reload();
      await expect(rin.getByRole("heading", { name: /^Round 2 of 3/ })).toBeVisible();
    }
  }
  expect(picks).toBeGreaterThan(70); // 2 players × 3 packs × 14 cards, less the basics

  // Each player's deck is waiting: a 40-card limited deck with a Draft badge.
  await expect(
    rin.getByText(
      /Your \d+ cards are in your collection, with \d+ basic lands dealt from the packs/,
    ),
  ).toBeVisible();
  await rin.getByRole("link", { name: "Open your deck" }).click();
  await expect(rin.getByText(/Limited/).first()).toBeVisible();
  await rin.goto("/decks?show=drafts");
  await expect(rin.getByRole("link", { name: "Draft", exact: true })).toBeVisible();
  await expect(rin.getByText(/Bloomburrow draft, \d+ \w+/)).toBeVisible();

  // The feed tells everyone.
  await admin.goto("/activity");
  await expect(admin.getByText("Rin hosted a Bloomburrow draft for 2 players")).toBeVisible();

  await rinContext.close();
  await adminContext.close();
});

test("an admin tests a draft alone against a bot, which picks at once", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const admin = await context.newPage();
  await signIn(admin, "admin");
  // Two entry fees (the admin's and the bot's): the admin gives themselves the money.
  await openAdminPage(admin, "Players");
  const adminMoney = admin.getByRole("listitem").filter({ hasText: "@admin" });
  await adminMoney.getByLabel("Amount for @admin").fill("100");
  await adminMoney.getByLabel("Note for @admin").fill("Testing drafts");
  await adminMoney.getByRole("button", { name: "Give" }).click();
  await expect(adminMoney.getByText("Gave $100.00.")).toBeVisible();

  await admin.getByRole("link", { name: "Drafts", exact: true }).click();
  await admin.getByLabel("Players, at most").selectOption("2");
  await admin.getByLabel("Pick timer").selectOption("off");
  await admin.getByRole("button", { name: "Host and pay the fee" }).click();
  await admin.getByRole("button", { name: /^Add a bot/ }).click();
  await expect(admin.getByText("Bot 1")).toBeVisible();
  await admin.getByRole("button", { name: "Start the draft" }).click();
  await expect(admin.getByRole("heading", { name: /^Round 1 of 3, pick 1/ })).toBeVisible();

  // The bot never keeps the admin waiting: there's always a pack until the draft ends.
  for (let turn = 0; turn < 100; turn += 1) {
    if (await admin.getByText(/Your \d+ cards are in your collection/).isVisible()) break;
    expect(await pickFirstCard(admin)).toBe(true);
  }
  await expect(admin.getByText(/and the \d+ cards your bots picked/)).toBeVisible();
  await context.close();
});
