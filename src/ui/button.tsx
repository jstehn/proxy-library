// The one button look. `Button` is the element; `buttonClass` gives the same look to a link
// (`<Link className={buttonClass({ variant: "secondary" })}>`). Presentational only.
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export type ButtonSize = "md" | "sm" | "xs" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground font-medium hover:bg-accent-hover",
  secondary: "border-line border hover:bg-surface",
  danger: "bg-danger text-danger-foreground font-medium hover:bg-danger-hover",
  quiet: "text-muted hover:text-foreground",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "px-3 py-1.5 text-sm",
  sm: "px-3 py-1 text-sm",
  xs: "px-2.5 py-1 text-xs",
  lg: "px-3 py-2 text-sm",
};

type ButtonLook = { variant?: ButtonVariant; size?: ButtonSize; className?: string };

/** The class string for a button-looking element. */
export function buttonClass(look: ButtonLook = {}): string {
  const { variant = "primary", size = "md", className } = look;
  const classes = ["rounded-md disabled:opacity-60", VARIANT_CLASSES[variant], SIZE_CLASSES[size]];
  if (className) classes.push(className);
  return classes.join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Omit<ButtonLook, "className">;

export function Button(props: ButtonProps) {
  const { variant, size, className, ...rest } = props;
  return <button className={buttonClass({ variant, size, className })} {...rest} />;
}
