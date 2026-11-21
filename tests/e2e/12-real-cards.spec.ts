import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Recording real cards and building with them.
test.describe.configure({ mode: "serial" });

test("a player records real cards from a file and a product, and builds with them (design doc 16)", async ({
  browser,
}) => {
  test.setTimeout(90_000); // a long journey, through several pages compiled on first visit
  const context = await browser.newContext();
  const rin = await context.newPage();
  await signIn(rin, "rin");

  // Import a ManaBox file: preview, change a line's printing, import.
  await rin.goto("/collection/real");
  await rin.getByRole("link", { name: "Import cards" }).click();
  await rin.getByLabel("Or a file:").setInputFiles("tests/fixtures/real-collection/manabox.csv");
  await expect(
    rin.getByText(/Read as a ManaBox file: 3 lines matched \(6 cards\), 2 skipped/),
  ).toBeVisible();
  await expect(rin.getByText("Not A Real Card (BLB 999): no card has that name")).toBeVisible();
  const bezaFoil = rin.getByLabel("Printing of Beza, the Bounding Spring").first();
  const option900 = bezaFoil.locator("option", { hasText: "#900" });
  await bezaFoil.selectOption((await option900.getAttribute("value")) ?? "");
  await rin.getByRole("button", { name: "Import" }).click();
  await expect(rin.getByText(/Imported: 3 new, 0 changed, 0 removed\./)).toBeVisible();

  // The Real tab shows them with their value; the Game tab is untouched.
  await rin.getByRole("link", { name: "See your real collection" }).click();
  await expect(
    rin.getByText(/The cards you own for real: 6 cards \(3 different\) worth \$/),
  ).toBeVisible();

  // A product owned for real: its cards go in, and its precon becomes a deck using real cards.
  await rin.goto("/store/BLB");
  const kit = rin.getByRole("listitem").filter({ hasText: "Bloomburrow Starter Kit" });
  await kit.getByRole("button", { name: "I own this for real" }).click();
  await expect(
    kit.getByText(/Added \d+ cards to your real collection\. New deck: Hare Raising\./),
  ).toBeVisible();
  await kit.getByRole("link", { name: "Hare Raising" }).click();
  await expect(
    rin.getByText("Using your real cards: cards you own for real count as owned here."),
  ).toBeVisible();
  await rin.goto("/decks");
  const hare = rin.getByRole("listitem").filter({ hasText: "Hare Raising" });
  await expect(hare.getByText("real cards")).toBeVisible();
  await expect(hare.getByText("all owned")).toBeVisible();

  // Its proxies leave out the cards Rin owns for real; only their tokens are left to print
  // (design doc 25: cards left out as real still get their tokens).
  await hare.getByRole("link", { name: "Hare Raising" }).click();
  await rin.getByRole("link", { name: "Print proxies" }).click();
  await expect(rin.getByText("Cards you own for real")).toBeVisible();
  await expect(rin.getByText(/^2 tokens on 1 page/)).toBeVisible();
  await rin.getByText("Print them too").click();
  await expect(rin.getByText(/^\d+ cards and 2 tokens on \d+ pages?/)).toBeVisible();

  // Screenshots for review: dark mode, and a phone's width (user preference).
  await rin.emulateMedia({ colorScheme: "dark" });
  await rin.goto("/collection/real");
  await rin.screenshot({ path: "test-results/real-collection-dark.png", fullPage: true });
  await rin.setViewportSize({ width: 390, height: 844 });
  await rin.goto("/collection/real/import");
  await rin
    .getByLabel("Cards to import")
    .fill(readFileSync("tests/fixtures/real-collection/list.txt", "utf8"));
  await rin.getByRole("button", { name: "Preview" }).click();
  await expect(rin.getByText(/Read as a pasted list/)).toBeVisible();
  await rin.getByLabel("Also make a deck from this list").check();
  await rin.screenshot({ path: "test-results/real-import-phone-dark.png", fullPage: true });
  await context.close();
});
