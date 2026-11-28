import type { CSSProperties } from "react";
import { THEME_IDS, type ThemeId } from "@/shared/kernel";
import { darkTheme, lightTheme, systemTheme } from "./presets/default";
import { catppuccinLatteTheme, catppuccinMochaTheme } from "./presets/palettes";
import { bloomburrowTheme, innistradTheme, kamigawaTheme, newCapennaTheme } from "./presets/planes";
import type { ThemeCategory, ThemeDefinition } from "./types";

/**
 * Exhaustive theme registry: TypeScript guarantees every `ThemeId` in `@/shared/kernel` has a
 * matching preset here.
 */
const THEME_REGISTRY: Readonly<Record<ThemeId, ThemeDefinition>> = {
  system: systemTheme,
  light: lightTheme,
  dark: darkTheme,
  "catppuccin-latte": catppuccinLatteTheme,
  "catppuccin-mocha": catppuccinMochaTheme,
  bloomburrow: bloomburrowTheme,
  innistrad: innistradTheme,
  kamigawa: kamigawaTheme,
  "new-capenna": newCapennaTheme,
};

const ALL_THEMES: readonly ThemeDefinition[] = THEME_IDS.map((id) => THEME_REGISTRY[id]);

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEME_REGISTRY[id];
}

export function themesByCategory(category: ThemeCategory): readonly ThemeDefinition[] {
  return ALL_THEMES.filter((theme) => theme.category === category);
}

/**
 * Produces the inline CSS custom properties for a theme so `RootLayout` (or a future scoped
 * profile container) applies the active theme with zero drift between TypeScript and CSS.
 */
export function themeCssVariables(
  theme: ThemeDefinition,
  options: Readonly<{ backdropActive?: boolean }> = {},
): CSSProperties {
  const variables: Record<string, string> = {};
  const backdropActive = options.backdropActive ?? false;

  if (theme.tokens) {
    const tokens = theme.tokens;
    variables["--background"] = tokens.background;
    variables["--foreground"] = tokens.foreground;
    variables["--muted"] = tokens.muted;
    variables["--surface"] = tokens.surface;
    variables["--surface-raised"] = tokens.surfaceRaised;
    variables["--field"] = tokens.field;
    variables["--border-subtle"] = tokens.borderSubtle;
    variables["--line"] = tokens.line;
    variables["--accent"] = tokens.accent;
    variables["--accent-hover"] = tokens.accentHover;
    variables["--accent-foreground"] = tokens.accentForeground;
    variables["--danger"] = tokens.danger;
    variables["--danger-hover"] = tokens.dangerHover;
    variables["--danger-foreground"] = tokens.dangerForeground;
    variables["--danger-text"] = tokens.dangerText;
    variables["--danger-soft"] = tokens.dangerSoft;
    variables["--danger-line"] = tokens.dangerLine;
    variables["--danger-ink"] = tokens.dangerInk;
    variables["--success-text"] = tokens.successText;
    variables["--success-soft"] = tokens.successSoft;
    variables["--success-line"] = tokens.successLine;
    variables["--success-ink"] = tokens.successInk;
    variables["--warning-text"] = tokens.warningText;
    variables["--warning-soft"] = tokens.warningSoft;
    variables["--warning-line"] = tokens.warningLine;
    variables["--warning-ink"] = tokens.warningInk;
    variables["--focus-ring"] = tokens.focusRing;
    variables["--canvas-bg"] = backdropActive ? tokens.canvasBg : tokens.background;
    variables["--panel-bg"] = backdropActive ? tokens.panelBg : "transparent";
    variables["--panel-blur"] = backdropActive ? tokens.panelBlur : "0px";
    variables["--card-bg"] = backdropActive ? tokens.cardBg : "transparent";
    variables["--header-bg"] = backdropActive ? tokens.headerBg : tokens.background;
  }

  if (theme.typography) {
    variables["--theme-font-display"] = theme.typography.displayFont;
    if (theme.typography.bodyFont) {
      variables["--theme-font-body"] = theme.typography.bodyFont;
    }
    if (theme.typography.headingTracking) {
      variables["--theme-heading-tracking"] = theme.typography.headingTracking;
    }
  }

  if (theme.shape) {
    variables["--theme-radius-card"] = theme.shape.cardRadius;
    variables["--theme-radius-control"] = theme.shape.controlRadius;
    if (theme.shape.cardShadow) {
      variables["--theme-card-shadow"] = theme.shape.cardShadow;
    }
  }

  return variables as CSSProperties;
}
