import { S3Client, CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
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

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "");
}

function getFileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  if (index === -1) return "";
  return name.slice(index).slice(0, 10);
}

export async function POST(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });
    }
    const body = await request.json().catch(() => ({}));
    const fileName: string | undefined = body.fileName;
    const fileType: string | undefined = body.fileType;
    const fileSize: number | undefined = body.fileSize;

    if (!fileName || !fileType || !fileType.startsWith("video/")) {
      return new Response(JSON.stringify({ error: "fileName 和 video 类型必填" }), { status: 400 });
    }

    // auth: require userId from JWT
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

    const datePart = new Date().toISOString().slice(0, 10);
    const ext = getFileExtension(sanitizeFileName(fileName));
    const key = `uploads/users/${userId}/videos/${datePart}/${crypto.randomUUID()}${ext}`;

    const cmd = new CreateMultipartUploadCommand({ Bucket: S3_BUCKET_NAME, Key: key, ContentType: fileType });
    const res = await s3.send(cmd);

    if (!res.UploadId) {
      return new Response(JSON.stringify({ error: "Failed to initiate multipart upload" }), { status: 500 });
    }

    // 根据文件大小动态建议分片大小：保证分片数 <= 10,000，且不低于 8MB（亦满足 S3 最小 5MB 要求）
    const FIVE_MB = 5 * 1024 * 1024;
    const EIGHT_MB = 8 * 1024 * 1024;
    let partSize = EIGHT_MB;
    if (typeof fileSize === "number" && fileSize > 0) {
      const minPart = Math.ceil(fileSize / 10000);
      partSize = Math.max(FIVE_MB, EIGHT_MB, minPart);
      // 对齐到 1MB 边界
      const ONE_MB = 1024 * 1024;
      partSize = Math.ceil(partSize / ONE_MB) * ONE_MB;
    }

    return Response.json({ key, uploadId: res.UploadId, partSize });
  } catch (error: unknown) {
    console.error("[multipart/initiate] error", error);
    const msg = error instanceof Error ? error.message : "initiate failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
} 