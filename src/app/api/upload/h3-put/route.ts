import type { NextRequest } from "next/server";

export const runtime = "edge";

// 允许的上游域名（S3 / S3 Accelerate），如需自定义可扩展
const ALLOWED_HOSTS = [
  /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i,
  /\.s3\.amazonaws\.com$/i,
  /s3-accelerate\.amazonaws\.com$/i,
];

function isAllowed(url: URL): boolean {
  return ALLOWED_HOSTS.some((re) => re.test(url.hostname));
}

export async function POST(req: NextRequest) {
  try {
    const to = req.nextUrl.searchParams.get("to");
    if (!to) return new Response(JSON.stringify({ error: "missing 'to'" }), { status: 400 });
    const upstream = new URL(to);
    if (!isAllowed(upstream)) return new Response(JSON.stringify({ error: "host not allowed" }), { status: 400 });

    const init: RequestInit = {
      method: "PUT",
      // 直接转发请求体（Edge Runtime 支持基于流的转发），不添加额外头避免与签名不符
      body: req.body,
    };
    const isStreamLike = !!req.body && typeof (req.body as unknown as ReadableStream).getReader === "function";
    if (isStreamLike) {
      // Chromium 要求流式请求体声明 duplex
      (init as unknown as { duplex?: "half" }).duplex = "half";
    }
    const res = await fetch(upstream.toString(), init);

    // 透传状态与部分响应头（如 ETag）
    const headers = new Headers();
    const etag = res.headers.get("etag");
    if (etag) headers.set("etag", etag);
    return new Response(null, { status: res.status, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "h3 proxy failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

// Accept PUT as an alias to POST for convenience; upstream will still be PUT
export async function PUT(req: NextRequest) {
  return POST(req);
}


