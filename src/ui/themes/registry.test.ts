import { describe, expect, it } from "vitest";
import { THEME_IDS } from "@/shared/kernel";
import { getTheme, themeCssVariables } from "./registry";

const WCAG_AA_NORMAL_TEXT = 4.5;
const WCAG_AA_UI_COMPONENT = 3.0;

function parseHexColor(hex: string): Readonly<{ red: number; green: number; blue: number }> {
  const normalized = hex.trim().replace(/^#/, "");
  if (normalized.length === 3) {
    return {
      red: Number.parseInt(normalized[0] + normalized[0], 16),
      green: Number.parseInt(normalized[1] + normalized[1], 16),
      blue: Number.parseInt(normalized[2] + normalized[2], 16),
    };
  }
  if (normalized.length === 6) {
    return {
      red: Number.parseInt(normalized.slice(0, 2), 16),
      green: Number.parseInt(normalized.slice(2, 4), 16),
      blue: Number.parseInt(normalized.slice(4, 6), 16),
    };
  }
  throw new Error(`Expected 3- or 6-digit hex color, got "${hex}"`);
}

function linearizeChannel(channel255: number): number {
  const srgb = channel255 / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const { red, green, blue } = parseHexColor(hex);
  return (
    0.2126 * linearizeChannel(red) +
    0.7152 * linearizeChannel(green) +
    0.0722 * linearizeChannel(blue)
  );
}

function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = relativeLuminance(foregroundHex);
  const l2 = relativeLuminance(backgroundHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe("theme registry", () => {
  it("has a definition for every registered ThemeId", () => {
    for (const id of THEME_IDS) {
      expect(getTheme(id).id).toBe(id);
    }
  });

  it("satisfies WCAG AA contrast ratios on every explicit theme palette", () => {
    for (const id of THEME_IDS) {
      const theme = getTheme(id);
      if (!theme.tokens) continue;
      const tokens = theme.tokens;

      const textPairs: ReadonlyArray<readonly [string, string, string]> = [
        ["foreground on background", tokens.foreground, tokens.background],
        ["foreground on surface", tokens.foreground, tokens.surface],
        ["foreground on surfaceRaised", tokens.foreground, tokens.surfaceRaised],
        ["foreground on field", tokens.foreground, tokens.field],
        ["muted on background", tokens.muted, tokens.background],
        ["muted on surface", tokens.muted, tokens.surface],
        ["accentForeground on accent", tokens.accentForeground, tokens.accent],
        ["accentForeground on accentHover", tokens.accentForeground, tokens.accentHover],
        ["dangerForeground on danger", tokens.dangerForeground, tokens.danger],
        ["dangerForeground on dangerHover", tokens.dangerForeground, tokens.dangerHover],
        ["dangerText on background", tokens.dangerText, tokens.background],
        ["dangerInk on dangerSoft", tokens.dangerInk, tokens.dangerSoft],
        ["successText on background", tokens.successText, tokens.background],
        ["successInk on successSoft", tokens.successInk, tokens.successSoft],
        ["warningText on background", tokens.warningText, tokens.background],
        ["warningInk on warningSoft", tokens.warningInk, tokens.warningSoft],
      ];

      for (const [label, foreground, background] of textPairs) {
        const ratio = contrastRatio(foreground, background);
        expect(
          ratio,
          `${theme.id}: ${label} (${foreground} on ${background}) was ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      }

      const uiPairs: ReadonlyArray<readonly [string, string, string]> = [
        ["focusRing on background", tokens.focusRing, tokens.background],
        ["accent on background", tokens.accent, tokens.background],
      ];

      for (const [label, foreground, background] of uiPairs) {
        const ratio = contrastRatio(foreground, background);
        expect(
          ratio,
          `${theme.id}: ${label} (${foreground} on ${background}) was ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(WCAG_AA_UI_COMPONENT);
      }
    }
  });

  it("keeps default system theme zero-overhead with no inline overrides", () => {
    expect(themeCssVariables(getTheme("system"))).toEqual({});
  });

  it("collapses panel and card surface tokens to transparent when backdrop is off", () => {
    const vars = themeCssVariables(getTheme("bloomburrow"), { backdropActive: false }) as Record<
      string,
      string
    >;
    expect(vars["--panel-bg"]).toBe("transparent");
    expect(vars["--panel-blur"]).toBe("0px");
    expect(vars["--card-bg"]).toBe("transparent");
  });
});
