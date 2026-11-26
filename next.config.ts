import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { turbopackFileSystemCacheForBuild: false },
};

export default nextConfig;
