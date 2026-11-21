"use client";
// The main menu on phones: a "Menu" button that opens a light-dismiss popover (design doc 49).
// The header stays on screen between pages, so the popover also closes after each navigation.
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { InstallAppButton } from "./install-app-button";

export function PhoneMenu(props: { children: React.ReactNode }) {
  const pathname = usePathname();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = menu.current;
    if (element?.matches(":popover-open")) {
      element.hidePopover();
    }
  }, [pathname]);

  return (
    <div className="relative md:hidden">
      <button
        type="button"
        popoverTarget={menuId}
        className="border-line cursor-pointer rounded-md border px-2.5 py-1"
      >
        Menu
      </button>
      <div
        id={menuId}
        ref={menu}
        popover="auto"
        className="phone-menu-popover bg-background text-foreground border-border-subtle [&>a:hover]:bg-surface-raised max-h-[calc(100dvh-5rem)] w-56 gap-1 overflow-y-auto rounded-md border p-2 text-sm shadow-lg [&>a]:rounded [&>a]:px-2 [&>a]:py-1.5"
      >
        {props.children}
        <InstallAppButton variant="menu" />
      </div>
    </div>
  );
}
