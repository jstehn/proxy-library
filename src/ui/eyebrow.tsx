// A small uppercase label above a group of things.
import type { ElementType, ReactNode } from "react";

export function Eyebrow(props: { as?: ElementType; children: ReactNode }) {
  const { as: Tag = "p", children } = props;
  return <Tag className="text-muted text-xs font-medium tracking-wide uppercase">{children}</Tag>;
}
