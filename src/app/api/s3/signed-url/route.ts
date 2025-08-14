import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
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
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });
    }
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return new Response(JSON.stringify({ error: "key 必填" }), { status: 400 });
    const expires = parseNumber(searchParams.get("expires"), 600, 60, 3600);

    // Ensure the requester can only sign their own keys
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
    if (!key.startsWith(`uploads/users/${userId}/`)) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }

    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }), { expiresIn: expires });
    return Response.json({ url, expires });
  } catch (error: unknown) {
    console.error("[signed-url] error", error);
    const message = error instanceof Error ? error.message : "Failed to create signed url";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
} 