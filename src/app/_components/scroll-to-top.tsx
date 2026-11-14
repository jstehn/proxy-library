"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Floating "Back to top" button for infinite-scroll pages. Uses an IntersectionObserver on a
 * zero-size top sentinel so it appears only after the user has scrolled down, and jumps back
 * to the top instantly on click.
 */
export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setVisible(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none h-0 w-0" />
      {visible && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}
          aria-label="Scroll to top"
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white/95 px-3.5 py-2 text-xs font-medium text-zinc-900 shadow-lg backdrop-blur hover:bg-zinc-100 md:right-6 md:bottom-6 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          <span aria-hidden="true">↑</span>
          Top
        </button>
      )}
    </>
  );
}
