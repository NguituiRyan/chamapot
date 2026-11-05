import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the user's home folder confuses workspace-root detection.
  turbopack: { root: __dirname },
};

export default nextConfig;
