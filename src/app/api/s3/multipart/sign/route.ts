import { S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
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
    const partNumber: number | undefined = body.partNumber;

    if (!key || !uploadId || !partNumber) {
      return new Response(JSON.stringify({ error: "key, uploadId, partNumber 必填" }), { status: 400 });
    }

    const cmd = new UploadPartCommand({ Bucket: S3_BUCKET_NAME, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: new Uint8Array() });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 900 });

    return Response.json({ url });
  } catch (error: unknown) {
    console.error("[multipart/sign] error", error);
    const msg = error instanceof Error ? error.message : "sign failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
} 