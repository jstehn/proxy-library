import { expect, test } from "@playwright/test";

// Building from every card, brackets, mana base and commanders.
test.describe.configure({ mode: "serial" });

test("the admin builds from every card, then buys what the deck is short (design doc 29)", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByLabel("Deck name").fill("Wish list deck");
  await page.getByRole("button", { name: "Create deck" }).click();
  await expect(page.getByRole("heading", { name: "Wish list deck" })).toBeVisible();

  // The grid starts on your own cards; "All cards" searches the catalog. own=0 finds what the
  // admin doesn't have (which cards depends on the packs earlier tests opened).
  const searchIn = page.getByRole("group", { name: "Search in" });
  await expect(searchIn.getByRole("button", { name: "My cards" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await searchIn.getByRole("button", { name: "All cards" }).click();
  await page.getByRole("searchbox", { name: "Search every card" }).fill("own=0");
  const grid = page.getByRole("list", { name: "Every card" });
  const missing = grid.getByRole("button", { name: /, not owned$/ }).first();
  const name = (await missing.getAttribute("aria-label"))!.replace(/, not owned$/, "");
  await missing.click();

  const selected = page.getByRole("region", { name: `Selected: ${name}` });
  await expect(selected.getByText("You don't own this card.")).toBeVisible();
  await selected.getByRole("button", { name: "Add to deck" }).click();
  await expect(page.getByText(`Added 1 ${name} (now 1).`)).toBeVisible();
  const problems = page.getByRole("region", { name: "Problems" });
  await expect(problems.getByText("1 card has a problem (marked ⚠ below).")).toBeVisible();

  // The existing way out: Buy a list, filled in with what the deck is short of.
  await selected.getByRole("link", { name: "buy what it's short" }).click();
  await expect(
    page.getByText("Filled in with the cards Wish list deck is short of."),
  ).toBeVisible();
  await expect(page.getByLabel("Cards to buy")).toHaveValue(new RegExp(`^1 ${escapeRegExp(name)}`));
});

test("the admin aims a Commander deck at a bracket and is warned when it goes over (design doc 31)", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByLabel("Deck name").fill("Beza, bracket 2");
  await page.getByLabel("Format").selectOption("commander");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByLabel("Paste a deck list").fill("Commander\n1 Beza, the Bounding Spring");
  await page.getByRole("button", { name: "Add these cards" }).click();
  await expect(page.getByText(/Added 1 card/)).toBeVisible();

  // Nothing counts against a bracket yet. The global setup put Banishing Light and Builder's
  // Talent on the Game Changer list.
  const bracket = page.getByRole("region", { name: "Commander bracket" });
  await expect(bracket.getByText("Bracket 1–2")).toBeVisible();
  await bracket.getByLabel("Target").selectOption("2");

  // Adding a Game Changer raises the floor and warns, without making the deck illegal.
  await page
    .getByRole("group", { name: "Search in" })
    .getByRole("button", { name: "All cards" })
    .click();
  await page.getByRole("searchbox", { name: "Search every card" }).fill("is:gc banishing");
  await page
    .getByRole("list", { name: "Every card" })
    .getByRole("button", { name: /^Banishing Light, / })
    .click();
  await page
    .getByRole("region", { name: "Selected: Banishing Light" })
    .getByRole("button", { name: "Add to deck" })
    .click();
  await expect(page.getByText("Added 1 Banishing Light (now 1).")).toBeVisible();
  await expect(bracket.getByText("Bracket 3 · Upgraded")).toBeVisible();
  const problems = page.getByRole("region", { name: "Problems" });
  await expect(problems.getByText(/over your target of 2/)).toBeVisible();
  const deckList = page.getByRole("region", { name: "Deck list" });
  await expect(deckList.getByText("GC", { exact: true })).toBeVisible();

  // A reason marks its cards in the list.
  await bracket.getByRole("button", { name: /1 Game Changer/ }).click();
  await expect(deckList.locator("[data-highlighted]")).toHaveCount(1);

  // Suggestions leave out the other Game Changer, and say so.
  await page.getByRole("button", { name: "Suggestions" }).click();
  const panel = page.getByRole("region", { name: "Suggestions" });
  await expect(panel.getByText(/Hiding \d+ cards? over your target bracket/).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Builder's Talent/ })).toHaveCount(0);

  await page.emulateMedia({ colorScheme: "dark" });
  await bracket.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/bracket-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  // On a phone the selected card is a pop-up over a dimmed page: close it to reach the tabs.
  await page.getByRole("button", { name: "Close the selected card" }).click();
  await page.getByRole("tab", { name: /Deck/ }).click();
  await bracket.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/bracket-phone-dark.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });

  // The target is saved with the deck.
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Commander bracket" }).getByLabel("Target"),
  ).toHaveValue("2");
});

test("the admin fills a Commander deck's lands from the mana base plan (design doc 35)", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByLabel("Deck name").fill("Beza lands");
  await page.getByLabel("Format").selectOption("commander");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page
    .getByLabel("Paste a deck list")
    .fill("Commander\n1 Beza, the Bounding Spring\nDeck\n30 Plains");
  await page.getByRole("button", { name: "Add these cards" }).click();
  await expect(page.getByText(/Added 31 cards/)).toBeVisible();

  await page.getByRole("button", { name: "Mana base", exact: true }).click();
  const panel = page.getByRole("region", { name: "Mana base" });
  await expect(panel.getByText("30 of ~37")).toBeVisible();
  await expect(panel.getByText("7 Plains")).toBeVisible();

  await page.emulateMedia({ colorScheme: "dark" });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/mana-base-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: /Deck/ }).click();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/mana-base-phone-dark.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });

  await panel.getByRole("button", { name: "Add these 7 lands" }).click();
  await expect(page.getByText("Added 7 lands.")).toBeVisible();
  await expect(panel.getByText("37 of ~37")).toBeVisible();
  await expect(panel.getByText("The deck is at its land target.")).toBeVisible();
});

test("the admin finds a commander and starts a deck led by it (design doc 36)", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByRole("link", { name: "Find a commander" }).click();
  await expect(page.getByRole("heading", { name: "Find a commander" })).toBeVisible();
  await page.getByLabel("White").check();
  await page.getByLabel("Also legends I don't own").check();
  await page.getByRole("button", { name: "Show", exact: true }).click();

  const beza = page.getByRole("listitem").filter({ hasText: "Beza, the Bounding Spring" });
  // Earlier tests built decks around Beza (a deck may hold cards you don't own).
  await expect(beza.getByText(/Already leads .*Beza lands/)).toBeVisible();
  await expect(beza.getByText(/of 62\s+spells from your cards/)).toBeVisible();
  await beza.getByRole("button", { name: "See the cards" }).click();
  await expect(beza.getByText("Your cards by role")).toBeVisible();
  await expect(beza.getByText("What the rest might cost")).toBeVisible();

  await page.emulateMedia({ colorScheme: "dark" });
  await beza.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/find-commander-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await beza.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/find-commander-phone-dark.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });

  await beza.getByRole("button", { name: "Start a deck" }).click();
  await expect(page).toHaveURL(/\/decks\/\d+$/);
  await expect(page.getByText("Beza, the Bounding Spring").first()).toBeVisible();
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
