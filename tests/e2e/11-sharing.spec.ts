import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Sharing a deck and commenting on it.
test.describe.configure({ mode: "serial" });

test("the admin shares a deck; another player reads it and comments (design doc 21)", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, "admin");
  await admin.goto("/decks");
  await admin.getByRole("link", { name: "Beza's Bounty" }).click();
  await admin.getByRole("button", { name: "Share with the playgroup" }).click();
  await expect(admin.getByText("Shared: every player can see it and comment.")).toBeVisible();

  // Rin finds it among the shared decks, reads it (with her own copies), and comments.
  const rinContext = await browser.newContext();
  const rin = await rinContext.newPage();
  await signIn(rin, "rin");
  await rin.goto("/decks");
  await rin.getByRole("link", { name: "Decks shared by the playgroup" }).click();
  const shared = rin.getByRole("listitem").filter({ hasText: "Beza's Bounty" });
  await expect(shared.getByText(/by Admin · Commander · 100 cards · led by Beza/)).toBeVisible();
  await shared.getByRole("link", { name: "Beza's Bounty" }).click();
  await expect(rin.getByText(/shared by Admin/)).toBeVisible();
  const deckList = rin.getByRole("region", { name: "Deck list" });
  await expect(deckList.getByText(/^you \d+$/).first()).toBeVisible();
  await expect(deckList.getByRole("button", { name: "One more Plains" })).toHaveCount(0);
  await rin.getByLabel("Your comment").fill("Bold choice: 99 Plains!");
  await rin.getByRole("button", { name: "Post comment" }).click();
  const comments = rin.getByRole("region", { name: "Comments" });
  await expect(comments.getByText("Bold choice: 99 Plains!")).toBeVisible();

  // The admin hears about it in the feed, sees it on the deck, and deletes it.
  await admin.goto("/");
  await expect(admin.getByText(/Rin commented on Admin's deck/)).toBeVisible();
  await admin.getByRole("link", { name: "Beza's Bounty" }).first().click();
  const adminComments = admin.getByRole("region", { name: "Comments" });
  await expect(adminComments.getByText("Bold choice: 99 Plains!")).toBeVisible();
  await adminComments.getByRole("button", { name: "Delete Rin's comment" }).click();
  await expect(adminComments.getByText("Comment removed.")).toBeVisible();

  // Private again: Rin can't open it any more.
  await admin.getByRole("button", { name: "Make private" }).click();
  await expect(admin.getByText("Private: only you can see it.")).toBeVisible();
  const response = await rin.reload();
  expect(response?.status()).toBe(404);

  // Cards to get, across all the admin's decks.
  await admin.goto("/decks");
  await admin.getByRole("link", { name: "Cards to get for all your decks" }).click();
  await expect(admin.getByRole("heading", { name: "Cards to get" })).toBeVisible();
  await expect(
    admin.getByText(/(cop(y|ies) of \d+ cards?, about \$|you own every card your decks use)/),
  ).toBeVisible();
  await adminContext.close();
  await rinContext.close();
});
