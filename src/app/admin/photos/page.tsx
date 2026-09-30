import Link from "next/link";
import { photosOverview } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";

// Admin → Photos (design doc 13): which sets have their WPN page, and how many products got an
// official photo.

const STATUS_LABELS = {
  found: "Page read",
  no_page: "No page found",
  unreadable: "Page couldn't be read",
  not_read: "Not read yet",
} as const;

export default async function PhotosPage() {
  await requireAdminActor();
  const sets = await photosOverview(getContainer().db);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Photos</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Official product photos, key art, MSRPs and product details come from each set&apos;s page
          on Wizards Play Network, read by the sync. Products without a photo show generated art.
          Open a set to check or change what each product shows.
        </p>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
            <th className="py-1 font-medium">Set</th>
            <th className="py-1 font-medium">WPN page</th>
            <th className="py-1 font-medium">Products with a photo</th>
          </tr>
        </thead>
        <tbody>
          {sets.map((set) => (
            <tr key={set.setCode} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-1.5">
                <Link href={`/admin/photos/${set.setCode}`} className="underline">
                  {set.setName}
                </Link>{" "}
                <span className="text-zinc-500">{set.setCode}</span>
              </td>
              <td
                className={`py-1.5 ${set.status === "found" ? "" : "text-amber-700 dark:text-amber-400"}`}
              >
                {STATUS_LABELS[set.status]}
              </td>
              <td className="py-1.5 tabular-nums">
                {set.withPhoto} of {set.products}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
