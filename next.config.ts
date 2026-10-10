import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `ws` uses Buffer internals that the server bundler mangles
  // ("b.mask is not a function"), and `pg` reaches for native modules.
  // Both must stay outside the bundle.
  serverExternalPackages: ["ws", "pg"],
};

export default nextConfig;
