// The quiet line shown where a list has nothing in it.
import type { ReactNode } from "react";

export function EmptyState(props: { children: ReactNode }) {
  return <p className="text-muted text-sm">{props.children}</p>;
}
