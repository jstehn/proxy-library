import { expect, test } from "@playwright/test";
import { openAdminPage, signIn, pickFirstCard } from "./helpers";

// Live drafts and drafting alone against a bot.
test.describe.configure({ mode: "serial" });

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
