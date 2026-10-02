import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal .next/standalone server (no full node_modules) —
  // what the Dockerfile's runtime stage copies for the Railway deploy.
  output: "standalone",
};

export default nextConfig;
