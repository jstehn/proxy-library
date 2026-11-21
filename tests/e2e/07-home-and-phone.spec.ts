import { expect, test } from "@playwright/test";

// The home page, the collection download, and the phone menu.
test.describe.configure({ mode: "serial" });

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

  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Decks", exact: true }),
  ).toBeHidden();
  await page.getByText("Menu", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Decks", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Decks" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Decks", exact: true }),
  ).toBeHidden(); // closed after navigating
  await phone.close();
});
