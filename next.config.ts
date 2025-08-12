import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "ALLOWALL" },
  { key: "Content-Security-Policy", value: "frame-ancestors *;" },
];

const cacheHeaders = [
  // 强缓存播放器静态资源（可按构建 hash 失效）
  {
    key: 'Cache-Control',
    value: 'public, max-age=31536000, immutable',
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // 对 _next 静态产物使用强缓存
      { source: "/_next/static/:path*", headers: cacheHeaders },
    ];
  },
};

export default nextConfig;
