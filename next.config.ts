import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser tests run their own dev server with a separate build folder, so they can run
  // while your normal `pnpm dev` is open (Next allows one dev server per build folder).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The dev server only runs its page scripts for `localhost` by default. Opened from another
  // device (a phone) or through this computer's network address (such as http://192.168.1.20:3000),
  // pages showed but nothing on them responded: the pack opener ignored clicks and Space.
  // Allow addresses on the home network. Development only; production builds don't check this.
  allowedDevOrigins: ["192.168.*.*", "*.local"],
};

export default nextConfig;
