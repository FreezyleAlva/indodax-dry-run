// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  turbopack: { root: __dirname },
};

export default nextConfig;
