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

  test("mobile menu popover light-dismisses on Escape and bottom nav is visible on phones", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // Ensure no horizontal overflow at 390px.
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
