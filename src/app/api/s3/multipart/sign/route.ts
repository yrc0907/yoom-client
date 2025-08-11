import { S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
    requestHandler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 5000, socketTimeout: 15000 });
  } else {
    requestHandler = new NodeHttpHandler({ connectionTimeout: 5000, socketTimeout: 15000 });
  }
  return new S3Client({ region: AWS_REGION, requestHandler, useAccelerateEndpoint: USE_ACCELERATE });
}

const s3 = createS3Client();

export async function POST(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });
    }
    const body = await request.json().catch(() => ({}));
    const key: string | undefined = body.key;
    const uploadId: string | undefined = body.uploadId;
    const partNumber: number | undefined = body.partNumber;
    const checksumCRC32C: string | undefined = body.checksumCRC32C; // Base64-encoded crc32c
    const contentMD5: string | undefined = body.contentMD5; // Base64-encoded MD5 (optional)

    if (!key || !uploadId || !partNumber) {
      return new Response(JSON.stringify({ error: "key, uploadId, partNumber 必填" }), { status: 400 });
    }

    // 为了让 S3 进行端到端校验，可选传入校验头（需要与客户端 PUT 时一致）
    const cmd = new UploadPartCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      ChecksumCRC32C: checksumCRC32C,
      ContentMD5: contentMD5,
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 900 });

    return Response.json({ url, requires: { checksumCRC32C: !!checksumCRC32C, contentMD5: !!contentMD5 } });
  } catch (error: unknown) {
    console.error("[multipart/sign] error", error);
    const msg = error instanceof Error ? error.message : "sign failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
} 