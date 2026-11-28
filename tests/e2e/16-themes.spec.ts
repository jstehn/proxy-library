import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Extensible theming system (design doc 74): switching palettes & planes persists across reloads,
// updates `<html data-theme>` and `<html data-color-scheme>`, and honors palette-only mode.
test.describe.configure({ mode: "serial" });

const SCREENSHOT_DIR = process.env.THEME_SCREENSHOT_DIR;

async function maybeShot(page: import("@playwright/test").Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

async function selectTheme(page: import("@playwright/test").Page, themeId: string) {
  await page.locator(`label:has(input[name="themeId"][value="${themeId}"])`).click();
  await page.getByRole("button", { name: "Apply theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", themeId);
}

test("switches curated themes, persists across reload, and toggles backdrop", async ({ page }) => {
  // Keep offline E2E runs fast when external icon CDN is unreachable.
  await page.route("https://cdn.jsdelivr.net/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );

  await signIn(page, "admin");
  await page.goto("/account/appearance");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await maybeShot(page, "01-default-appearance");

  // Switch to Catppuccin Mocha (dark palette, no backdrop).
  await selectTheme(page, "catppuccin-mocha");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await maybeShot(page, "02-catppuccin-mocha");

  // Reload to verify zero-FOUC SSR persistence via cookie + database.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "catppuccin-mocha");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");

  // Switch to Bloomburrow (light plane with storybook serif & rounded corners).
  await selectTheme(page, "bloomburrow");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
  await maybeShot(page, "03-bloomburrow-appearance");

  // Visit another page to verify site-wide theming.
  await page.goto("/account");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "bloomburrow");
  await maybeShot(page, "04-bloomburrow-account");

  // Switch to Innistrad (dark gothic plane).
  await page.goto("/account/appearance");
  await selectTheme(page, "innistrad");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await maybeShot(page, "05-innistrad");

  // Switch to Kamigawa (dark tech plane).
  await selectTheme(page, "kamigawa");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await maybeShot(page, "06-kamigawa");

  // Switch to New Capenna (dark Art Deco plane).
  await selectTheme(page, "new-capenna");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await maybeShot(page, "07-new-capenna");

  // Toggle palette-only mode (hide background artwork).
  await page.getByLabel("Show background artwork on plane themes").uncheck();
  await page.getByRole("button", { name: "Apply theme" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-backdrop", "active");

  // Restore System default with backdrop enabled so later journeys start clean.
  await page.getByLabel("Show background artwork on plane themes").check();
  await selectTheme(page, "system");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light dark");
});
