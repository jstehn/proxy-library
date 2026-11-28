import type { ThemeId } from "@/shared/kernel";

export type ThemeCategory = "default" | "palette" | "plane";
export type ThemeColorScheme = "light" | "dark" | "light dark";

export type ThemeArtworkSource =
  | Readonly<{ kind: "wpn-key-art"; setCode: string }>
  | Readonly<{ kind: "scryfall-art-crop"; setCode: string; collectorNumber: string }>
  | Readonly<{ kind: "static"; path: string }>;

export type ThemeBackdrop = Readonly<{
  source: ThemeArtworkSource;
  /** Optional fallback if primary WPN key art has not been synced for this set. */
  fallbackSource?: ThemeArtworkSource;
  /** CSS background-position, e.g. "center 20%" so key subjects stay above the fold. */
  focalPoint: string;
  /** CSS gradient scrim layered over the image to blend edges into --canvas-bg. */
  scrim: string;
  opacity?: number;
  credit?: string;
}>;

export type ThemeTypography = Readonly<{
  /** CSS font-family value for headings (e.g. "var(--font-display-serif), Georgia, serif"). */
  displayFont: string;
  /** Optional body font override (defaults to Geist Sans). */
  bodyFont?: string;
  /** Optional heading letter-spacing adjustment. */
  headingTracking?: string;
}>;

export type ThemeShape = Readonly<{
  /** Mapped to --theme-radius-card (default 0.5rem). */
  cardRadius: string;
  /** Mapped to --theme-radius-control (default 0.375rem). */
  controlRadius: string;
  /** Optional subtle elevation or border glow on panels/cards. */
  cardShadow?: string;
}>;

export type ThemeTokens = Readonly<{
  background: string;
  foreground: string;
  muted: string;
  surface: string;
  surfaceRaised: string;
  field: string;
  borderSubtle: string;
  line: string;
  accent: string;
  accentHover: string;
  accentForeground: string;
  danger: string;
  dangerHover: string;
  dangerForeground: string;
  dangerText: string;
  dangerSoft: string;
  dangerLine: string;
  dangerInk: string;
  successText: string;
  successSoft: string;
  successLine: string;
  successInk: string;
  warningText: string;
  warningSoft: string;
  warningLine: string;
  warningInk: string;
  focusRing: string;
  /* Steam-profile surface/chrome tokens (no-op on flat themes). */
  canvasBg: string;
  panelBg: string;
  panelBlur: string;
  cardBg: string;
  headerBg: string;
}>;

export type ThemeDefinition = Readonly<{
  id: ThemeId;
  name: string;
  category: ThemeCategory;
  description: string;
  colorScheme: ThemeColorScheme;
  /** Keyrune set code shown in the theme picker for plane themes. */
  setCode?: string;
  /** Three hex preview swatches rendered in the picker card. */
  swatches: readonly [string, string, string];
  /** Present on explicit themes; omitted on "system" which uses :root + OS media query. */
  tokens?: ThemeTokens;
  typography?: ThemeTypography;
  shape?: ThemeShape;
  backdrop?: ThemeBackdrop;
}>;
