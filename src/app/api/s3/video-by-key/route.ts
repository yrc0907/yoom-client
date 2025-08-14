import { S3Client, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import jwt, { JwtPayload } from "jsonwebtoken";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const USE_ACCELERATE = process.env.S3_ACCELERATE === "1";

function createS3Client(): S3Client {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let requestHandler: NodeHttpHandler | undefined;
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    requestHandler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 5000, socketTimeout: 15000 });
  } else {
    requestHandler = new NodeHttpHandler({ connectionTimeout: 5000, socketTimeout: 15000 });
  }
  return new S3Client({ region: AWS_REGION, requestHandler, useAccelerateEndpoint: USE_ACCELERATE });
}

const s3 = createS3Client();

function parseNumber(input: string | null, fallback: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return new Response(JSON.stringify({ error: "key 必填" }), { status: 400 });
    const expiresIn = parseNumber(searchParams.get("expires"), 600, 60, 3600);
    const includeHls = searchParams.get("includeHls") === "1";

    // auth: ensure requester owns the key
    const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const secret = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || "dev-secret";
    let userId: string | null = null;
    try {
      if (bearer) {
        const decoded = jwt.verify(bearer, secret) as JwtPayload & { sub?: string };
        userId = decoded?.sub ? String(decoded.sub) : null;
      }
    } catch { }
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    if (!key.startsWith(`uploads/users/${userId}/`)) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });

    // helpers
    async function headExists(objKey: string): Promise<boolean> {
      try { await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: objKey })); return true; } catch { return false; }
    }

    async function getHlsForKey(k: string): Promise<string | null> {
      if (!includeHls) return null;
      const baseName = k.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const prefix = `outputs/hls/${baseName}-`;
      const list = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET_NAME, Prefix: prefix, MaxKeys: 1000 }));
      const manifest = (list.Contents || []).find(o => (o.Key || "").endsWith("/master.m3u8"));
      if (!manifest?.Key) return null;
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: manifest.Key }), { expiresIn });
    }

    async function getPosterForKey(k: string): Promise<string | null> {
      const base = k.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const candidates = [
        `uploads/users/${userId}/posters/${base}.jpg`,
        `uploads/users/${userId}/posters/${base}.png`,
        `uploads/posters/${base}.jpg`,
        `uploads/posters/${base}.png`,
      ];
      for (const p of candidates) {
        if (await headExists(p)) return getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }), { expiresIn });
      }
      return null;
    }

    async function getThumbsBase(k: string): Promise<string | null> {
      const base = k.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const probes = [
        `previews-vtt/${base}-001.jpg`,
        `previews-vtt/${base}-sprite.vtt`,
        `previews-vtt/${base}.vtt`,
        `previews-vtt/${base}/001.jpg`,
      ];
      for (const p of probes) { if (await headExists(p)) return `previews-vtt/${base}`; }
      return null;
    }

    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }), { expiresIn });
    const [hlsUrl, posterUrl, thumbsBase] = await Promise.all([getHlsForKey(key), getPosterForKey(key), getThumbsBase(key)]);

    return Response.json({ key, url, hlsUrl, posterUrl, thumbsBase, expires: expiresIn });
  } catch (error: unknown) {
    console.error("[video-by-key] error", error);
    const message = error instanceof Error ? error.message : "failed";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}


