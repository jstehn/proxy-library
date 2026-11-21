// Grey placeholder shapes shown while a page's reads finish. Presentational only; a section's
// `loading.tsx` picks how many rows and how wide a column.
import type { ComponentProps } from "react";
import { Page } from "@/ui/page";

type PageWidth = ComponentProps<typeof Page>["width"];

export function PageSkeleton(props: { rows?: number; width?: PageWidth }) {
  const { rows = 6, width = "4xl" } = props;
  return (
    <Page width={width} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="bg-surface-raised h-8 w-1/3 animate-pulse rounded-md" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="bg-surface-raised h-14 animate-pulse rounded-md" />
        ))}
      </div>
    </Page>
  );
}
