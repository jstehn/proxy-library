import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser tests run their own dev server with a separate build folder, so they can run
  // while your normal `pnpm dev` is open (Next allows one dev server per build folder).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
