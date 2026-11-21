import { expect, test } from "@playwright/test";
import { openAdminPage, register } from "./helpers";

// The journeys share one database and build on each other, so they run in order: the file
// names start with their place in the order.
// The first admin and the players they invite (design doc 02).
test.describe.configure({ mode: "serial" });

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
