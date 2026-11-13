"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLinkProps = {
  href: string;
  /** Optional prefix used to mark nested routes active (defaults to `href`). */
  matchPrefix?: string;
  className?: string;
  activeClassName?: string;
  children: React.ReactNode;
};

/** Navigation link that sets `aria-current="page"` and active styles for the current route. */
export function NavLink({
  href,
  matchPrefix,
  className = "",
  activeClassName = "font-semibold underline underline-offset-4",
  children,
}: NavLinkProps) {
  const pathname = usePathname();
  const prefix = matchPrefix ?? href;
  const isActive =
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`${className} ${isActive ? activeClassName : ""}`.trim()}
    >
      {children}
    </Link>
  );
}
