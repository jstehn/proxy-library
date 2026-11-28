import "server-only";
import { readPage } from "@/server/page-instance";
import { readThemeCookie } from "@/server/theme";
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from "@/shared/kernel";
import { getTheme, type ThemeDefinition } from "@/ui/themes";

export type ResolvedThemeBackdrop = Readonly<{
  url: string | null;
  focalPoint: string;
  scrim: string;
  opacity: number;
  credit: string | null;
}>;

export type ActiveTheme = Readonly<{
  preference: ThemePreference;
  theme: ThemeDefinition;
  backdrop: ResolvedThemeBackdrop | null;
}>;

/**
 * Resolves the active theme for SSR (zero FOUC): prefers the `pl_theme` cookie, falling back to
 * the signed-in player's database preference on a fresh device, and resolves any official artwork
 * backdrop for signed-in sessions. Even if a set's artwork is not synced yet, plane themes still
 * activate their CSS artistic backdrop layer.
 */
export async function resolveActiveTheme(): Promise<ActiveTheme> {
  const [cookiePreference, page] = await Promise.all([
    readThemeCookie(),
    readPage({ allowVisitors: true }),
  ]);

  let preference: ThemePreference;
  if (cookiePreference !== null) {
    preference = cookiePreference;
  } else if (page.actor !== null) {
    preference = await page.reads.social.themePreference(page.actor);
  } else {
    preference = DEFAULT_THEME_PREFERENCE;
  }

  const theme = getTheme(preference.themeId);
  let backdrop: ResolvedThemeBackdrop | null = null;

  if (preference.showBackdrop && theme.backdrop) {
    let url: string | null = null;
    if (page.actor !== null) {
      const candidates = theme.backdrop.fallbackSource
        ? [theme.backdrop.source, theme.backdrop.fallbackSource]
        : [theme.backdrop.source];
      url = await page.reads.catalog.resolveBackdropUrl(candidates);
    }

    backdrop = {
      url,
      focalPoint: theme.backdrop.focalPoint,
      scrim: theme.backdrop.scrim,
      opacity: theme.backdrop.opacity ?? 0.8,
      credit: url !== null ? (theme.backdrop.credit ?? null) : null,
    };
  }

  return { preference, theme, backdrop };
}
