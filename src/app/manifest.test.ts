import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
  it("exposes installable PWA metadata with a stable id and standalone display", () => {
    const result = manifest();

    expect(result.id).toBe("/");
    expect(result.name).toBe("Proxy Library");
    expect(result.short_name).toBe("Proxy Library");
    expect(result.start_url).toBe("/");
    expect(result.scope).toBe("/");
    expect(result.display).toBe("standalone");
  });

  it("references existing 192x192, 512x512, and maskable PNG icons", () => {
    const result = manifest();
    const icons = result.icons ?? [];

    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
      ]),
    );

    const publicDir = join(process.cwd(), "public");
    for (const icon of icons) {
      const relative = icon.src.replace(/^\//, "");
      expect(existsSync(join(publicDir, relative))).toBe(true);
    }
  });

  it("exposes app shortcuts for primary destinations", () => {
    const result = manifest();
    const shortcuts = result.shortcuts ?? [];

    expect(shortcuts.map((shortcut) => shortcut.url)).toEqual([
      "/store",
      "/inventory",
      "/decks",
      "/drafts",
    ]);
  });
});
