import { expect, test, type Page } from "@playwright/test";

// The whole accounts journey from design doc 02, section 12, in a real browser:
// first visitor becomes admin → creates an invite → a second player registers with it →
// the admin disables them → they can no longer get in.

async function register(page: Page, username: string, displayName: string) {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Password").fill("secret-password");
  await page.getByRole("button", { name: "Create account" }).click();
}

test("first admin invites a player, then disables them", async ({ page, browser }) => {
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
