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
        className="cursor-pointer rounded-md border border-zinc-300 px-2.5 py-1 dark:border-zinc-700"
      >
        Menu
      </button>
      <div
        id={menuId}
        ref={menu}
        popover="auto"
        className="phone-menu-popover bg-background text-foreground flex w-56 flex-col gap-1 rounded-md border border-zinc-200 p-2 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900 [&>a]:rounded [&>a]:px-2 [&>a]:py-1.5 [&>a:hover]:bg-zinc-100 dark:[&>a:hover]:bg-zinc-800"
      >
        {props.children}
        <InstallAppButton variant="menu" />
      </div>
    </div>
  );
}
