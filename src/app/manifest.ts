import type { MetadataRoute } from "next";

/** Web app manifest so browsers can install Proxy Library to the home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Proxy Library",
    short_name: "Proxy Library",
    description: "Open virtual Magic: The Gathering product and build decks from what you own.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Store", url: "/store", description: "Browse boosters and precons" },
      { name: "Inventory", url: "/inventory", description: "Open your sealed product" },
      { name: "Decks", url: "/decks", description: "Build and print decks" },
      { name: "Drafts", url: "/drafts", description: "Join or resume a draft" },
    ],
  };
}
