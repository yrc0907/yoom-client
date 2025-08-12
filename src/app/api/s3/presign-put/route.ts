import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
// 默认关闭 Accelerate，避免未启用导致 404
const USE_ACCELERATE = false;

function createS3Client(): S3Client {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let requestHandler: NodeHttpHandler | undefined;
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    requestHandler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 5000, socketTimeout: 20000 });
  } else {
    requestHandler = new NodeHttpHandler({ connectionTimeout: 5000, socketTimeout: 20000 });
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
    if (!fileName || !fileType || !fileType.startsWith("video/")) {
      return new Response(JSON.stringify({ error: "fileName 和 video 类型必填" }), { status: 400 });
    }

    const datePart = new Date().toISOString().slice(0, 10);
    const ext = getFileExtension(sanitizeFileName(fileName));
    const key = `uploads/videos/${datePart}/${crypto.randomUUID()}${ext}`;

    const cmd = new PutObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key, ContentType: fileType });
    // 签名有效期 15 分钟
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(s3, cmd, { expiresIn: 900 });
    return Response.json({ url, key });
  } catch (error: unknown) {
    console.error("[presign-put] error", error);
    const msg = error instanceof Error ? error.message : "presign failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


