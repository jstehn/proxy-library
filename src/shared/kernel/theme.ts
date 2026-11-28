import { err, ok, type Result } from "./result";

/**
 * Curated theme identifiers (design doc 74).
 * Adding a theme starts here: TypeScript enforces that `THEME_REGISTRY` in `src/ui/themes`
 * provides a matching `ThemeDefinition` for every entry.
 */
export const THEME_IDS = [
  "system",
  "light",
  "dark",
  "catppuccin-latte",
  "catppuccin-mocha",
  "bloomburrow",
  "innistrad",
  "kamigawa",
  "new-capenna",
  "ravnica",
  "ixalan",
  "theros",
  "phyrexia",
  "phyrexia-porcelain",
  "duskmourn",
  "lorwyn",
  "kaladesh",
  "strixhaven",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

const DEFAULT_THEME_ID: ThemeId = "system";

export const THEME_COOKIE_NAME = "pl_theme";

export type ThemePreference = Readonly<{
  themeId: ThemeId;
  showBackdrop: boolean;
}>;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  themeId: DEFAULT_THEME_ID,
  showBackdrop: true,
};

export type ThemeError = { kind: "UnknownTheme"; themeId: string };

const KNOWN_THEME_IDS: ReadonlySet<string> = new Set(THEME_IDS);

export function isThemeId(candidate: string): candidate is ThemeId {
  return KNOWN_THEME_IDS.has(candidate);
}

export function checkThemeId(raw: string): Result<ThemeId, ThemeError> {
  const trimmed = raw.trim();
  if (!isThemeId(trimmed)) {
    return err({ kind: "UnknownTheme", themeId: trimmed });
  }
  return ok(trimmed);
}

/**
 * Parses the `pl_theme` cookie value (`<themeId>:<1|0>`). Unknown or malformed values fall back
 * safely to `DEFAULT_THEME_PREFERENCE` so retired themes never break rendering.
 */
export function parseThemeCookie(raw: string | undefined): ThemePreference {
  if (!raw) return DEFAULT_THEME_PREFERENCE;
  const [rawThemeId, rawBackdrop] = raw.split(":");
  if (!rawThemeId || !isThemeId(rawThemeId)) return DEFAULT_THEME_PREFERENCE;
  const showBackdrop = rawBackdrop === "0" ? false : true;
  return { themeId: rawThemeId, showBackdrop };
}

export function serializeThemeCookie(preference: ThemePreference): string {
  return `${preference.themeId}:${preference.showBackdrop ? "1" : "0"}`;
}
