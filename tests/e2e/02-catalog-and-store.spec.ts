import { expect, test } from "@playwright/test";
import { openAdminPage } from "./helpers";

// The catalog, the pack lab, and buying a sealed pack.
test.describe.configure({ mode: "serial" });

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
  const pack = page.getByRole("listitem").filter({ hasText: "Bloomburrow Play Booster Pack" });
  // By default (MSRP pricing), even when its cards sell back for more, it sells at its $5.49 MSRP.
  await expect(pack.getByText("$5.49")).toBeVisible();
  await expect(pack.getByText("Priced at what its contents sell back for")).toHaveCount(0);
  // Screenshots for review: dark mode, and a phone's width (user preference).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await pack.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/store-raised-phone-dark.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });

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
