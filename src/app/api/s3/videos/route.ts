import { S3Client, ListObjectsV2Command, _Object, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";


export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

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

    const prefix = "uploads/videos/";

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
        } catch {
          // not found, continue
        }
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
        const [hlsUrl, posterUrl] = await Promise.all([
          getHlsForKey(key),
          getPosterForKey(key),
        ]);
        return {
          key,
          url,
          hlsUrl,
          posterUrl,
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
    return Response.json({ ok: true, key });
  } catch (error: unknown) {
    console.error("[videos][POST] error", error);
    const message = error instanceof Error ? error.message : "Failed to register video";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
} 