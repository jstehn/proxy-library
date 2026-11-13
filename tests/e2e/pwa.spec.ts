import { expect, test } from "@playwright/test";

test.describe("PWA & mobile UI", () => {
  test("serves manifest with shortcuts, service worker, and offline fallback", async ({
    request,
  }) => {
    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    const manifestJson = await manifestResponse.json();
    expect(manifestJson.display).toBe("standalone");
    expect(manifestJson.shortcuts).toHaveLength(4);

    const swResponse = await request.get("/sw.js");
    expect(swResponse.ok()).toBe(true);
    const swText = await swResponse.text();
    expect(swText).toContain("MAX_IMAGE_ENTRIES = 500");
    expect(swText).toContain("/offline.html");

    const offlineResponse = await request.get("/offline.html");
    expect(offlineResponse.ok()).toBe(true);
    expect(await offlineResponse.text()).toContain("You&apos;re offline");
  });

  test("mobile menu popover is hidden on load, toggles cleanly, and bottom nav renders", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/register");

    // Register first user (admin) if needed, or sign in if already seeded.
    const noInviteBanner = page.getByText("The first account becomes the admin");
    if (await noInviteBanner.isVisible().catch(() => false)) {
      await page.getByLabel("Username").fill("pwa_tester");
      await page.getByLabel("Display name").fill("PWA Tester");
      await page.getByLabel("Password").fill("secret-password");
      await page.getByRole("button", { name: "Create account" }).click();
    } else {
      await page.goto("/sign-in");
      await page.getByLabel("Username").fill("admin");
      await page.getByLabel("Password").fill("secret-password");
      await page.getByRole("button", { name: "Sign in" }).click();
    }

    await expect(page.getByRole("navigation", { name: "Quick navigation" })).toBeVisible();

    const menuButton = page.getByRole("button", { name: "Menu" });
    await expect(menuButton).toBeVisible();

    const popover = page.locator(".phone-menu-popover");
    await expect(popover).not.toBeVisible();

    await page.screenshot({ path: "/tmp/pwa-mobile-closed.png" });

    await menuButton.click();
    await expect(popover).toBeVisible();
    await page.screenshot({ path: "/tmp/pwa-mobile-open.png" });

    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
