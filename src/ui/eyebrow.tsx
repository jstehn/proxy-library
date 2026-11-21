// A small uppercase label above a group of things.
import type { ReactNode } from "react";

export function Eyebrow(props: { children: ReactNode }) {
  return <p className="text-muted text-xs font-medium tracking-wide uppercase">{props.children}</p>;
}
