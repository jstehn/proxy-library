// A bordered panel. `padding` is the inside space, `stack` lays the children in a column, and
// `divided` draws lines between the children (for lists of rows). Presentational only.
import type { ElementType, HTMLAttributes } from "react";

type CardPadding = "none" | "md" | "lg";

const PADDING_CLASSES: Record<CardPadding, string> = { none: "", md: "p-3", lg: "p-4" };

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  padding?: CardPadding;
  stack?: boolean;
  divided?: boolean;
};

export function Card(props: CardProps) {
  const { as: Tag = "div", padding = "none", stack, divided, className, ...rest } = props;
  const classes = ["border-border-subtle bg-card rounded-card border", PADDING_CLASSES[padding]];
  if (stack) classes.push("flex flex-col gap-3");
  if (divided) classes.push("divide-border-subtle divide-y");
  if (className) classes.push(className);
  return <Tag className={classes.filter(Boolean).join(" ")} {...rest} />;
}
