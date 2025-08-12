import sharp from "sharp";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
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
    requestHandler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 8000, socketTimeout: 20000 });
  } else {
    requestHandler = new NodeHttpHandler({ connectionTimeout: 8000, socketTimeout: 20000 });
  }
  return new S3Client({ region: AWS_REGION, requestHandler });
}

const s3 = createS3Client();

export async function GET(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) return new Response(JSON.stringify({ error: "env missing" }), { status: 500 });
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const w = Number(searchParams.get("w") || 0);
    const h = Number(searchParams.get("h") || 0);
    if (!key) return new Response(JSON.stringify({ error: "key required" }), { status: 400 });

    const src = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }));
    const contentType = src.ContentType || "image/jpeg";
    const body = src.Body as any as NodeJS.ReadableStream;
    let pipe = sharp();
    if (w > 0 || h > 0) pipe = pipe.resize({ width: w || undefined, height: h || undefined, fit: 'cover' });
    const out = body.pipe(pipe.jpeg({ quality: 80 }));

    const headers = new Headers();
    headers.set("Content-Type", "image/jpeg");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(out as any, { status: 200, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "thumb failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


