// The centered column every page sits in. Presentational only.
import type { HTMLAttributes } from "react";

type PageWidth = "sm" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl";
type PageSpacing = "tight" | "normal" | "roomy" | "wide";

const WIDTH_CLASSES: Record<PageWidth, string> = {
  sm: "max-w-sm",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
};

const SPACING_CLASSES: Record<PageSpacing, string> = {
  tight: "gap-6 py-8",
  normal: "gap-6 py-12",
  roomy: "gap-8 py-12",
  wide: "gap-10 py-12",
};

type PageProps = HTMLAttributes<HTMLElement> & { width?: PageWidth; spacing?: PageSpacing };

export function Page(props: PageProps) {
  const { width = "4xl", spacing = "normal", className, ...rest } = props;
  const classes = [
    "mx-auto flex w-full flex-col px-4",
    WIDTH_CLASSES[width],
    SPACING_CLASSES[spacing],
  ];
  if (className) classes.push(className);
  return <main className={classes.join(" ")} {...rest} />;
}
