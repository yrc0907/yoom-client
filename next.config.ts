import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "ALLOWALL" },
  { key: "Content-Security-Policy", value: "frame-ancestors *;" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
