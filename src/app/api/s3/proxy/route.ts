import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const USE_ACCELERATE = process.env.S3_ACCELERATE === "1";

function createS3Client(): S3Client {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let requestHandler: NodeHttpHandler | undefined;
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    requestHandler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 8000, socketTimeout: 20000 });
  } else {
    requestHandler = new NodeHttpHandler({ connectionTimeout: 8000, socketTimeout: 20000 });
  }
  return new S3Client({ region: AWS_REGION, requestHandler, useAccelerateEndpoint: USE_ACCELERATE });
}

const s3 = createS3Client();

export async function GET(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return new Response(JSON.stringify({ error: "key 必填" }), { status: 400 });

    const range = request.headers.get("range") || undefined;
    const ifNoneMatch = request.headers.get("if-none-match") || undefined;

    const cmd = new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key, Range: range, IfNoneMatch: ifNoneMatch });

    try {
      const res = await s3.send(cmd);
      const headers = new Headers();
      if (res.ContentType) headers.set("Content-Type", res.ContentType);
      if (res.ContentLength != null) headers.set("Content-Length", String(res.ContentLength));
      if (res.ETag) headers.set("ETag", res.ETag);
      headers.set("Accept-Ranges", "bytes");
      if (res.ContentRange) headers.set("Content-Range", res.ContentRange);
      headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, ETag, Content-Length");

      const status = res.ContentRange ? 206 : 200;
      return new Response(res.Body as ReadableStream<Uint8Array>, { status, headers });
    } catch (err: unknown) {
      const e = err as { $metadata?: { httpStatusCode?: number }; $response?: { statusCode?: number } };
      const status = e?.$metadata?.httpStatusCode || e?.$response?.statusCode;
      // If-None-Match 命中缓存：S3 返回 304
      if (status === 304) {
        return new Response(null, { status: 304 });
      }
      throw err;
    }
  } catch (err: unknown) {
    console.error("[s3/proxy] error", err);
    const msg = err instanceof Error ? err.message : "proxy failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
} 