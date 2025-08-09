import { S3Client, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
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
    requestHandler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 5000, socketTimeout: 15000 });
  } else {
    requestHandler = new NodeHttpHandler({ connectionTimeout: 5000, socketTimeout: 15000 });
  }
  return new S3Client({ region: AWS_REGION, forcePathStyle: true, requestHandler });
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
    const parts: { ETag: string; PartNumber: number }[] | undefined = body.parts;

    if (!key || !uploadId || !parts || parts.length === 0) {
      return new Response(JSON.stringify({ error: "key, uploadId, parts 必填" }), { status: 400 });
    }

    const cmd = new CompleteMultipartUploadCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map(p => ({ ETag: p.ETag, PartNumber: p.PartNumber })) },
    });
    await s3.send(cmd);

    return Response.json({ ok: true, key });
  } catch (error: unknown) {
    console.error("[multipart/complete] error", error);
    const msg = error instanceof Error ? error.message : "complete failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
} 