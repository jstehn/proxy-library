import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

// Building, editing and exporting decks.
test.describe.configure({ mode: "serial" });

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

  // Problems are worked out in the browser (design doc 19): with every save held back for a few
  // seconds, the problem still shows at once.
  await page.mouse.move(0, 0);
  await page.route("**/decks/**", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await route.continue();
  });
  await deckList.getByRole("button", { name: "One fewer Plains" }).click();
  await expect(problems.getByText("The deck has 99 cards; it needs exactly 100.")).toBeVisible({
    timeout: 1500,
  });
  const lastSave = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      (response.request().postData() ?? "").includes('"quantity":99'),
    { timeout: 15_000 },
  );
  await deckList.getByRole("button", { name: "One more Plains" }).click();
  await expect(problems.getByText(/The deck has \d+ cards/)).toHaveCount(0, { timeout: 1500 });
  await lastSave; // the held-back saves still reach the server
  await page.unroute("**/decks/**");

  // Roles: counted against the format's targets; a role marks its cards; a view by role.
  const ramp = stats.getByRole("button", { name: "Ramp" });
  await expect(stats.getByText("Roles")).toBeVisible();
  await ramp.click();
  await expect(ramp).toHaveAttribute("aria-pressed", "true");
  await deckList.getByRole("button", { name: "By role" }).click();
  await expect(deckList.getByRole("heading", { name: "Lands (99)" })).toBeVisible();
  await deckList.getByRole("button", { name: "By type" }).click();

  // A test hand: 7 cards; Commander's first mulligan is free, the second puts one on the bottom.
  await page.getByRole("button", { name: "Test hand" }).click();
  const testHand = page.getByRole("region", { name: "Test hand" });
  const inHand = testHand.getByRole("list", { name: "Cards in hand" }).getByRole("listitem");
  await expect(inHand).toHaveCount(7);
  await testHand.getByRole("button", { name: "Mulligan" }).click();
  await expect(testHand.getByText("Mulligans: 1 (first free)")).toBeVisible();
  await expect(testHand.getByText(/to put on the bottom/)).toHaveCount(0);
  await testHand.getByRole("button", { name: "Mulligan" }).click();
  await expect(testHand.getByText("Choose 1 card to put on the bottom.")).toBeVisible();
  await testHand.getByRole("button", { name: "Put Plains on the bottom" }).first().click();
  await expect(inHand).toHaveCount(6);
  await testHand.getByRole("button", { name: "Draw" }).click();
  await expect(inHand).toHaveCount(7);
  await expect(testHand.getByText(/turn 1/).first()).toBeVisible();
  await expect(testHand.getByRole("definition").first()).toHaveText(/^\d+%/);
  await testHand.getByRole("button", { name: "Close" }).click();

  // Proxies: choose options, see what they make, and download the PDF.
  await page.getByRole("link", { name: "Print proxies" }).click();
  // Beza (Plains skipped), and 2 copies each of the 2 tokens Beza makes (design doc 25).
  await expect(page.getByText(/^1 card and 4 tokens on 1 page, 9 to a page\./)).toBeVisible();
  await page.getByText("Include them").click();
  // Bleed fills the gap between cards, so the grid stays 3 × 3 (changed 2026-10-07).
  await page.getByText("Fill the gap").click();
  await expect(page.getByText(/^100 cards and 4 tokens on 12 pages, 9 to a page\./)).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Bezas Bounty proxies.pdf");
  const pdf = readFileSync(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(12);
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

test("the admin edits a deck as text; a bad line saves nothing (design doc 23)", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByRole("link", { name: "Beza's Bounty" }).click();

  // The box starts with the whole list; printings pinned when cards were added are named.
  await page.getByRole("link", { name: "Edit as text" }).click();
  const box = page.getByLabel("The deck's list as text");
  await expect(box).toHaveValue(
    /^Commander\n1 Beza, the Bounding Spring.*\n\nDeck\n99 Plains( \(\w+\) \S+( \*\w\*)?)?$/,
  );

  // Category headings, as Archidekt exports them; one card the catalog doesn't have.
  const edited = [
    "Commander (1)",
    "1 Beza, the Bounding Spring",
    "Lands (90)",
    "90 Plains",
    "Removal & Board Wipes (1)",
    "1 Ingenious Artillerist",
  ].join("\n");
  await box.fill(edited);
  await page.getByRole("button", { name: "Save list" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Nothing was saved" });
  await expect(alert.getByText("Not in the catalog: Ingenious Artillerist")).toBeVisible();
  await expect(box).toHaveValue(edited); // the text is kept, to fix

  // Without that line it saves, and the builder shows the new list.
  await box.fill(edited.split("\n").slice(0, 4).join("\n"));
  await page.getByRole("button", { name: "Save list" }).click();
  await expect(page.getByText("Saved: 91 cards.")).toBeVisible();
  const problems = page.getByRole("region", { name: "Problems" });
  await expect(problems.getByText("The deck has 91 cards; it needs exactly 100.")).toBeVisible();

  // Back to 99 Plains for the tests after this one.
  await page.getByRole("link", { name: "Edit as text" }).click();
  await box.fill((await box.inputValue()).replace("90 Plains", "99 Plains"));
  await page.getByRole("button", { name: "Save list" }).click();
  await expect(page.getByText("Saved: 100 cards.")).toBeVisible();
});

test("the admin changes a card's printing, then lets it follow their copies (design doc 24)", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByRole("link", { name: "Beza's Bounty" }).click();

  const name = "Beza, the Bounding Spring";
  await page
    .getByRole("region", { name: "Deck list" })
    .getByRole("button", { name: `Select ${name}` })
    .click();
  await page.getByRole("button", { name: "Change printing" }).click();
  const picker = page.getByRole("group", { name: "Choose a printing" });
  // Pasting the list pinned a printing, so "Follow my copies" isn't the choice yet.
  await expect(picker.getByRole("radio", { name: /Follow my copies/ })).not.toBeChecked();

  // The borderless foil: chosen at once, and Edit as text names it.
  await picker.getByRole("radio", { name: "Bloomburrow #900, Foil" }).check();
  await expect(page.getByText(`${name}: Bloomburrow #900, foil.`)).toBeVisible();
  await expect(picker.getByRole("radio", { name: "Bloomburrow #900, Foil" })).toBeChecked();
  await page.reload();
  await page.getByRole("link", { name: "Edit as text" }).click();
  await expect(page.getByLabel("The deck's list as text")).toHaveValue(
    new RegExp(`^Commander\n1 ${name} \\(BLB\\) 900 \\*F\\*\n`),
  );

  // Back to automatic.
  await page
    .getByRole("region", { name: "Deck list" })
    .getByRole("button", { name: `Select ${name}` })
    .click();
  await page.getByRole("button", { name: "Change printing" }).click();
  await picker.getByRole("radio", { name: /Follow my copies/ }).check();
  await expect(page.getByText(`${name} follows your copies again.`)).toBeVisible();
  await expect(picker.getByRole("radio", { name: /Follow my copies/ })).toBeChecked();
});

test("the admin asks for suggestions, adds one, and turns a budget into a list (design doc 20)", async ({
  page,
}) => {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Decks", exact: true }).click();
  await page.getByLabel("Deck name").fill("Beza Suggests");
  await page.getByLabel("Format").selectOption("commander");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByLabel("Paste a deck list").fill("Commander\n1 Beza, the Bounding Spring");
  await page.getByRole("button", { name: "Add these cards" }).click();
  await expect(page.getByText(/Added 1 card/)).toBeVisible();

  // Beza makes Treasure: the deck builds around tokens, and is short of every role.
  await page.getByRole("button", { name: "Suggestions" }).click();
  const panel = page.getByRole("region", { name: "Suggestions" });
  await expect(panel.getByText(/Builds around Tokens.*Short of ramp, card draw/)).toBeVisible();
  const forDeck = panel.getByRole("list", { name: "For this deck" });
  const first = forDeck.getByRole("button").first();
  await expect(first).toBeVisible();
  const name = (await first.getAttribute("aria-label"))?.split(":")[0] ?? "";

  // A suggestion is selected like a grid card, and added the same way.
  await first.click();
  const selected = page.getByRole("region", { name: `Selected: ${name}` });
  await selected.getByRole("button", { name: "Add to deck" }).click();
  await expect(page.getByText(`Added 1 ${name} (now 1).`)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Deck list" }).getByRole("button", { name, exact: true }),
  ).toBeVisible();

  // Cards like the selected one.
  await selected.getByRole("button", { name: "Cards like this" }).click();
  await expect(
    selected.getByRole("list", { name: "Cards like this" }).getByRole("button").first(),
  ).toBeVisible();

  // A budget becomes a list for Buy a list, which checks prices again before buying. $20, not
  // less: the fixture catalog has two store cards for this deck (about $1 and $11), the
  // suggestion added above may be the cheap one, and which it is depends on the packs opened
  // earlier, whose seeds are random.
  await panel.getByLabel("Budget in dollars").fill("20");
  await panel.getByRole("button", { name: "Make a list" }).click();
  const budget = panel.getByRole("list", { name: "Budget list" });
  await expect(budget.getByRole("listitem").first()).toBeVisible();
  await expect(panel.getByText(/^\d+ cards? for \$\d+\.\d\d/)).toBeVisible();
  await panel.getByRole("link", { name: "Buy these" }).click();
  await expect(page).toHaveURL(/\/singles\/list\?list=/);
  await expect(page.getByText("Filled in with the list you made.")).toBeVisible();
  await expect(page.getByLabel("Cards to buy")).toHaveValue(/^1 .+ \([A-Z0-9]+\) \S+/);
});
