import { S3Client, ListObjectsV2Command, _Object, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
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
    requestHandler = new NodeHttpHandler({
      httpAgent: agent,
      httpsAgent: agent,
      connectionTimeout: 5000,
      socketTimeout: 15000,
    });
  } else {
    requestHandler = new NodeHttpHandler({
      connectionTimeout: 5000,
      socketTimeout: 15000,
    });
  }

  return new S3Client({
    region: AWS_REGION,
    requestHandler,
    useAccelerateEndpoint: USE_ACCELERATE,
  });
}

const s3Client = createS3Client();

function parseNumber(input: string | null, fallback: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(
        JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }),
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseNumber(searchParams.get("limit"), 12, 1, 1000);
    const token = searchParams.get("token");
    const expiresIn = parseNumber(searchParams.get("expires"), 600, 60, 3600);
    const includeHls = searchParams.get("includeHls") === "1";

    // Multi-tenant isolation by userId
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
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const prefix = `uploads/users/${userId}/videos/`;

    const listRes = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: token || undefined,
        MaxKeys: limit,
      })
    );

    const objects = (listRes.Contents || []).filter((obj: _Object) => !!obj.Key);

    async function getHlsForKey(key: string): Promise<string | null> {
      if (!includeHls) return null;
      const baseName = key.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const hlsPrefix = `outputs/hls/${baseName}-`;
      const list = await s3Client.send(new ListObjectsV2Command({ Bucket: S3_BUCKET_NAME, Prefix: hlsPrefix, MaxKeys: 1000 }));
      const manifest = (list.Contents || []).find(o => (o.Key || "").endsWith("/master.m3u8"));
      if (!manifest?.Key) return null;
      const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: manifest.Key }), { expiresIn });
      return url;
    }

    async function getPosterForKey(key: string): Promise<string | null> {
      const base = key.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const candidates = [
        `uploads/posters/${base}.jpg`,
        `uploads/posters/${base}.png`,
      ];
      for (const p of candidates) {
        try {
          await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }));
          const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }), { expiresIn });
          return url;
        } catch { }
      }
      return null;
    }

    async function getPreviewForKey(key: string): Promise<string | null> {
      const base = key.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const p = `previews/${base}.mp4`;
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }));
        const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }), { expiresIn });
        return url;
      } catch { }
      return null;
    }

    async function getPreview360ForKey(key: string): Promise<string | null> {
      const base = key.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const p = `previews-360/${base}.mp4`;
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }));
        const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }), { expiresIn });
        return url;
      } catch { }
      return null;
    }

    async function getAnimForKey(key: string): Promise<string | null> {
      const base = key.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const candidates = [
        `previews-anim/${base}.webp`,
        `previews-anim/${base}.gif`,
      ];
      for (const p of candidates) {
        try {
          await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }));
          const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }), { expiresIn });
          return url;
        } catch { }
      }
      return null;
    }

    async function getThumbsBaseForKey(key: string): Promise<string | null> {
      const base = key.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      const probes = [
        `previews-vtt/${base}-001.jpg`,          // 老版逐帧 jpg（顶层）
        `previews-vtt/${base}-sprite.vtt`,       // 雪碧图 vtt（顶层）
        `previews-vtt/${base}.vtt`,              // 简化 vtt（顶层）
        `previews-vtt/${base}/001.jpg`,          // 逐帧 jpg（子目录）
      ];
      for (const p of probes) {
        try {
          await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: p }));
          return `previews-vtt/${base}`;
        } catch { }
      }
      return null;
    }

    const items = await Promise.all(
      objects.map(async (obj) => {
        const key = obj.Key as string;
        const url = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }),
          { expiresIn }
        );
        const [hlsUrl, posterUrl, previewUrl, preview360Url, animUrl, thumbsBase] = await Promise.all([
          getHlsForKey(key),
          getPosterForKey(key),
          getPreviewForKey(key),
          getPreview360ForKey(key),
          getAnimForKey(key),
          getThumbsBaseForKey(key),
        ]);
        return {
          key,
          url,
          hlsUrl,
          posterUrl,
          previewUrl,
          preview360Url,
          animUrl,
          thumbsBase,
          size: obj.Size,
          lastModified: obj.LastModified?.toISOString?.() ?? undefined,
        };
      })
    );

    return Response.json({
      items,
      nextToken: listRes.IsTruncated ? listRes.NextContinuationToken ?? null : null,
      expires: expiresIn,
    });
  } catch (error: unknown) {
    console.error("[videos] error", error);
    const message = error instanceof Error ? error.message : "Failed to list videos";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const key: string | undefined = body.key;
    if (!key) {
      return new Response(JSON.stringify({ error: "key 必填" }), { status: 400 });
    }
    // 触发 MediaConvert 异步转码
    try {
      const origin = new URL(request.url).origin;
      const res = await fetch(new URL("/api/mediaconvert/start", origin).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const msg = await res.text();
        console.warn("[videos][POST] start mediaconvert failed:", msg);
      }
    } catch (err) {
      console.warn("[videos][POST] start mediaconvert error:", err);
    }

    // 启动后台任务生成逐帧 VTT（若还不存在）
    try {
      const origin = new URL(request.url).origin;
      const base = key.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "";
      // 仅登记任务，由前端/批处理生成器上传至 previews-vtt/；此处只返回 thumbsBase，前端即可立即尝试显示
      // 若你需要纯服务端生成，可在此处集成 Lambda/FFmpeg。
      await Promise.resolve();
    } catch { }
    return Response.json({ ok: true, key });
  } catch (error: unknown) {
    console.error("[videos][POST] error", error);
    const message = error instanceof Error ? error.message : "Failed to register video";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
} 