"use client";
// The main menu on phones: a "Menu" button that opens a list (design doc 11, section 5). The header
// stays on screen between pages, so the menu closes itself after each navigation.
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function PhoneMenu(props: { children: React.ReactNode }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  return (
    <details ref={menu} className="relative md:hidden">
      <summary className="cursor-pointer list-none rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700">
        Menu
      </summary>
      <div className="absolute right-0 z-40 mt-2 flex w-56 flex-col gap-1 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 [&>a]:rounded [&>a]:px-2 [&>a]:py-1.5 [&>a:hover]:bg-zinc-100 dark:[&>a:hover]:bg-zinc-800">
        {props.children}
      </div>
    </details>
  );
}
