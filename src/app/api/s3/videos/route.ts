import { S3Client, ListObjectsV2Command, _Object, GetObjectCommand } from "@aws-sdk/client-s3";
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
    forcePathStyle: true,
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

    const items = await Promise.all(
      objects.map(async (obj) => {
        const key = obj.Key as string;
        const url = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }),
          { expiresIn }
        );
        return {
          key,
          url,
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
    // 这里不做持久化，仅返回 ok。可在未来接入 DB 做索引或审核。
    return Response.json({ ok: true, key });
  } catch (error: unknown) {
    console.error("[videos][POST] error", error);
    const message = error instanceof Error ? error.message : "Failed to register video";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
} 