import { revalidatePath } from "next/cache";

// The admin area's paths, and what to refresh after a change. (Admin forms that change money or
// a player's library refresh the header too: `revalidateHeader` in `../paths`.)

export const ADMIN_SECTIONS = [
  "catalog",
  "connectors",
  "invites",
  "photos",
  "players",
  "store",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export function adminPath(section: AdminSection): string {
  return `/admin/${section}`;
}

/** One admin page's list. */
export function revalidateAdmin(section: AdminSection): void {
  revalidatePath(adminPath(section));
}

/** The admin store page, and the store itself, which shows the same prices. */
export function revalidateAdminStore(): void {
  revalidateAdmin("store");
  revalidatePath("/store", "layout");
}

/** A set's photos page, with a sentence (or an error) to show on it. */
export function photosSetPath(code: string, tone: "message" | "error", text: string): string {
  const params = new URLSearchParams({ [tone]: text });
  return `${adminPath("photos")}/${code}?${params.toString()}`;
}
