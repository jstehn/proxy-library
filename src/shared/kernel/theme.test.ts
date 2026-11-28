import { describe, expect, it } from "vitest";
import {
  checkThemeId,
  DEFAULT_THEME_PREFERENCE,
  parseThemeCookie,
  serializeThemeCookie,
  THEME_IDS,
} from "./theme";

describe("theme kernel helpers", () => {
  it("accepts every registered theme id", () => {
    for (const id of THEME_IDS) {
      const checked = checkThemeId(id);
      expect(checked).toEqual({ ok: true, value: id });
    }
  });

  it("rejects unknown theme ids with UnknownTheme", () => {
    expect(checkThemeId("phyrexia-99")).toEqual({
      ok: false,
      error: { kind: "UnknownTheme", themeId: "phyrexia-99" },
    });
    expect(checkThemeId("  ")).toEqual({
      ok: false,
      error: { kind: "UnknownTheme", themeId: "" },
    });
  });

  it("round-trips valid theme cookies", () => {
    const enabled = serializeThemeCookie({ themeId: "bloomburrow", showBackdrop: true });
    expect(parseThemeCookie(enabled)).toEqual({ themeId: "bloomburrow", showBackdrop: true });

    const disabled = serializeThemeCookie({ themeId: "innistrad", showBackdrop: false });
    expect(parseThemeCookie(disabled)).toEqual({ themeId: "innistrad", showBackdrop: false });
  });

  it("falls back safely on missing, malformed, or retired cookies", () => {
    expect(parseThemeCookie(undefined)).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(parseThemeCookie("")).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(parseThemeCookie("unknown-plane:0")).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(parseThemeCookie("kamigawa")).toEqual({ themeId: "kamigawa", showBackdrop: true });
  });
});
