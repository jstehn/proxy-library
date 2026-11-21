// A small coloured label: a tag, a status, a count. Presentational only.
import type { ComponentProps, ElementType } from "react";

export type BadgeTone = "sky" | "violet" | "amber" | "green";
export type BadgeSize = "md" | "sm";

const TONE_CLASSES: Record<BadgeTone, string> = {
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  green: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  md: "px-2 py-0.5 text-xs font-medium",
  sm: "px-1.5 py-0.5 text-[11px]",
};

type BadgeProps = ComponentProps<"span"> & {
  tone: BadgeTone;
  size?: BadgeSize;
  pill?: boolean;
  as?: ElementType;
};

export function Badge(props: BadgeProps) {
  const { tone, size = "md", pill = false, as: Tag = "span", className, ...rest } = props;
  const classes = [pill ? "rounded-full" : "rounded", TONE_CLASSES[tone], SIZE_CLASSES[size]];
  if (className) classes.push(className);
  return <Tag className={classes.join(" ")} {...rest} />;
}
