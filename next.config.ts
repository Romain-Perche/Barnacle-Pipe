import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SF-119: 500,000 characters of pasted campaign HTML can be up to 2 MB as UTF-8 (Next's default action body is 1 MB).
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
