import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal .next/standalone server (no full node_modules) —
  // what the Dockerfile's runtime stage copies for the Railway deploy.
  output: "standalone",
  // The pages used to live under /reply. Old bookmarks still work.
  async redirects() {
    return [
      { source: "/reply", destination: "/", permanent: false },
      { source: "/reply/:path*", destination: "/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
