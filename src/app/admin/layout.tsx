import Link from "next/link";
import { requireAdminActor } from "@/server/session";

// The admin section (feedback 2026-09-27: admin pages shouldn't crowd the main menu). Every page
// under /admin gets this menu, and only admins get past it.

const ADMIN_PAGES = [
  ["/admin/players", "Players"],
  ["/admin/invites", "Invites"],
  ["/admin/economy", "Economy"],
  ["/admin/catalog", "Catalog"],
  ["/admin/photos", "Photos"],
  ["/admin/store", "Store prices"],
  ["/admin/packs", "Pack lab"],
] as const;

export default async function AdminLayout(props: LayoutProps<"/admin">) {
  await requireAdminActor();
  return (
    <div className="flex flex-col">
      <nav
        aria-label="Admin"
        className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
          <span className="font-semibold">Admin</span>
          {ADMIN_PAGES.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="text-zinc-700 hover:underline dark:text-zinc-300"
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>
      {props.children}
    </div>
  );
}
