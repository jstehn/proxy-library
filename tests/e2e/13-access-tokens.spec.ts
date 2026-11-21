import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Access tokens for an LLM.
test.describe.configure({ mode: "serial" });

test("a player makes an access token for an LLM, uses it, and revokes it (design doc 28)", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, "rin");
  await page.goto("/account");
  await page.getByRole("link", { name: "Access tokens" }).click();
  await expect(page.getByRole("heading", { name: "Connect an LLM" })).toBeVisible();

  await page.getByLabel("Name").fill("LM Studio");
  await page.getByLabel("add to and change your wishlist").uncheck();
  await page.getByRole("button", { name: "Make a token" }).click();
  await expect(page.getByText("you won't see it again")).toBeVisible();
  const secret = (await page.locator("code", { hasText: /^pl_/ }).first().textContent()) ?? "";
  expect(secret).toMatch(/^pl_[A-Za-z0-9_-]{43}$/);

  // The token works on the tool endpoint, within its scopes.
  const headers = { Authorization: `Bearer ${secret}` };
  const decks = await request.post("/api/tools/list_decks", { headers, data: {} });
  expect(decks.status()).toBe(200);
  expect((await decks.json()).decks.length).toBeGreaterThan(0);
  const wish = await request.post("/api/tools/manage_wishlist", {
    headers,
    data: { action: "add", wishes: [{ card: "Plains" }] },
  });
  expect(wish.status()).toBe(403);

  await page.reload();
  const row = page.getByRole("listitem").filter({ hasText: "LM Studio" });
  await expect(row.getByText(/edit decks/)).toBeVisible();
  await expect(row.getByText(/last used/)).toBeVisible();

  // Screenshots for review: dark mode, and a phone's width (user preference).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/tokens-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/tokens-phone-dark.png", fullPage: true });

  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("None yet.")).toBeVisible();
  const after = await request.post("/api/tools/list_decks", { headers, data: {} });
  expect(after.status()).toBe(401);
  await context.close();
});
