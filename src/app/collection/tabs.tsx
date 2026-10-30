import Link from "next/link";

// The collection's two tabs (design doc 16, section 7): the cards you own in the game, and the
// cards you own for real. Links, so each tab has its own address and filters.

export function CollectionTabs(props: { current: "game" | "real" }) {
  const tab = (key: "game" | "real", href: string, label: string) => (
    <Link
      href={href}
      aria-current={props.current === key ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        props.current === key
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Collection" className="flex gap-1">
      {tab("game", "/collection", "Game")}
      {tab("real", "/collection/real", "Real")}
    </nav>
  );
}
