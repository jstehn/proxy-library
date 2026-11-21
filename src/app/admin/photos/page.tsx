import Link from "next/link";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";

// Admin → Photos (design doc 13): which sets have their WPN page, and how many products got an
// official photo.

const STATUS_LABELS = {
  found: "Page read",
  no_page: "No page found",
  unreadable: "Page couldn't be read",
  not_read: "Not read yet",
} as const;

export default async function PhotosPage() {
  const { actor: admin, reads } = await readPage({ admin: true });
  const sets = await reads.catalog.photosOverview(admin);

  return (
    <Page width="5xl">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Photos</h1>
        <p className="text-muted text-sm">
          Official product photos, key art, MSRPs and product details come from each set&apos;s page
          on Wizards Play Network, read by the sync. Products without a photo show generated art.
          Open a set to check or change what each product shows.
        </p>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border-subtle border-b text-left">
            <th className="py-1 font-medium">Set</th>
            <th className="py-1 font-medium">WPN page</th>
            <th className="py-1 font-medium">Products with a photo</th>
          </tr>
        </thead>
        <tbody>
          {sets.map((set) => (
            <tr key={set.setCode} className="border-border-subtle border-b">
              <td className="py-1.5">
                <Link href={`/admin/photos/${set.setCode}`} className="underline">
                  {set.setName}
                </Link>{" "}
                <span className="text-muted">{set.setCode}</span>
              </td>
              <td className={`py-1.5 ${set.status === "found" ? "" : "text-warning-text"}`}>
                {STATUS_LABELS[set.status]}
              </td>
              <td className="py-1.5 tabular-nums">
                {set.withPhoto} of {set.products}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}
