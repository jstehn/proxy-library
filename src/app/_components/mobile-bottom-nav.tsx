import { NavLink } from "./nav-link";

type MobileBottomNavProps = {
  draftId: number | null;
  draftStatus: string | null;
};

const QUICK_LINKS = [
  ["/store", "Store"],
  ["/inventory", "Inventory"],
  ["/collection", "Collection"],
  ["/decks", "Decks"],
  ["/drafts", "Drafts"],
] as const;

/** Fixed bottom bar on mobile screens for the five primary destinations. */
export function MobileBottomNav({ draftId, draftStatus }: MobileBottomNavProps) {
  return (
    <nav
      aria-label="Quick navigation"
      className="border-border-subtle bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-lg items-center justify-around px-1 text-xs">
        {QUICK_LINKS.map(([baseHref, label]) => {
          const href = baseHref === "/drafts" && draftId !== null ? `/drafts/${draftId}` : baseHref;
          return (
            <li key={baseHref} className="flex-1">
              <NavLink
                href={href}
                matchPrefix={baseHref}
                className="text-muted hover:text-foreground flex w-full items-center justify-center gap-1 px-1 py-2"
                activeClassName="font-semibold text-foreground"
              >
                <span>{label}</span>
                {baseHref === "/drafts" && draftStatus !== null && (
                  <>
                    <span
                      aria-hidden="true"
                      className={`inline-block h-2 w-2 rounded-full ${draftStatus === "drafting" ? "bg-amber-500" : "bg-sky-500"}`}
                    />
                    <span className="sr-only">
                      {draftStatus === "drafting" ? " (drafting)" : " (in lobby)"}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
