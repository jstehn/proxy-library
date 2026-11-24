import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegistration } from "./_components/pwa-registration";
import { SiteHeader } from "./site-header";

const SKIP_LINK =
  "focus:bg-background focus:text-foreground sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-current";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Proxy Library",
  description: "Open virtual Magic: The Gathering product and build decks from what you own.",
  appleWebApp: {
    capable: true,
    title: "Proxy Library",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        <a href="#main-content" className={SKIP_LINK}>
          Skip to content
        </a>
        <PwaRegistration />
        <Suspense
          fallback={
            <header className="border-border-subtle border-b">
              <nav
                aria-label="Primary"
                className="mx-auto flex w-full max-w-6xl items-center gap-x-3 px-4 py-3 text-sm"
              >
                <Link href="/" className="font-semibold">
                  Proxy Library
                </Link>
              </nav>
            </header>
          }
        >
          <SiteHeader />
        </Suspense>
        <div id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </div>
        {/* Required by Wizards' Fan Content Policy (design doc 13). */}
        <footer className="border-border-subtle text-muted border-t px-4 py-4 text-center text-xs">
          Proxy Library is unofficial Fan Content permitted under the Fan Content Policy. Not
          approved/endorsed by Wizards. Portions of the materials used are property of Wizards of
          the Coast. ©Wizards of the Coast LLC.
        </footer>
      </body>
    </html>
  );
}
