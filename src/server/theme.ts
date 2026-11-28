import "server-only";
import { cookies } from "next/headers";
import {
  parseThemeCookie,
  serializeThemeCookie,
  THEME_COOKIE_NAME,
  type ThemePreference,
} from "@/shared/kernel";

const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function readThemeCookie(): Promise<ThemePreference | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(THEME_COOKIE_NAME)?.value;
  if (raw === undefined) return null;
  return parseThemeCookie(raw);
}

export async function writeThemeCookie(preference: ThemePreference): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE_NAME, serializeThemeCookie(preference), {
    path: "/",
    sameSite: "lax",
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
  });
}
