// The short page shown when something is missing or broke: a heading, one sentence, the actions.
// Presentational only; the root and section `error.tsx` / `not-found.tsx` files use it.
import type { ReactNode } from "react";
import { Page } from "@/ui/page";

export function PageMessage(props: { title: string; children: ReactNode; actions?: ReactNode }) {
  const { title, children, actions } = props;
  return (
    <Page width="3xl" spacing="roomy">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted text-sm">{children}</p>
      </header>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </Page>
  );
}
