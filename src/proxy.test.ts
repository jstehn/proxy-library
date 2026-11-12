import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

function matchesProxy(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

describe("proxy matcher", () => {
  it("skips static and PWA metadata assets so browsers can fetch them unauthenticated", () => {
    expect(matchesProxy("/favicon.ico")).toBe(false);
    expect(matchesProxy("/manifest.webmanifest")).toBe(false);
    expect(matchesProxy("/sw.js")).toBe(false);
    expect(matchesProxy("/icon.svg")).toBe(false);
    expect(matchesProxy("/apple-icon.png")).toBe(false);
    expect(matchesProxy("/icons/icon-192.png")).toBe(false);
    expect(matchesProxy("/icons/icon-512.png")).toBe(false);
    expect(matchesProxy("/icons/icon-maskable-512.png")).toBe(false);
  });

  it("continues matching app pages, including /inventory", () => {
    expect(matchesProxy("/")).toBe(true);
    expect(matchesProxy("/inventory")).toBe(true);
    expect(matchesProxy("/decks/42")).toBe(true);
    expect(matchesProxy("/d/abcDEF0123456789_-abcd")).toBe(true);
    expect(matchesProxy("/sign-in")).toBe(true);
  });
});

describe("proxy public paths", () => {
  it("allows unauthenticated access to /d/ public deck links and /api/images/ card art", () => {
    const publicDeck = proxy(new NextRequest("http://localhost:3000/d/abcDEF0123456789_-abcd"));
    expect(publicDeck.headers.get("location")).toBeNull();

    const cardImage = proxy(
      new NextRequest("http://localhost:3000/api/images/print-1/small/front"),
    );
    expect(cardImage.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated access to private /decks/[id] pages to /sign-in", () => {
    const privateDeck = proxy(new NextRequest("http://localhost:3000/decks/42"));
    expect(privateDeck.headers.get("location")).toBe(
      "http://localhost:3000/sign-in?next=%2Fdecks%2F42",
    );
  });
});
