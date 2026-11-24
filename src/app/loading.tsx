import { Page } from "@/ui/page";

export default function Loading() {
  return (
    <Page spacing="roomy">
      <div className="flex animate-pulse flex-col gap-4" aria-busy="true" aria-label="Loading page">
        <div className="bg-border-subtle h-8 w-48 rounded-md" />
        <div className="bg-border-subtle h-4 w-96 max-w-full rounded-md" />
        <div className="mt-2 flex flex-col gap-3">
          <div className="bg-border-subtle h-12 w-full rounded-md" />
          <div className="bg-border-subtle h-12 w-full rounded-md" />
          <div className="bg-border-subtle h-12 w-full rounded-md" />
        </div>
      </div>
    </Page>
  );
}
