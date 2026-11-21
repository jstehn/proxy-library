import { expect, type Page } from "@playwright/test";

// Steps the journeys share. The journeys run in order against one database (see 01-accounts).

export /** Answers the confirmation dialog a destructive button opens (see `ConfirmButton`). */
async function confirmInDialog(page: Page, confirmLabel: string) {
  await page.getByRole("dialog").getByRole("button", { name: confirmLabel, exact: true }).click();
}

export /** Admin pages live behind the "Admin" link, in their own menu. */
async function openAdminPage(page: Page, name: string) {
  await page.locator(`header a[href="/admin"]:visible`).click(); // not the account link, also "Admin"
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name }).click();
}

export async function register(page: Page, username: string, displayName: string) {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
}

export /** Signs in on a page of its own browser context. */
async function signIn(page: Page, username: string) {
  await page.route("**/api/images/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTitle("Your wallet")).toBeVisible();
}

export /** The pick screen's heading ("Round 1 of 3, pick 4 …"), or "" when there's none. */
async function pickHeading(page: Page): Promise<string> {
  const heading = page.getByRole("heading", { name: /^Round \d of 3, pick \d+/ });
  return (await heading.count()) === 0 ? "" : ((await heading.textContent()) ?? "");
}

export /**
 * Picks the first card of the pack in front of this player, if there is one, and waits for the
 * page to move on. Returns whether it picked.
 */
async function pickFirstCard(page: Page): Promise<boolean> {
  const pack = page.getByRole("list", { name: "Your pack" });
  if (!(await pack.isVisible())) return false;
  const before = await pickHeading(page);
  await pack.getByRole("button").first().dblclick();
  // The last pick doesn't change the heading: the page shows the finished text instead. Finishing
  // a draft builds every player's deck, which took over 20 seconds on a busy machine (2026-11-21).
  const finished = page.getByText(/Your \d+ cards are in your collection/);
  await expect
    .poll(async () => (await finished.isVisible()) || (await pickHeading(page)) !== before, {
      timeout: 45_000,
    })
    .toBe(true);
  return true;
}
